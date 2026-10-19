/**
 * POST /api/images/:kind, the image pipeline behind it, and GET /uploads/*, on the local disk store.
 * UPLOAD_DIR points at a temporary directory (emptied before every test, deleted at the end) before
 * the app is first built, so the repo's own uploads/ is never touched.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import session from "express-session";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ImageUploadResponse } from "@shared/api/images";
import { HEIC_MESSAGE, imageVariantsFromUrl, MAX_IMAGE_UPLOAD_BYTES, UNSUPPORTED_TYPE_MESSAGE } from "@shared/domain/images";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { createUser, FACTORY_PASSWORD } from "../factories/users";
import { getApp, resetDb, signIn, type SignedIn } from "../helpers";
import {
  CONTENT_TYPES,
  heicHeader,
  jpegOfSize,
  pngClaiming,
  redBlueHalves,
  solidImage,
  SVG_IMAGE,
  truncatedJpeg,
  type FixtureFormat,
} from "../helpers/images";

let uploadDir: string;

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "pokerpal-images-test-"));
  process.env.UPLOAD_DIR = uploadDir;
});

afterAll(async () => {
  delete process.env.UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  for (const entry of await readdir(uploadDir)) await rm(path.join(uploadDir, entry), { recursive: true, force: true });
});

/** Every file the app has stored, relative to UPLOAD_DIR. */
async function storedFiles(): Promise<string[]> {
  const entries = await readdir(uploadDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(uploadDir, path.join(entry.parentPath, entry.name)))
    .sort();
}

interface UploadOptions {
  filename?: string;
  contentType?: string;
  crop?: string;
}

function attach(call: request.Test, image: Buffer, { filename = "photo.png", contentType = "image/png", crop }: UploadOptions = {}) {
  const withCrop = crop === undefined ? call : call.field("crop", crop);
  return withCrop.attach("image", image, { filename, contentType });
}

async function uploadAnonymously(kind: string, image: Buffer, options?: UploadOptions) {
  return attach(request(await getApp()).post(`/api/images/${kind}`), image, options);
}

function uploadAs(user: SignedIn, kind: string, image: Buffer, options?: UploadOptions) {
  return attach(user.agent.post(`/api/images/${kind}`), image, options);
}

/** Fetch a stored variant back through /uploads and decode it. */
async function fetchStored(url: string) {
  const response = await request(await getApp()).get(url);
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toBe("image/webp");
  return { response, metadata: await sharp(response.body as Buffer).metadata() };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

describe("POST /api/images/:kind", () => {
  it("takes a player photo without signing in, and stores every avatar size as WebP", async () => {
    const response = await uploadAnonymously("player_avatar", await solidImage(1024, 768, "jpeg"), {
      filename: "Jane Smith passport.jpg",
      contentType: "image/jpeg",
    });

    expect(response.status).toBe(201);
    const body = response.body as ImageUploadResponse;
    expect(Object.keys(body).sort()).toEqual(["dominantColor", "height", "kind", "url", "variants", "width"]);
    expect(body).toMatchObject({ kind: "player_avatar", width: 512, height: 512 });
    expect(body.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(body.url).toMatch(new RegExp(`^/uploads/player_avatar/${UUID}/512\\.webp$`));
    expect(body.variants).toEqual(imageVariantsFromUrl(body.url));
    expect(Object.keys(body.variants)).toEqual(["48", "96", "256", "512"]);
    // Only the variants are stored: no original, and no trace of the file's name.
    expect(await storedFiles()).toEqual(Object.values(body.variants).map((url) => url.replace("/uploads/", "")).sort());
    for (const [width, url] of Object.entries(body.variants)) {
      const { metadata } = await fetchStored(url);
      expect(metadata).toMatchObject({ format: "webp", width: Number(width), height: Number(width) });
    }
  });

  it.each(["club_logo", "club_banner", "tournament_banner"])("needs a signed-in user for a %s and stores nothing otherwise", async (kind) => {
    const response = await uploadAnonymously(kind, await solidImage(64, 64));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required", code: "UNAUTHENTICATED" });
    expect(await storedFiles()).toEqual([]);
  });

  it.each([
    ["club_logo", 2400, 1200, 1024, 512],
    ["club_banner", 2400, 1200, 1920, 640],
    ["tournament_banner", 2400, 1200, 1600, 900],
  ])("cuts a %s for a signed-in user", async (kind, width, height, storedWidth, storedHeight) => {
    const user = await signIn();

    const response = await uploadAs(user, kind, await solidImage(width, height));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ kind, width: storedWidth, height: storedHeight });
    const { metadata } = await fetchStored(response.body.url);
    expect([metadata.width, metadata.height]).toEqual([storedWidth, storedHeight]);
  });

  it("keeps the part of the image the crop field selects", async () => {
    const image = await redBlueHalves(400, 200);

    const left = await uploadAnonymously("player_avatar", image, { crop: JSON.stringify({ x: 0, y: 0, width: 0.5, height: 1 }) });
    const right = await uploadAnonymously("player_avatar", image, { crop: '{"x":0.5,"y":0,"width":0.5,"height":1}' });

    expect([left.status, right.status]).toEqual([201, 201]);
    expect(left.body.dominantColor).toBe("#dc2828");
    expect(right.body.dominantColor).toBe("#1e3ce6");
  });

  it.each([
    ["not JSON", "{x:0"],
    ["outside the image", '{"x":0.6,"y":0,"width":0.6,"height":1}'],
    ["missing a side", '{"x":0,"y":0,"width":1}'],
  ])("refuses a crop that is %s, and stores nothing", async (_label, crop) => {
    const response = await uploadAnonymously("player_avatar", await solidImage(40, 40), { crop });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid crop", code: "VALIDATION" });
    expect(await storedFiles()).toEqual([]);
  });

  it.each(["avatar", "players", "__proto__", "constructor", "..%2F..%2Fescaped", "PLAYER_AVATAR"])(
    "refuses the kind %s before reading the upload, and stores nothing",
    async (kind) => {
      const response = await uploadAnonymously(kind, await solidImage(16, 16));

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "Unknown image kind", code: "VALIDATION" });
      expect(await storedFiles()).toEqual([]);
    },
  );

  it("refuses a request without a file", async () => {
    const response = await request(await getApp()).post("/api/images/player_avatar").field("crop", "");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "No file uploaded", code: "NO_FILE" });
  });

  it("refuses a file sent under another field name", async () => {
    const response = await request(await getApp())
      .post("/api/images/player_avatar")
      .attach("file", await solidImage(16, 16), { filename: "a.png", contentType: "image/png" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The upload is malformed", code: "VALIDATION" });
  });

  it.each(Object.keys(CONTENT_TYPES) as FixtureFormat[])("accepts %s", async (format) => {
    const response = await uploadAnonymously("player_avatar", await solidImage(64, 64, format), {
      filename: `photo.${format}`,
      contentType: CONTENT_TYPES[format],
    });

    expect(response.status).toBe(201);
  });

  it("goes by the file's bytes, not its label: a PNG sent as a JPEG is fine", async () => {
    const response = await uploadAnonymously("player_avatar", await solidImage(64, 64, "png"), { contentType: "image/jpeg" });

    expect(response.status).toBe(201);
  });

  it.each([
    ["a declared HEIC photo", Buffer.from("anything"), "image/heic", "UNSUPPORTED_MEDIA_TYPE", HEIC_MESSAGE],
    ["HEIC bytes labelled as a JPEG", heicHeader(), "image/jpeg", "UNSUPPORTED_MEDIA_TYPE", HEIC_MESSAGE],
    ["a declared SVG", SVG_IMAGE, "image/svg+xml", "UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_TYPE_MESSAGE],
    ["an SVG labelled as a PNG", SVG_IMAGE, "image/png", "INVALID_IMAGE", expect.stringMatching(/^That file isn't an image we can read/)],
    ["text labelled as a PNG", Buffer.from("definitely not a picture"), "image/png", "INVALID_IMAGE", expect.stringMatching(/^That file isn't/)],
  ])("refuses %s with 415, and stores nothing", async (_label, bytes, contentType, code, error) => {
    const response = await uploadAnonymously("player_avatar", bytes, { contentType });

    expect(response.status).toBe(415);
    expect(response.body).toEqual({ error, code });
    expect(await storedFiles()).toEqual([]);
  });

  it("refuses a damaged file with 415 instead of storing it half grey", async () => {
    const response = await uploadAnonymously("player_avatar", await truncatedJpeg(), { contentType: "image/jpeg" });

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: "We couldn't read that image; the file may be damaged. Please try another picture.",
      code: "INVALID_IMAGE",
    });
    expect(await storedFiles()).toEqual([]);
  });

  it("refuses a decompression bomb with 413 from its header alone", async () => {
    const bomb = pngClaiming(30_000, 30_000);
    expect(bomb.length).toBeLessThan(200);

    const response = await uploadAnonymously("player_avatar", bomb);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: "That image is too large (over 40 megapixels). Please choose a smaller picture.",
      code: "FILE_TOO_LARGE",
    });
    expect(await storedFiles()).toEqual([]);
  });

  it("accepts exactly 5 MiB and refuses a byte more with 413", async () => {
    const atLimit = await uploadAnonymously("player_avatar", await jpegOfSize(MAX_IMAGE_UPLOAD_BYTES), { contentType: "image/jpeg" });
    const over = await uploadAnonymously("player_avatar", await jpegOfSize(MAX_IMAGE_UPLOAD_BYTES + 1), { contentType: "image/jpeg" });

    expect(atLimit.status).toBe(201);
    expect(over.status).toBe(413);
    expect(over.body).toEqual({ error: "That file is too large: images can be at most 5 MB.", code: "FILE_TOO_LARGE" });
  });
});

describe("rate limits on anonymous uploads", () => {
  async function limitedApp() {
    const env = loadEnv(process.env);
    return createApp({ env, sessionStore: new session.MemoryStore(), rateLimits: { enabled: true, limits: { publicWrite: 2 } } });
  }

  it("counts anonymous player photos against the visitor's public-write budget, then answers 429", async () => {
    const app = await limitedApp();
    const image = await solidImage(16, 16);
    const post = () => attach(request(app).post("/api/images/player_avatar"), image);

    expect([(await post()).status, (await post()).status]).toEqual([201, 201]);
    const limited = await post();

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many requests from this network, please try again later.", code: "RATE_LIMITED" });
    expect(await storedFiles()).toHaveLength(2);
  });

  it("gives a signed-in user a bucket of their own rather than none (SEC-P2-02), and never counts anonymous attempts at kinds that need a sign-in", async () => {
    const app = await limitedApp();
    const image = await solidImage(16, 16);
    const user = await createUser();
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: user.email, password: FACTORY_PASSWORD })).status).toBe(200);

    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await attach(agent.post("/api/images/club_logo"), image)).status).toBe(201);
      expect((await attach(request(app).post("/api/images/club_logo"), image)).status).toBe(401);
    }
    expect((await attach(agent.post("/api/images/club_logo"), image)).status).toBe(429);
    expect((await attach(request(app).post("/api/images/player_avatar"), image)).status).toBe(201);
  });

  it("caps uploads per signed-in user on every upload route, the legacy one included", async () => {
    const env = loadEnv(process.env);
    const app = await createApp({ env, sessionStore: new session.MemoryStore(), rateLimits: { enabled: true, limits: { upload: 1 } } });
    const image = await solidImage(16, 16);
    const user = await createUser();
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: user.email, password: FACTORY_PASSWORD })).status).toBe(200);

    expect((await attach(agent.post("/api/images/club_logo"), image)).status).toBe(201);
    expect((await attach(agent.post("/api/upload"), image).field("entityType", "clubs")).status).toBe(429);
  });
});

describe("production without image storage", () => {
  it("answers uploads with 503 before reading them, and never falls back to the container's disk", async () => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: "production",
      USE_CLOUD_STORAGE: "",
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET_NAME: "",
      R2_PUBLIC_URL: "",
      UPLOAD_DIR: "",
    });
    const app = await createApp({ env, sessionStore: new session.MemoryStore() });
    const image = await solidImage(16, 16);
    const unavailable = { error: "Image uploads are not available on this server right now.", code: "STORAGE_UNAVAILABLE" };

    for (const route of ["/api/images/player_avatar", "/api/upload/public"]) {
      const response = await attach(request(app).post(route), image);
      expect(response.status).toBe(503);
      expect(response.body).toEqual(unavailable);
    }
    expect(await storedFiles()).toEqual([]);
  });
});

describe("GET /uploads/*", () => {
  it("serves stored images for a year (their names never change), without touching a session", async () => {
    const user = await signIn();
    const uploaded = await uploadAs(user, "club_logo", await solidImage(100, 100));

    const served = await user.agent.get(uploaded.body.url);

    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect(served.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(served.headers["set-cookie"]).toBeUndefined();
  });

  it.each(["/uploads/player_avatar/missing/512.webp", "/uploads/", "/uploads/player_avatar"])(
    "answers a JSON 404 for %s, never the app's index.html",
    async (url) => {
      const response = await request(await getApp()).get(url);

      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expect(response.body).toMatchObject({ code: "NOT_FOUND" });
    },
  );
});
