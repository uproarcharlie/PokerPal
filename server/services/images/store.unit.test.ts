import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../config/env";
import {
  createLocalDiskStore,
  createR2Store,
  IMAGE_CACHE_CONTROL,
  imageStoreConfig,
  imageStoreFor,
  localUploadDir,
  ownsImageUrl,
  type ObjectWriter,
} from "./store";

const DATABASE_URL = "postgres://app@localhost:5432/pokerpal";
const R2 = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "key-id",
  R2_SECRET_ACCESS_KEY: "very-secret-value",
  R2_BUCKET_NAME: "pokerpal-images",
  R2_PUBLIC_URL: "https://images.example.com/",
};
const PRODUCTION = { DATABASE_URL, NODE_ENV: "production", SESSION_SECRET: "x" };
const KEY = "player_avatar/0b9e7c2a-5d1f-4c3e-9a8b-7f6e5d4c3b2a/48.webp";
const CWD = "/srv/app";

describe("imageStoreConfig", () => {
  it("uses local disk outside production, under ./uploads unless UPLOAD_DIR says otherwise", () => {
    expect(imageStoreConfig(loadEnv({ DATABASE_URL }), CWD)).toEqual({ kind: "local", root: "/srv/app/uploads" });
    expect(imageStoreConfig(loadEnv({ DATABASE_URL, UPLOAD_DIR: "data/img" }), CWD)).toEqual({ kind: "local", root: "/srv/app/data/img" });
    expect(imageStoreConfig(loadEnv({ DATABASE_URL, UPLOAD_DIR: "/mnt/images" }), CWD)).toEqual({ kind: "local", root: "/mnt/images" });
  });

  it("uses R2 outside production only when asked to, even with credentials present", () => {
    expect(imageStoreConfig(loadEnv({ DATABASE_URL, ...R2 }), CWD).kind).toBe("local");
    expect(imageStoreConfig(loadEnv({ DATABASE_URL, ...R2, USE_CLOUD_STORAGE: "true" }), CWD)).toEqual({
      kind: "r2",
      accountId: "acct",
      accessKeyId: "key-id",
      secretAccessKey: "very-secret-value",
      bucket: "pokerpal-images",
      publicBaseUrl: "https://images.example.com",
    });
  });

  it("uses R2 in production whenever it is configured, whatever USE_CLOUD_STORAGE says", () => {
    expect(imageStoreConfig(loadEnv({ ...PRODUCTION, ...R2, USE_CLOUD_STORAGE: "false" }), CWD).kind).toBe("r2");
    expect(imageStoreConfig(loadEnv({ ...PRODUCTION, ...R2, UPLOAD_DIR: "/data" }), CWD).kind).toBe("r2");
  });

  it("never falls back to the container's disk in production: local only with an explicit UPLOAD_DIR", () => {
    expect(imageStoreConfig(loadEnv(PRODUCTION), CWD)).toEqual({
      kind: "unavailable",
      problem: "production has neither the R2 variables nor an UPLOAD_DIR on a persistent volume",
    });
    expect(imageStoreConfig(loadEnv({ ...PRODUCTION, UPLOAD_DIR: "/data/uploads" }), CWD)).toEqual({ kind: "local", root: "/data/uploads" });
  });

  it("serves /uploads from the same directory the local store writes to", () => {
    expect(localUploadDir({ UPLOAD_DIR: undefined }, CWD)).toBe("/srv/app/uploads");
    expect(localUploadDir({ UPLOAD_DIR: "../shared" }, CWD)).toBe("/srv/shared");
  });
});

describe("the local disk store", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pokerpal-store-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a key under its root and serves it from /uploads", async () => {
    const store = createLocalDiskStore(root);

    await store.put(KEY, Buffer.from("webp bytes"));

    expect(await readFile(path.join(root, KEY), "utf8")).toBe("webp bytes");
    expect(store.publicUrl(KEY)).toBe(`/uploads/${KEY}`);
    expect(store.describe()).toBe(`local disk at ${root}`);
  });

  it("never overwrites a stored file", async () => {
    const store = createLocalDiskStore(root);
    await store.put(KEY, Buffer.from("first"));

    await expect(store.put(KEY, Buffer.from("second"))).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path.join(root, KEY), "utf8")).toBe("first");
  });

  it.each(["../escaped.webp", "player_avatar/../../x/1.webp", "players/photo.webp", "/etc/passwd"])(
    "refuses the key %s and writes nothing",
    async (key) => {
      await expect(createLocalDiskStore(root).put(key, Buffer.from("x"))).rejects.toThrow(/Refusing to store image key/);
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("owns /uploads paths only", () => {
    const store = createLocalDiskStore(root);

    expect(store.owns(`/uploads/${KEY}`)).toBe(true);
    expect(store.owns("/uploads/players/image-1-2.webp")).toBe(true);
    for (const url of ["/uploads/../secrets", "https://images.example.com/x.webp", "/elsewhere/a.webp"]) {
      expect(store.owns(url)).toBe(false);
    }
  });
});

describe("the R2 store", () => {
  function recordingClient() {
    const sent: PutObjectCommand[] = [];
    const client: ObjectWriter = {
      send: async (command) => {
        sent.push(command);
        return {};
      },
    };
    return { client, sent };
  }

  it("uploads each object as immutable WebP, never with a user-supplied name", async () => {
    const { client, sent } = recordingClient();
    const store = createR2Store(client, "pokerpal-images", "https://images.example.com/");

    await store.put(KEY, Buffer.from("webp bytes"));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent[0].input).toEqual({
      Bucket: "pokerpal-images",
      Key: KEY,
      Body: Buffer.from("webp bytes"),
      ContentType: "image/webp",
      CacheControl: IMAGE_CACHE_CONTROL,
    });
    expect(IMAGE_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    await expect(store.put("clubs/../../x.webp", Buffer.from("x"))).rejects.toThrow(/Refusing to store image key/);
    expect(sent).toHaveLength(1);
  });

  it("serves from the public URL (never the S3 API host) and owns only that", () => {
    const store = createR2Store(recordingClient().client, "pokerpal-images", "https://cdn.example.com/img/");

    expect(store.publicUrl(KEY)).toBe(`https://cdn.example.com/img/${KEY}`);
    expect(store.owns(`https://cdn.example.com/img/${KEY}`)).toBe(true);
    expect(store.owns(`https://cdn.example.com/other/${KEY}`)).toBe(false);
    expect(store.owns(`/uploads/${KEY}`)).toBe(false);
    expect(store.describe()).toBe('Cloudflare R2 bucket "pokerpal-images", served from https://cdn.example.com');
  });
});

describe("imageStoreFor", () => {
  it("makes one store per configuration and says which, without secrets", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env = loadEnv({ DATABASE_URL, ...R2, USE_CLOUD_STORAGE: "true" });

    const store = imageStoreFor(env);

    expect(store?.kind).toBe("r2");
    expect(imageStoreFor(env)).toBe(store);
    expect(log.mock.calls).toEqual([['Image storage: Cloudflare R2 bucket "pokerpal-images", served from https://images.example.com']]);
    expect(ownsImageUrl(env, `https://images.example.com/${KEY}`)).toBe(true);
    log.mockRestore();
  });

  it("has no store in production without R2 or UPLOAD_DIR, and says so once, loudly", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = loadEnv(PRODUCTION);

    expect(imageStoreFor(env)).toBeNull();
    expect(imageStoreFor(env)).toBeNull();
    expect(ownsImageUrl(env, `/uploads/${KEY}`)).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(/^Image storage is not configured: .*Image uploads answer 503 until it is\.$/);
    error.mockRestore();
  });

  it("logs nothing for a test configuration", () => {
    const log = vi.spyOn(console, "log");

    expect(imageStoreFor(loadEnv({ DATABASE_URL, NODE_ENV: "test" }))?.kind).toBe("local");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
