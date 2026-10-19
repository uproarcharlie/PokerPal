/**
 * The legacy upload routes: POST /api/upload (signed in, `entityType` picks the kind) and
 * POST /api/upload/public (the QR self-registration photo), now aliases of POST /api/images/:kind on
 * the local disk store. Today's client no longer calls them (it posts to /api/images/:kind); they stay
 * for browsers still running the previous bundle during a deploy, and for the e2e smoke and
 * anonymous-API checks, and can go in Phase 3. They answer 200 with `imageUrl` (the canonical
 * variant) beside the new fields. The pipeline itself is covered in images.api.test.ts and
 * server/services/images/.
 *
 * UPLOAD_DIR is `<temporary root>/uploads`, set before the app is first built; the root is emptied
 * before every test and deleted at the end, so anything written outside uploads/ would show up in
 * writtenPaths() and the repo's own uploads/ is never touched.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import session from "express-session";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LegacyUploadResponse } from "@shared/api/images";
import { HEIC_MESSAGE, imageVariantsFromUrl, MAX_IMAGE_UPLOAD_BYTES, UNSUPPORTED_TYPE_MESSAGE } from "@shared/domain/images";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { getApp, resetDb, signIn, type SignedIn } from "../helpers";
import { animatedGif, CONTENT_TYPES, jpegOfSize, sidewaysJpeg, solidImage, type FixtureFormat } from "../helpers/images";

/** The app writes only under `<workRoot>/uploads`. */
let workRoot: string;

beforeAll(async () => {
  workRoot = await mkdtemp(path.join(os.tmpdir(), "pokerpal-uploads-test-"));
  process.env.UPLOAD_DIR = path.join(workRoot, "uploads");
});

afterAll(async () => {
  delete process.env.UPLOAD_DIR;
  await rm(workRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  for (const entry of await readdir(workRoot)) await rm(path.join(workRoot, entry), { recursive: true, force: true });
});

/** Every file the app has written, relative to the temporary root (e.g. `uploads/player_avatar/<id>/48.webp`). */
async function writtenPaths(): Promise<string[]> {
  const entries = await readdir(workRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(workRoot, path.join(entry.parentPath, entry.name)))
    .sort();
}

interface UploadOptions {
  entityType?: string | string[];
  filename?: string;
  contentType?: string;
}

function attach(call: request.Test, image: Buffer, { entityType, filename = "photo.png", contentType = "image/png" }: UploadOptions) {
  const types = entityType === undefined ? [] : [entityType].flat();
  const withFields = types.reduce((pending, type) => pending.field("entityType", type), call);
  return withFields.attach("image", image, { filename, contentType });
}

function uploadAs(user: SignedIn, image: Buffer, options: UploadOptions = {}) {
  return attach(user.agent.post("/api/upload"), image, options);
}

async function uploadPublic(image: Buffer, options: UploadOptions = {}) {
  return attach(request(await getApp()).post("/api/upload/public"), image, options);
}

/** Fetch an uploaded image back through the app's /uploads handler and decode it. */
async function fetchStored(imageUrl: string) {
  const response = await request(await getApp()).get(imageUrl);
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toBe("image/webp");
  const body = response.body as Buffer;
  return { body, metadata: await sharp(body).metadata() };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const storedUrl = (kind: string) => new RegExp(`^/uploads/${kind}/${UUID}/\\d+\\.webp$`);

describe("POST /api/upload", () => {
  it("requires a signed-in user and stores nothing otherwise", async () => {
    const response = await attach(request(await getApp()).post("/api/upload"), await solidImage(20, 20), {
      entityType: "players",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required", code: "UNAUTHENTICATED" });
    expect(await writtenPaths()).toEqual([]);
  });

  it("refuses a request without a file", async () => {
    const user = await signIn();

    const response = await user.agent.post("/api/upload").field("entityType", "players");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "No file uploaded", code: "NO_FILE" });
    expect(await writtenPaths()).toEqual([]);
  });

  it.each([
    ["players", "player_avatar"],
    ["clubs", "club_logo"],
    ["tournaments", "tournament_banner"],
  ])("files an upload for %s as a %s, with imageUrl beside the new fields", async (entityType, kind) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(64, 48), { entityType, filename: "My Photo (1).png" });

    expect(response.status).toBe(200);
    const body = response.body as LegacyUploadResponse;
    expect(Object.keys(body).sort()).toEqual(["dominantColor", "height", "imageUrl", "kind", "url", "variants", "width"]);
    expect(body.kind).toBe(kind);
    expect(body.imageUrl).toBe(body.url);
    expect(body.imageUrl).toMatch(storedUrl(kind));
    expect(body.variants).toEqual(imageVariantsFromUrl(body.imageUrl));
    // Only server-chosen names are written; the original filename is never used.
    expect(await writtenPaths()).toEqual(Object.values(body.variants).map((url) => url.slice(1)).sort());
    const { metadata } = await fetchStored(body.imageUrl);
    expect(metadata).toMatchObject({ format: "webp", width: body.width, height: body.height });
  });

  it.each([
    ["players", 512, 512],
    ["clubs", 1024, 512],
    ["tournaments", 1600, 900],
  ])("cuts a large %s image to its kind: %ix%i", async (entityType, width, height) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(2400, 1200), { entityType });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect([metadata.width, metadata.height]).toEqual([width, height]);
  });

  it("never enlarges a small image", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(30, 20), { entityType: "clubs" });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect([metadata.width, metadata.height]).toEqual([30, 20]);
  });

  it("applies the EXIF orientation and strips the metadata", async () => {
    const user = await signIn();
    const original = await sidewaysJpeg();
    expect(await sharp(original).metadata()).toMatchObject({ width: 200, height: 100, orientation: 6, exif: expect.any(Buffer) });

    const response = await uploadAs(user, original, { entityType: "clubs", filename: "photo.jpg", contentType: "image/jpeg" });

    // Upright the photo is 100 × 200: portrait, so its largest logo variant (a 128 px box) is 64 × 128.
    const { metadata } = await fetchStored(response.body.imageUrl);
    expect([metadata.width, metadata.height]).toEqual([64, 128]);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("keeps a club logo's transparency", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(40, 40, "png", true), { entityType: "clubs" });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect(metadata.hasAlpha).toBe(true);
  });

  it("stores only the first frame of an animated GIF", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await animatedGif(), { entityType: "clubs", filename: "spin.gif", contentType: "image/gif" });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect(metadata).toMatchObject({ format: "webp", width: 40, height: 30 });
    expect(metadata.pages ?? 1).toBe(1);
  });

  it.each(Object.keys(CONTENT_TYPES) as FixtureFormat[])("accepts %s files", async (format) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(16, 16, format), {
      entityType: "players",
      filename: `photo.${format}`,
      contentType: CONTENT_TYPES[format],
    });

    expect(response.status).toBe(200);
    expect(response.body.imageUrl).toMatch(storedUrl("player_avatar"));
  });

  it("accepts a file of exactly 5 MiB", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await jpegOfSize(MAX_IMAGE_UPLOAD_BYTES), {
      entityType: "players",
      filename: "big.jpg",
      contentType: "image/jpeg",
    });

    expect(response.status).toBe(200);
  });

  it.each(["text/plain", "image/svg+xml", "application/octet-stream", "image/tiff"])(
    "refuses a file declared as %s with 415 and stores nothing (BUG-18, img-21)",
    async (contentType) => {
      const user = await signIn();

      const response = await uploadAs(user, await solidImage(16, 16), { entityType: "players", contentType });

      expect(response.status).toBe(415);
      expect(response.body).toEqual({ error: UNSUPPORTED_TYPE_MESSAGE, code: "UNSUPPORTED_MEDIA_TYPE" });
      expect(await writtenPaths()).toEqual([]);
    },
  );

  it.each(["image/heic", "image/heif"])("refuses a %s photo with 415 and says what to do instead", async (contentType) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(16, 16), { entityType: "players", contentType });

    expect(response.status).toBe(415);
    expect(response.body).toEqual({ error: HEIC_MESSAGE, code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("answers 413 for a file over 5 MiB and stores nothing (BUG-18, img-20)", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await jpegOfSize(MAX_IMAGE_UPLOAD_BYTES + 1), {
      entityType: "players",
      filename: "huge.jpg",
      contentType: "image/jpeg",
    });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "That file is too large: images can be at most 5 MB.", code: "FILE_TOO_LARGE" });
    expect(await writtenPaths()).toEqual([]);
  });

  it("answers 415 for bytes that are not an image, whatever the declared type, and stores nothing (img-23)", async () => {
    const user = await signIn();

    const response = await uploadAs(user, Buffer.from("<?php echo 'definitely not a picture'; ?>"), {
      entityType: "players",
      contentType: "image/png",
    });

    expect(response.status).toBe(415);
    expect(response.body).toMatchObject({ code: "INVALID_IMAGE" });
    expect(await writtenPaths()).toEqual([]);
  });

  it.each([
    ["../escaped", "../escaped"],
    ["__proto__", "__proto__"],
    ["constructor", "constructor"],
    ["misc", "misc"],
    ["a repeated field", ["players", "clubs"]],
    ["no entityType", undefined],
  ])("refuses %s as the entityType with 400, writing nothing anywhere (SEC-15, img-05)", async (_label, entityType) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(16, 16), { entityType });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Unknown entityType: use players, clubs or tournaments", code: "VALIDATION" });
    expect(await writtenPaths()).toEqual([]);
  });
});

describe("POST /api/upload/public", () => {
  it("needs no sign-in and always files the image as a player photo, at most 512px square", async () => {
    const response = await uploadPublic(await solidImage(1024, 768), { entityType: "clubs" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: "player_avatar", width: 512, height: 512 });
    expect(response.body.imageUrl).toMatch(storedUrl("player_avatar"));
    const { metadata } = await fetchStored(response.body.imageUrl);
    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 512 });
  });

  it("refuses a request without a file", async () => {
    const response = await request(await getApp()).post("/api/upload/public");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "No file uploaded", code: "NO_FILE" });
  });

  it("applies the same file-type allowlist and stores nothing", async () => {
    const response = await uploadPublic(await solidImage(16, 16), { contentType: "image/svg+xml" });

    expect(response.status).toBe(415);
    expect(response.body).toEqual({ error: UNSUPPORTED_TYPE_MESSAGE, code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(await writtenPaths()).toEqual([]);
  });

  it("counts every anonymous request, failures included, against the visitor's public-write budget", async () => {
    // An app of its own with a small budget, so the count starts at zero.
    const app = await createApp({
      env: loadEnv(process.env),
      sessionStore: new session.MemoryStore(),
      rateLimits: { enabled: true, limits: { publicWrite: 3 } },
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await request(app).post("/api/upload/public")).status).toBe(400);
    }
    const limited = await request(app).post("/api/upload/public");

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many requests from this network, please try again later.", code: "RATE_LIMITED" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });
});
