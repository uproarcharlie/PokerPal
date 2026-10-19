/**
 * Image fixtures for the upload tests, built in memory with sharp (nothing is read from disk), plus
 * hand-made headers for the files sharp must never be asked to decode: a pixel bomb and a HEIC photo.
 * Import it by path (`test/helpers/images`); it needs no database.
 */
import { deflateSync } from "node:zlib";
import sharp from "sharp";

export type FixtureFormat = "png" | "jpeg" | "gif" | "webp" | "avif";

export const CONTENT_TYPES: Record<FixtureFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

const RED = { r: 220, g: 40, b: 40 };
const BLUE = { r: 30, g: 60, b: 230 };

/** A solid red image (half-transparent with `alpha`). */
export function solidImage(width: number, height: number, format: FixtureFormat = "png", alpha = false): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { ...RED, alpha: 0.5 } : RED },
  })
    .toFormat(format)
    .toBuffer();
}

/** Red on the left half, blue on the right: shows which part a crop kept. */
export async function redBlueHalves(width: number, height: number, format: FixtureFormat = "png"): Promise<Buffer> {
  const red = await sharp({ create: { width: Math.floor(width / 2), height, channels: 3, background: RED } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: BLUE } })
    .composite([{ input: red, left: 0, top: 0 }])
    .toFormat(format)
    .toBuffer();
}

/** A red square in the middle of a fully transparent PNG: a logo on no background. */
export async function logoOnTransparent(size = 100): Promise<Buffer> {
  const mark = await sharp({ create: { width: size / 2, height: size / 2, channels: 4, background: { ...RED, alpha: 1 } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: size / 4, top: size / 4 }])
    .png()
    .toBuffer();
}

/**
 * A 200×100 JPEG stored sideways: left half red, right half blue, EXIF orientation 6 ("rotate 90°
 * clockwise to display"), so upright it is 100×200 with red on top. Carries a copyright tag too.
 */
export async function sidewaysJpeg(): Promise<Buffer> {
  return sharp(await redBlueHalves(200, 100))
    .jpeg()
    .withExif({ IFD0: { Copyright: "Test Photographer" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** A three-frame animated GIF. */
export async function animatedGif(): Promise<Buffer> {
  const frames = await Promise.all(
    [RED, { r: 0, g: 255, b: 0 }, BLUE].map((background) =>
      sharp({ create: { width: 40, height: 30, channels: 3, background } }).png().toBuffer(),
    ),
  );
  return sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100], loop: 0 }).toBuffer();
}

/** The first half of a noisy JPEG: decoders that tolerate truncation render the rest grey. */
export async function truncatedJpeg(): Promise<Buffer> {
  const whole = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 30 } },
  })
    .jpeg()
    .toBuffer();
  return whole.subarray(0, Math.floor(whole.length / 2));
}

/** A valid JPEG padded with trailing bytes (which decoders ignore) to exactly `size` bytes. */
export async function jpegOfSize(size: number): Promise<Buffer> {
  const jpeg = await solidImage(64, 64, "jpeg");
  return Buffer.concat([jpeg, Buffer.alloc(size - jpeg.length)]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A tiny, well-formed PNG header claiming `width × height` RGB pixels: a decompression bomb as far as
 * any decoder that trusts the header can tell. Its pixel data is a few zero bytes, never decoded.
 */
export function pngClaiming(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.alloc(16))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The start of an iPhone HEIC photo (its `ftyp` box), which is all the server ever looks at. */
export function heicHeader(): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftypheic", 4, "latin1");
  box.write("mif1heic", 16, "latin1");
  return Buffer.concat([box, Buffer.alloc(64)]);
}

/** A small SVG: sharp would rasterise it with librsvg, so it must be refused before decoding. */
export const SVG_IMAGE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
);
