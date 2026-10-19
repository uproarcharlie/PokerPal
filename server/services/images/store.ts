import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AppEnv } from "../../config/env";

/**
 * Where image variants are written and the URL each is served from. Keys are server-made
 * (`<kind>/<uuid>/<width>.webp`) and never reused, so every object is cacheable forever. Nothing is
 * ever deleted in this phase. An image that is replaced, or whose club or tournament is deleted, is
 * logged as an orphan; an upload that is never attached to anything (a QR page photo for a sign-up
 * that was abandoned) is not logged anywhere, so a future clean-up must compare the bucket with the
 * images rows point at, not trust the orphan log alone.
 */
export interface ImageStore {
  readonly kind: "r2" | "local";
  /** Write a new object. Keys are random and never reused, so nothing stored is ever overwritten. */
  put(key: string, body: Buffer): Promise<void>;
  publicUrl(key: string): string;
  /** Whether a URL points into this store (what a row may be given as its image). */
  owns(url: string): boolean;
  /** One line for the boot log; no secrets. */
  describe(): string;
}

/** Objects are immutable: a replaced image gets a new key. */
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const IMAGE_CONTENT_TYPE = "image/webp";

const VALID_KEY = /^[a-z_]+\/[0-9a-f-]{36}\/\d+\.webp$/;

/**
 * Which store a configuration selects. Cloudflare R2 when cloud storage is wanted (always in
 * production, elsewhere with USE_CLOUD_STORAGE=true) and every R2 variable is set. Otherwise local
 * disk, except in production, where local disk is used only when UPLOAD_DIR names it explicitly (a
 * persistent volume): a container's own disk is wiped by every redeploy, so production without
 * either is `unavailable` and uploads answer 503 rather than store images that will vanish
 * (img-01, IMG-16). A half-configured R2 never gets here: loadEnv refuses it.
 */
export type ImageStoreConfig =
  | {
      kind: "r2";
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
      publicBaseUrl: string;
    }
  | { kind: "local"; root: string }
  | { kind: "unavailable"; problem: string };

export function imageStoreConfig(env: AppEnv, cwd: string = process.cwd()): ImageStoreConfig {
  const wantsCloud = env.USE_CLOUD_STORAGE || env.NODE_ENV === "production";
  if (
    wantsCloud &&
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME &&
    env.R2_PUBLIC_URL
  ) {
    return {
      kind: "r2",
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET_NAME,
      publicBaseUrl: env.R2_PUBLIC_URL,
    };
  }
  if (env.NODE_ENV !== "production" || env.UPLOAD_DIR) return { kind: "local", root: localUploadDir(env, cwd) };
  return {
    kind: "unavailable",
    problem: "production has neither the R2 variables nor an UPLOAD_DIR on a persistent volume",
  };
}

/** The local store's directory, which /uploads serves (in every mode, for images stored before R2). */
export function localUploadDir(env: Pick<AppEnv, "UPLOAD_DIR">, cwd: string = process.cwd()): string {
  return path.resolve(cwd, env.UPLOAD_DIR ?? "uploads");
}

/** Images on this machine's disk under `root`, served by the app at /uploads (routes/uploads-static.ts). */
export function createLocalDiskStore(root: string): ImageStore {
  const base = path.resolve(root);
  return {
    kind: "local",
    async put(key, body) {
      const file = path.resolve(base, ...key.split("/"));
      if (!VALID_KEY.test(key) || !file.startsWith(base + path.sep)) throw new Error(`Refusing to store image key ${JSON.stringify(key)}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body, { flag: "wx" });
    },
    publicUrl: (key) => `/uploads/${key}`,
    owns: (url) => url.startsWith("/uploads/") && !url.split("/").includes(".."),
    describe: () => `local disk at ${base}`,
  };
}

/** The part of S3Client this store uses, so tests can record the commands instead of sending them. */
export interface ObjectWriter {
  send(command: PutObjectCommand): Promise<unknown>;
}

/** Images in a Cloudflare R2 bucket, served from its public URL (an r2.dev address or a custom domain). */
export function createR2Store(client: ObjectWriter, bucket: string, publicBaseUrl: string): ImageStore {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return {
    kind: "r2",
    async put(key, body) {
      if (!VALID_KEY.test(key)) throw new Error(`Refusing to store image key ${JSON.stringify(key)}`);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: IMAGE_CONTENT_TYPE,
          CacheControl: IMAGE_CACHE_CONTROL,
        }),
      );
    },
    publicUrl: (key) => `${base}/${key}`,
    owns: (url) => url.startsWith(`${base}/`),
    describe: () => `Cloudflare R2 bucket "${bucket}", served from ${new URL(base).origin}`,
  };
}

function storeFromConfig(config: Exclude<ImageStoreConfig, { kind: "unavailable" }>): ImageStore {
  if (config.kind === "local") return createLocalDiskStore(config.root);
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return createR2Store(client, config.bucket, config.publicBaseUrl);
}

// One store per env object (the env is frozen, so a new config is a new object).
const stores = new WeakMap<AppEnv, ImageStore | null>();

/**
 * The store for this configuration, or null when production has none (uploads then answer 503).
 * The first call per configuration logs which store is in use, so the boot log shows it.
 */
export function imageStoreFor(env: AppEnv): ImageStore | null {
  if (stores.has(env)) return stores.get(env) ?? null;
  const config = imageStoreConfig(env);
  if (config.kind === "unavailable") {
    stores.set(env, null);
    console.error(`Image storage is not configured: ${config.problem}. Image uploads answer 503 until it is.`);
    return null;
  }
  const store = storeFromConfig(config);
  stores.set(env, store);
  if (env.NODE_ENV !== "test") console.log(`Image storage: ${store.describe()}`);
  return store;
}

/** Whether `url` is an image in this configuration's store, e.g. before a row is pointed at it. */
export function ownsImageUrl(env: AppEnv, url: string): boolean {
  return imageStoreFor(env)?.owns(url) ?? false;
}
