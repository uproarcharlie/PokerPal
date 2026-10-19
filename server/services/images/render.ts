import sharp, { type OutputInfo } from "sharp";
import {
  HEIC_MESSAGE,
  imageKindSpec,
  imageRegion,
  imageVariantPlan,
  MAX_IMAGE_PIXELS,
  type CropFractions,
  type ImageKind,
  type VariantSize,
} from "@shared/domain/images";
import { HttpError } from "../../http/errors";
import { sniffImageFormat, type SniffedFormat } from "./sniff";

export interface RenderedVariant extends VariantSize {
  /** The variant as WebP, with no metadata (EXIF, GPS and colour profiles are dropped). */
  body: Buffer;
}

export interface RenderedImage {
  /** Smallest first; the last is the canonical image. */
  variants: RenderedVariant[];
  /** "#rrggbb" of the most common opaque colour, or null for a fully transparent image. */
  dominantColor: string | null;
}

export interface RenderLimits {
  /** Decoded pixels allowed (width × height): a small file can otherwise decode to gigabytes. */
  maxPixels: number;
}

/**
 * Decoding is bounded: EXIF orientation applied, only the first frame of an animation, input over
 * `maxPixels` refused from its header, and a truncated or corrupt file refused instead of rendered
 * half grey. ('warning', sharp's default, would also refuse phone photos with harmless quirks.)
 */
const decodeOptions = (limits: RenderLimits) =>
  ({ autoOrient: true, animated: false, failOn: "error", limitInputPixels: limits.maxPixels }) as const;

const WEBP = { quality: 82, smartSubsample: true } as const;

/** The format sharp reports for each format we accept (AVIF is HEIF with AV1 compression). */
const SHARP_FORMAT: Record<Exclude<SniffedFormat, "heic">, string> = {
  jpeg: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  avif: "heif",
};

const notAnImage = () =>
  new HttpError(415, "INVALID_IMAGE", "That file isn't an image we can read. Please choose a JPEG, PNG, WebP, GIF or AVIF picture.");

function decodeFailure(error: unknown, limits: RenderLimits): HttpError {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/pixel limit/i.test(message)) {
    return new HttpError(
      413,
      "FILE_TOO_LARGE",
      `That image is too large (over ${Math.floor(limits.maxPixels / 1e6)} megapixels). Please choose a smaller picture.`,
    );
  }
  console.warn(`Image decode failed: ${message}`);
  return new HttpError(415, "INVALID_IMAGE", "We couldn't read that image; the file may be damaged. Please try another picture.");
}

/** 503 while the renderer's queue is full. */
export const renderBusy = () =>
  new HttpError(503, "SERVICE_UNAVAILABLE", "Too many pictures are being processed right now. Please try again in a moment.");

/**
 * At most `max` tasks at once and `maxWaiting` more in line; anything past that is refused at once
 * (503), so a burst of uploads cannot pile up buffers in memory. A slot passes straight to the next
 * waiter, so a newcomer can never overtake the queue.
 */
export function concurrencyLimit(max: number, maxWaiting: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const run = async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else if (waiting.length >= maxWaiting) throw renderBusy();
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  return { run, full: () => active >= max && waiting.length >= maxWaiting };
}

/**
 * Rendering is CPU- and memory-heavy and reachable without signing in, so only two run at a time and
 * at most 16 wait (each holds its upload, at most 5 MB, until its turn).
 */
const renderSlot = concurrencyLimit(2, 16);

/** Whether a new upload would be refused for now: the routes check before reading the body. */
export const renderQueueFull = (): boolean => renderSlot.full();

/**
 * Renders an upload to every variant of its kind: decode (bounded, see decodeOptions), cut the kind's
 * region (the crop, then the kind's aspect), resize once to the largest variant, then derive the
 * smaller ones from that. Throws HttpError 415 for anything that is not a JPEG, PNG, GIF, WebP or
 * AVIF by its own bytes (HEIC with its own message), and 413 for too many pixels.
 */
export async function renderImage(
  input: Buffer,
  kind: ImageKind,
  crop?: CropFractions,
  limits: RenderLimits = { maxPixels: MAX_IMAGE_PIXELS },
): Promise<RenderedImage> {
  const format = sniffImageFormat(input);
  if (format === "heic") throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", HEIC_MESSAGE);
  if (format === null) throw notAnImage();
  return renderSlot.run(() => render(input, format, kind, crop, limits));
}

async function render(
  input: Buffer,
  format: Exclude<SniffedFormat, "heic">,
  kind: ImageKind,
  crop: CropFractions | undefined,
  limits: RenderLimits,
): Promise<RenderedImage> {
  const decode = decodeOptions(limits);
  let plan: VariantSize[];
  let master: { data: Buffer; info: OutputInfo };
  try {
    const metadata = await sharp(input, decode).metadata();
    const width = metadata.autoOrient?.width ?? metadata.width;
    const height = metadata.autoOrient?.height ?? metadata.height;
    if (metadata.format !== SHARP_FORMAT[format] || !width || !height) throw notAnImage();

    const region = imageRegion(kind, width, height, crop);
    plan = imageVariantPlan(kind, region);
    const largest = plan[plan.length - 1];
    const cut = sharp(input, decode).extract(region).resize(largest.width, largest.height, { fit: "fill" });
    const opaque = imageKindSpec(kind).alpha ? cut : cut.flatten({ background: "#ffffff" });
    master = await opaque.toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw decodeFailure(error, limits);
  }

  const raw = { width: master.info.width, height: master.info.height, channels: master.info.channels };
  const variants = await Promise.all(
    plan.map(async (size) => ({
      ...size,
      body: await sharp(master.data, { raw }).resize(size.width, size.height, { fit: "fill" }).webp(WEBP).toBuffer(),
    })),
  );
  const thumbnail = await sharp(master.data, { raw })
    .resize(64, 64, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // sRGB from toColourspace above: three channels, or four with alpha.
  return { variants, dominantColor: dominantColour(thumbnail.data, thumbnail.info.channels === 4 ? 4 : 3) };
}

const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");

/**
 * The most common colour of raw sRGB pixels (`channels` 3, or 4 with alpha), ignoring (mostly)
 * transparent ones, as "#rrggbb": pixels are binned 16 levels per channel and the busiest bin's
 * average is returned. Null when no pixel is opaque. (sharp's own `stats().dominant` counts
 * transparent pixels, so a logo on a transparent background would always come out black.)
 */
export function dominantColour(pixels: Uint8Array, channels: 3 | 4): string | null {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (let offset = 0; offset + channels <= pixels.length; offset += channels) {
    if (channels === 4 && pixels[offset + 3] < 128) continue;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = counts.get(bin) ?? { n: 0, r: 0, g: 0, b: 0 };
    entry.n++;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    counts.set(bin, entry);
    if (!best || entry.n > best.n) best = entry;
  }
  return best ? `#${hex(best.r / best.n)}${hex(best.g / best.n)}${hex(best.b / best.n)}` : null;
}
