import { imageVariantsFromUrl } from "@shared/domain/images";

/** A stored image URL, or null for none: the API and old rows use both null and "" for "no image". */
export function storedImageUrl(value: string | null | undefined): string | null {
  const url = value?.trim();
  return url ? url : null;
}

export interface ImageSources {
  src: string;
  /** Every stored width, for the browser to choose from; absent for an image stored before variants. */
  srcSet?: string;
}

/**
 * The <img> sources for a stored image. A new upload (`<kind>/<uuid>/<width>.webp`) has a variant for
 * each width up to the stored one, so the browser can fetch a 96 px avatar instead of the 512 px one;
 * a legacy URL (or a local preview) is used as it is.
 */
export function imageSources(url: string): ImageSources {
  const variants = imageVariantsFromUrl(url);
  if (!variants) return { src: url };
  const entries = Object.entries(variants)
    .map(([width, variantUrl]) => [Number(width), variantUrl] as const)
    .sort(([a], [b]) => a - b);
  if (entries.length < 2) return { src: url };
  return { src: url, srcSet: entries.map(([width, variantUrl]) => `${variantUrl} ${width}w`).join(", ") };
}
