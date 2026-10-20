/**
 * Gets a picked photo ready to upload, in the browser: phones take 12-50 MP photos, often over the
 * server's 5 MB limit, and iPhones save HEIC, which the server cannot read. A photo the server can take
 * as it is goes unchanged; anything else is decoded (Safari reads HEIC), turned upright and redrawn at
 * no more than MAX_UPLOAD_SIDE px, as JPEG (PNG for logos, which keep their transparency). Once a
 * picture is framed, `cropForUpload` sends only the framed part, at the size the server keeps.
 */
import {
  ACCEPTED_IMAGE_TYPES,
  HEIC_IMAGE_TYPES,
  HEIC_MESSAGE,
  MAX_IMAGE_UPLOAD_BYTES,
  UNSUPPORTED_TYPE_MESSAGE,
  imageKindSpec,
  type CropFractions,
  type ImageKind,
} from "@shared/domain/images";

/** The longest side sent to the server; its largest stored variant is 1920 px. */
export const MAX_UPLOAD_SIDE = 2048;

export const UNREADABLE_IMAGE_MESSAGE = "That picture could not be read. Please choose a JPEG or PNG photo.";
export const TOO_LARGE_MESSAGE = "That picture is too large to upload. Please choose a smaller one.";

/** A picked file that cannot be uploaded, with the sentence to show. */
export class ImagePrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePrepareError";
  }
}

const ACCEPTED: ReadonlySet<string> = new Set(ACCEPTED_IMAGE_TYPES);
const HEIC: ReadonlySet<string> = new Set(HEIC_IMAGE_TYPES);
const JPEG_QUALITY = 0.9;

function isHeic(file: File): boolean {
  return HEIC.has(file.type.toLowerCase()) || /\.hei[cf]$/i.test(file.name);
}

interface Decoded {
  bitmap: ImageBitmap;
  /** Whether the bitmap honours the photo's orientation (EXIF), as the browser shows it. */
  upright: boolean;
}

/**
 * The picture decoded, or null when this browser cannot read it. Browsers before Chrome 112, Firefox
 * 111 and Safari 16 (iPhones held on iOS 15) refuse the "from-image" option with a TypeError
 * (IMG-P3-01), so it is asked for again without it; such a bitmap may ignore the photo's orientation.
 */
async function decode(image: Blob): Promise<Decoded | null> {
  try {
    return { bitmap: await createImageBitmap(image, { imageOrientation: "from-image" }), upright: true };
  } catch {
    try {
      return { bitmap: await createImageBitmap(image), upright: false };
    } catch {
      return null;
    }
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
}

interface Draw {
  /** The part of the bitmap to draw, in its pixels (default: all of it). */
  source?: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  type: string;
}

/**
 * `bitmap` (or its `source` part) drawn at `width` x `height` and encoded as `type`. Shrunk with the
 * browser's best resampling: its default ("low", plain bilinear) leaves jagged edges and moire when a
 * 24-48 MP photo is reduced several times over (IMG-P3-02). A JPEG has no transparency, so the canvas
 * is white first, as the server flattens pictures it keeps without transparency (IMG-P3-03); a
 * transparent canvas would come out black.
 */
async function draw(bitmap: ImageBitmap, { source, width, height, type }: Draw): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const from = source ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  context.drawImage(bitmap, from.x, from.y, from.width, from.height, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas, type);
}

/** The bitmap redrawn so its longest side is at most `side`. */
function redraw(bitmap: ImageBitmap, side: number, type: string): Promise<Blob | null> {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  return draw(bitmap, { width: bitmap.width * scale, height: bitmap.height * scale, type });
}

const outputType = (kind: ImageKind) => (imageKindSpec(kind).alpha ? "image/png" : "image/jpeg");

/** The file to upload for `kind`, or an ImagePrepareError saying why this one cannot be. */
export async function prepareImage(file: File, kind: ImageKind): Promise<Blob> {
  const type = file.type.toLowerCase();
  const heic = isHeic(file);
  if (!heic && type !== "" && !type.startsWith("image/")) throw new ImagePrepareError(UNSUPPORTED_TYPE_MESSAGE);
  const sendable = !heic && ACCEPTED.has(type);

  const decoded = typeof createImageBitmap === "function" ? await decode(file) : null;
  // No decoder, or one that cannot read this picture (an AVIF on a browser without AVIF): the server
  // decodes, turns upright and checks pictures itself, so one it takes is sent as it is.
  if (!decoded) {
    if (heic) throw new ImagePrepareError(HEIC_MESSAGE);
    if (!sendable) throw new ImagePrepareError(typeof createImageBitmap === "function" ? UNREADABLE_IMAGE_MESSAGE : UNSUPPORTED_TYPE_MESSAGE);
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new ImagePrepareError(TOO_LARGE_MESSAGE);
    return file;
  }
  const { bitmap, upright } = decoded;
  try {
    const fits = Math.max(bitmap.width, bitmap.height) <= MAX_UPLOAD_SIDE;
    // Redrawn only when it must be: a bitmap that may ignore the photo's orientation would turn it.
    if (sendable && (fits || !upright) && file.size <= MAX_IMAGE_UPLOAD_BYTES) return file;

    // A PNG of a detailed logo can still be large at full size: try smaller before giving up.
    for (const side of [MAX_UPLOAD_SIDE, 1536, 1024]) {
      const blob = await redraw(bitmap, side, outputType(kind));
      if (!blob) break;
      if (blob.size <= MAX_IMAGE_UPLOAD_BYTES) return blob;
    }
    throw new ImagePrepareError(TOO_LARGE_MESSAGE);
  } finally {
    bitmap.close();
  }
}

/**
 * Only the framed part of a prepared picture, at most as wide as the largest size the server keeps
 * for `kind` (a player photo: 512 px), so a QR sign-up on the venue's Wi-Fi sends tens of kilobytes,
 * not a whole 2048 px photo (P3REV4-PERF-05). The server stores it as it is (it is already the
 * kind's shape); null when this browser cannot redraw it, and then the picture goes with `crop`.
 */
export async function cropForUpload(image: Blob, kind: ImageKind, crop: CropFractions): Promise<Blob | null> {
  const spec = imageKindSpec(kind);
  if (spec.aspect === null || typeof createImageBitmap !== "function") return null;
  const aspect = spec.aspect;
  const decoded = await decode(image);
  if (!decoded) return null;
  const { bitmap, upright } = decoded;
  try {
    // The frame was drawn over the picture as the browser shows it, upright.
    if (!upright) return null;
    const source = {
      x: crop.x * bitmap.width,
      y: crop.y * bitmap.height,
      width: crop.width * bitmap.width,
      height: crop.height * bitmap.height,
    };
    // Exactly the largest variant's width when the framed part is at least that wide (the server
    // keeps every size that fits without enlarging), else the framed part's own size.
    const width = Math.min(Math.round(source.width), spec.variants[spec.variants.length - 1]);
    const blob = await draw(bitmap, { source, width, height: width / aspect, type: outputType(kind) });
    return blob && blob.size <= MAX_IMAGE_UPLOAD_BYTES ? blob : null;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
