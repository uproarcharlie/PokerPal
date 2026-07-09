import sharp from "sharp";

// Longest-edge cap per entity. Player photos are shown as small avatars, so they
// can be capped tighter; club/tournament images are used as larger banners/cards.
const MAX_DIMENSION: Record<string, number> = {
  players: 512,
  clubs: 1600,
  tournaments: 1600,
};

const DEFAULT_MAX_DIMENSION = 1200;

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

/**
 * Normalise an uploaded image: auto-orient from EXIF, downscale to a sane max
 * dimension (never upscaling), and re-encode as high-quality WebP. This keeps
 * originals from being stored at multi-megapixel sizes and gives consistent,
 * crisp images without relying on any CDN transform.
 */
export async function processImage(
  input: Buffer,
  entityType: string,
): Promise<ProcessedImage> {
  const maxDimension = MAX_DIMENSION[entityType] ?? DEFAULT_MAX_DIMENSION;

  const buffer = await sharp(input, { animated: true, failOn: "none" })
    .rotate() // apply EXIF orientation, then strip it
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toBuffer();

  return { buffer, contentType: "image/webp", ext: "webp" };
}
