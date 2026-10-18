/**
 * Characterization tests for image uploads as they behave today:
 * POST /api/upload (signed in) and POST /api/upload/public (the QR
 * self-registration flow), in local-disk mode (USE_CLOUD_STORAGE=false).
 *
 * Local mode writes to `uploads/` under the working directory, so this file
 * runs from a temporary directory that is emptied before every test and
 * deleted at the end; the repo's own uploads/ is never touched. getApp() is
 * first called after the switch, so the app's `/uploads` static handler
 * serves the temporary directory too.
 *
 * Known bugs from the audit are written as the behaviour we want, wrapped in
 * `it.fails` and tagged with the finding id. They pass while the bug is there;
 * once it is fixed they fail, and `.fails` must be removed.
 */
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import session from "express-session";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { getApp, resetDb, signIn, type SignedIn } from "../helpers";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const INVALID_TYPE_MESSAGE = "Invalid file type. Only JPEG, PNG, GIF and WebP images are allowed.";

const originalCwd = process.cwd();
/** Temporary root; the app runs in its `app` subdirectory, so escapes from uploads/ stay inside it. */
let workRoot: string;
let workDir: string;

beforeAll(async () => {
  workRoot = await mkdtemp(path.join(os.tmpdir(), "pokerpal-uploads-test-"));
  workDir = path.join(workRoot, "app");
  await mkdir(workDir);
  process.chdir(workDir);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(workRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  // The working directory itself must survive: the process is sitting in it.
  for (const entry of await readdir(workDir)) await rm(path.join(workDir, entry), { recursive: true, force: true });
  for (const entry of await readdir(workRoot)) {
    if (entry !== "app") await rm(path.join(workRoot, entry), { recursive: true, force: true });
  }
});

/** Everything the app has written, as paths relative to the temporary root (e.g. `app/uploads/players/x.webp`). */
async function writtenPaths(): Promise<string[]> {
  return (await readdir(workRoot, { recursive: true })).filter((entry) => entry !== "app").sort();
}

type Format = "png" | "jpeg" | "gif" | "webp";

/** A solid-colour image (with an alpha channel when `alpha` is set). */
function solidImage(width: number, height: number, format: Format = "png", alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 220, g: 40, b: 40, alpha: 0.5 } : { r: 220, g: 40, b: 40 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

/** A three-frame animated GIF. */
async function animatedGif(): Promise<Buffer> {
  const frames = await Promise.all(
    [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }].map((background) =>
      sharp({ create: { width: 40, height: 30, channels: 3, background } }).png().toBuffer(),
    ),
  );
  return sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100], loop: 0 }).toBuffer();
}

/** A 200x100 JPEG whose EXIF says "rotate 90° clockwise to display", plus a copyright tag. */
function rotatedJpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 100, channels: 3, background: "#808080" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "Test Photographer" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** A valid JPEG padded with trailing bytes (which decoders ignore) to exactly `size` bytes. */
async function jpegOfSize(size: number): Promise<Buffer> {
  const jpeg = await solidImage(64, 64, "jpeg");
  return Buffer.concat([jpeg, Buffer.alloc(size - jpeg.length)]);
}

const CONTENT_TYPES: Record<Format, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

interface UploadOptions {
  entityType?: string;
  filename?: string;
  contentType?: string;
}

function attach(call: request.Test, image: Buffer, { entityType, filename = "photo.png", contentType = "image/png" }: UploadOptions) {
  const withField = entityType === undefined ? call : call.field("entityType", entityType);
  return withField.attach("image", image, { filename, contentType });
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

const STORED_URL = /^\/uploads\/(players|clubs|tournaments|misc)\/image-\d+-\d+\.webp$/;

describe("POST /api/upload", () => {
  it("requires a signed-in user and stores nothing otherwise", async () => {
    const response = await attach(request(await getApp()).post("/api/upload"), await solidImage(20, 20), {
      entityType: "players",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect(await writtenPaths()).toEqual([]);
  });

  it("refuses a request without a file", async () => {
    const user = await signIn();

    const response = await user.agent.post("/api/upload").field("entityType", "players");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "No file uploaded" });
    expect(await writtenPaths()).toEqual([]);
  });

  it.each(["players", "clubs", "tournaments"])(
    "re-encodes the image as WebP under uploads/%s/ and serves it back",
    async (entityType) => {
      const user = await signIn();

      const response = await uploadAs(user, await solidImage(64, 48), { entityType, filename: "My Photo (1).png" });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toEqual(["imageUrl"]);
      const { imageUrl } = response.body as { imageUrl: string };
      expect(imageUrl).toMatch(STORED_URL);
      expect(imageUrl.startsWith(`/uploads/${entityType}/`)).toBe(true);
      // The file on disk gets a server-chosen name; the original filename is not used.
      expect(await writtenPaths()).toEqual(["app/uploads", `app/uploads/${entityType}`, `app${imageUrl}`]);
      const { metadata } = await fetchStored(imageUrl);
      expect(metadata).toMatchObject({ format: "webp", width: 64, height: 48 });
    },
  );

  it("files an upload without an entityType under misc", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(10, 10));

    expect(response.status).toBe(200);
    expect(response.body.imageUrl).toMatch(/^\/uploads\/misc\/image-\d+-\d+\.webp$/);
  });

  it.each([
    ["players", 512],
    ["clubs", 1600],
    ["tournaments", 1600],
    ["misc", 1200],
  ])("shrinks %s images to at most %ipx on the longest edge, keeping the aspect ratio", async (entityType, longestEdge) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(2400, 1200), { entityType });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect([metadata.width, metadata.height]).toEqual([longestEdge, longestEdge / 2]);
  });

  it("never enlarges a small image", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(30, 300), { entityType: "clubs" });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect([metadata.width, metadata.height]).toEqual([30, 300]);
  });

  it("applies the EXIF orientation and strips the metadata", async () => {
    const user = await signIn();
    const original = await rotatedJpegWithExif();
    expect(await sharp(original).metadata()).toMatchObject({ width: 200, height: 100, orientation: 6, exif: expect.any(Buffer) });

    const response = await uploadAs(user, original, { entityType: "players", filename: "photo.jpg", contentType: "image/jpeg" });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect([metadata.width, metadata.height]).toEqual([100, 200]);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("keeps transparency", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(40, 40, "png", true), { entityType: "clubs" });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect(metadata.hasAlpha).toBe(true);
  });

  it("keeps every frame of an animated GIF", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await animatedGif(), {
      entityType: "clubs",
      filename: "spin.gif",
      contentType: "image/gif",
    });

    const { metadata } = await fetchStored(response.body.imageUrl);
    expect(metadata).toMatchObject({ format: "webp", pages: 3, delay: [100, 100, 100], width: 40, height: 30 });
  });

  it.each(Object.keys(CONTENT_TYPES) as Format[])("accepts %s files", async (format) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(16, 16, format), {
      entityType: "players",
      filename: `photo.${format}`,
      contentType: CONTENT_TYPES[format],
    });

    expect(response.status).toBe(200);
    expect(response.body.imageUrl).toMatch(STORED_URL);
  });

  it("accepts a file of exactly 5 MiB", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await jpegOfSize(MAX_UPLOAD_BYTES), {
      entityType: "players",
      filename: "big.jpg",
      contentType: "image/jpeg",
    });

    expect(response.status).toBe(200);
  });

  // Today these are refused with 500; the it.fails tests below pin the status codes they should get.
  it.each(["text/plain", "image/svg+xml", "image/heic", "application/octet-stream"])(
    "refuses a file declared as %s and stores nothing",
    async (contentType) => {
      const user = await signIn();

      const response = await uploadAs(user, await solidImage(16, 16), { entityType: "players", contentType });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(response.body)).toContain(INVALID_TYPE_MESSAGE);
      expect(await writtenPaths()).toEqual([]);
    },
  );

  it("refuses a file over 5 MiB and stores nothing", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await jpegOfSize(MAX_UPLOAD_BYTES + 1), {
      entityType: "players",
      filename: "huge.jpg",
      contentType: "image/jpeg",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toHaveProperty("imageUrl");
    expect(await writtenPaths()).toEqual([]);
  });

  it("refuses bytes that are not an image, whatever the declared type, and stores nothing", async () => {
    const user = await signIn();

    const response = await uploadAs(user, Buffer.from("<?php echo 'definitely not a picture'; ?>"), {
      entityType: "players",
      filename: "photo.png",
      contentType: "image/png",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toHaveProperty("imageUrl");
    expect(await writtenPaths()).toEqual([]);
  });

  // Known bug BUG-18 / img-21: multer's file-type rejection is a plain Error, so the error handler answers 500.
  it.fails("answers 415 for a file type that is not allowed (BUG-18, img-21)", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(16, 16), { entityType: "players", contentType: "text/plain" });

    expect(response.status).toBe(415);
  });

  // Known bug BUG-18 / img-20: multer's LIMIT_FILE_SIZE error carries no status, so the error handler answers 500.
  it.fails("answers 413 for a file over 5 MiB (BUG-18, img-20)", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await jpegOfSize(MAX_UPLOAD_BYTES + 1), {
      entityType: "players",
      contentType: "image/jpeg",
    });

    expect(response.status).toBe(413);
  });

  // Known bug img-23: only the declared mimetype is checked; sharp then fails to decode and the route answers 500.
  it.fails("answers 415 for bytes that are not an image (img-23)", async () => {
    const user = await signIn();

    const response = await uploadAs(user, Buffer.from("definitely not a picture"), {
      entityType: "players",
      contentType: "image/png",
    });

    expect(response.status).toBe(415);
  });

  // Known bug SEC-15 / img-05: entityType goes straight into path.join, so "../x" writes outside uploads/.
  it.fails("never writes outside uploads/, whatever entityType says (SEC-15, img-05)", async () => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(16, 16), { entityType: "../escaped" });

    // Filed inside uploads/, or refused; a server error that writes nothing is no fix.
    expect(response.status).toBeLessThan(500);
    if (response.status === 200) expect(response.body.imageUrl).toMatch(STORED_URL);
    for (const written of await writtenPaths()) expect(written).toMatch(/^app\/uploads(\/|$)/);
  });

  // Known bug SEC-15 / img-05: the size lookup reads MAX_DIMENSION[entityType], so "__proto__" makes sharp throw (500).
  it.fails.each(["__proto__", "constructor"])("handles entityType %j without a server error (SEC-15, img-05)", async (entityType) => {
    const user = await signIn();

    const response = await uploadAs(user, await solidImage(16, 16), { entityType });

    expect(response.status).toBeLessThan(500);
  });
});

describe("POST /api/upload/public", () => {
  it("needs no sign-in and always files the image as a player photo, at most 512px", async () => {
    const response = await uploadPublic(await solidImage(1024, 768), { entityType: "clubs" });

    expect(response.status).toBe(200);
    expect(response.body.imageUrl).toMatch(/^\/uploads\/players\/image-\d+-\d+\.webp$/);
    const { metadata } = await fetchStored(response.body.imageUrl);
    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 384 });
  });

  it("refuses a request without a file", async () => {
    const response = await request(await getApp()).post("/api/upload/public");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "No file uploaded" });
  });

  it("applies the same file-type allowlist and stores nothing", async () => {
    const response = await uploadPublic(await solidImage(16, 16), { contentType: "image/svg+xml" });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toContain(INVALID_TYPE_MESSAGE);
    expect(await writtenPaths()).toEqual([]);
  });

  it("allows 50 requests per IP in 15 minutes, counting failures, then answers 429", async () => {
    // An app of its own, so the limiter starts at zero and other tests keep their budget.
    const app = await createApp({ env: loadEnv(process.env), sessionStore: new session.MemoryStore() });

    for (let attempt = 1; attempt <= 50; attempt++) {
      const response = await request(app).post("/api/upload/public");
      expect(response.status).toBe(400);
      expect(response.headers["ratelimit-remaining"]).toBe(String(50 - attempt));
    }
    const limited = await request(app).post("/api/upload/public");

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many uploads, please try again later." });
    expect(limited.headers["ratelimit-limit"]).toBe("50");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });
});
