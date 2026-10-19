import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { HEIC_MESSAGE } from "@shared/domain/images";
import {
  animatedGif,
  heicHeader,
  logoOnTransparent,
  pngClaiming,
  redBlueHalves,
  sidewaysJpeg,
  solidImage,
  SVG_IMAGE,
  truncatedJpeg,
  type FixtureFormat,
} from "../../../test/helpers/images";
import { HttpError } from "../../http/errors";
import { concurrencyLimit, dominantColour, renderImage } from "./render";

const decoded = (body: Buffer) => sharp(body).metadata();

const RED = "#dc2828";
const BLUE = "#1e3ce6";

/** "#rrggbb" within a few levels per channel of `expected` (JPEG shifts colours slightly). */
function expectColourNear(actual: string | null, expected: string) {
  const channels = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  expect(actual).toMatch(/^#[0-9a-f]{6}$/);
  const differences = channels(actual ?? "").map((value, index) => Math.abs(value - channels(expected)[index]));
  expect(Math.max(...differences), `${actual} vs ${expected}`).toBeLessThanOrEqual(6);
}

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("renderImage", () => {
  it("cuts a 4:3 photo to a centred square and renders each avatar size it can fill as WebP", async () => {
    const { variants } = await renderImage(await solidImage(400, 300, "jpeg"), "player_avatar");

    expect(variants.map(({ variant, width, height }) => [variant, width, height])).toEqual([
      [48, 48, 48],
      [96, 96, 96],
      [256, 256, 256],
    ]);
    for (const { body, width } of variants) {
      expect(await decoded(body)).toMatchObject({ format: "webp", width, height: width });
    }
  });

  it("never enlarges a small image: one variant at the image's own size", async () => {
    const { variants } = await renderImage(await solidImage(30, 40), "player_avatar");

    expect(variants.map(({ variant, width, height }) => [variant, width, height])).toEqual([[48, 30, 30]]);
  });

  it("keeps a logo's shape and transparency, and finds its colour on a transparent background", async () => {
    const wide = await renderImage(await solidImage(600, 200, "png", true), "club_logo");
    const logo = await renderImage(await logoOnTransparent(), "club_logo");

    expect(wide.variants.at(-1)).toMatchObject({ variant: 512, width: 512, height: 171 });
    expect(await decoded(wide.variants[0].body)).toMatchObject({ hasAlpha: true, width: 64, height: 21 });
    expect(logo.dominantColor).toBe(RED);
  });

  it("flattens transparency onto white for every kind but logos", async () => {
    const { variants } = await renderImage(await logoOnTransparent(), "player_avatar");

    expect(await decoded(variants[0].body)).toMatchObject({ hasAlpha: false });
  });

  it.each([
    ["club_banner", [640, 1280], [640, 213]],
    ["tournament_banner", [800], [800, 450]],
  ] as const)("cuts a %s to its aspect", async (kind, widths, [smallestWidth, smallestHeight]) => {
    const { variants } = await renderImage(await solidImage(1500, 1500), kind);

    expect(variants.map(({ variant }) => variant)).toEqual(widths);
    expect(variants[0]).toMatchObject({ width: smallestWidth, height: smallestHeight });
  });

  it("turns the photo upright before cropping, and keeps no EXIF", async () => {
    const original = await sidewaysJpeg();
    expect(await decoded(original)).toMatchObject({ width: 200, height: 100, orientation: 6, exif: expect.any(Buffer) });

    // Upright, the photo is 100 × 200 with its red half on top.
    const top = await renderImage(original, "club_logo", { x: 0, y: 0, width: 1, height: 0.5 });
    const bottom = await renderImage(original, "club_logo", { x: 0, y: 0.5, width: 1, height: 0.5 });

    expectColourNear(top.dominantColor, RED);
    expectColourNear(bottom.dominantColor, BLUE);
    const metadata = await decoded(top.variants[0].body);
    expect(metadata).toMatchObject({ width: 64, height: 64 });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("applies the client's crop", async () => {
    const image = await redBlueHalves(400, 200);

    const left = await renderImage(image, "player_avatar", { x: 0, y: 0, width: 0.5, height: 1 });
    const right = await renderImage(image, "player_avatar", { x: 0.5, y: 0, width: 0.5, height: 1 });

    expect(left.dominantColor).toBe(RED);
    expect(right.dominantColor).toBe(BLUE);
    expect(right.variants.at(-1)).toMatchObject({ variant: 96, width: 96, height: 96 });
  });

  it("keeps only the first frame of an animation", async () => {
    const { variants, dominantColor } = await renderImage(await animatedGif(), "club_logo");

    expect((await decoded(variants[0].body)).pages ?? 1).toBe(1);
    expectColourNear(dominantColor, RED);
  });

  it.each(["png", "jpeg", "gif", "webp", "avif"] as FixtureFormat[])("reads %s", async (format) => {
    const { variants } = await renderImage(await solidImage(64, 64, format), "player_avatar");

    expect(variants).toHaveLength(1);
  });

  it.each([
    ["text", Buffer.from("definitely not a picture")],
    ["an SVG", SVG_IMAGE],
    ["nothing", Buffer.alloc(0)],
  ])("refuses %s as 415 INVALID_IMAGE without decoding it", async (_label, bytes) => {
    const decode = vi.spyOn(sharp.prototype, "metadata");

    const error = await refusal(renderImage(bytes, "player_avatar"));

    expect([error.status, error.code]).toEqual([415, "INVALID_IMAGE"]);
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it("refuses a HEIC photo with a message saying what to do", async () => {
    const error = await refusal(renderImage(heicHeader(), "player_avatar"));

    expect([error.status, error.code, error.message]).toEqual([415, "UNSUPPORTED_MEDIA_TYPE", HEIC_MESSAGE]);
  });

  it("refuses a truncated file instead of rendering it half grey", async () => {
    const error = await refusal(renderImage(await truncatedJpeg(), "player_avatar"));

    expect([error.status, error.code]).toEqual([415, "INVALID_IMAGE"]);
    expect(error.message).toMatch(/may be damaged/);
  });

  it("refuses bytes that only start like a PNG", async () => {
    const fake = Buffer.concat([pngClaiming(10, 10).subarray(0, 8), Buffer.from("garbage after the signature")]);

    const error = await refusal(renderImage(fake, "player_avatar"));

    expect([error.status, error.code]).toEqual([415, "INVALID_IMAGE"]);
  });

  it("refuses a decompression bomb from its header, as 413", async () => {
    const error = await refusal(renderImage(pngClaiming(20_000, 20_000), "player_avatar"));

    expect([error.status, error.code]).toEqual([413, "FILE_TOO_LARGE"]);
    expect(error.message).toBe("That image is too large (over 40 megapixels). Please choose a smaller picture.");
  });

  it("takes a lower pixel limit", async () => {
    const error = await refusal(renderImage(await solidImage(2000, 1000), "player_avatar", undefined, { maxPixels: 1_000_000 }));

    expect(error.message).toMatch(/over 1 megapixels/);
  });

  it("renders uploads that arrive together", async () => {
    const images = await Promise.all([1, 2, 3, 4, 5].map((n) => solidImage(60 + n, 60)));

    const rendered = await Promise.all(images.map((image) => renderImage(image, "player_avatar")));

    expect(rendered.map(({ variants }) => variants[0].width)).toEqual([48, 48, 48, 48, 48]);
  });
});

describe("dominantColour", () => {
  it("is the average of the busiest colour bin", () => {
    const pixels = Uint8Array.from([10, 20, 30, 12, 22, 28, 200, 0, 0]);

    expect(dominantColour(pixels, 3)).toBe("#0b151d");
  });

  it("ignores mostly transparent pixels, and is null when nothing is opaque", () => {
    const pixels = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 10, 250, 250, 250, 255]);

    expect(dominantColour(pixels, 4)).toBe("#fafafa");
    expect(dominantColour(Uint8Array.from([5, 5, 5, 0]), 4)).toBeNull();
  });
});

describe("concurrencyLimit (the renderer's queue, SEC-P2-02)", () => {
  it("runs `max` at once, queues `maxWaiting` more in order, and refuses the rest at once with 503", async () => {
    const limit = concurrencyLimit(1, 1);
    let release!: () => void;
    const order: string[] = [];
    const first = limit.run(() => new Promise<void>((resolve) => (release = resolve)).then(() => order.push("first")));
    const second = limit.run(async () => order.push("second"));

    expect(limit.full()).toBe(true);
    await expect(limit.run(async () => order.push("third"))).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });

    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    expect(limit.full()).toBe(false);
  });
});
