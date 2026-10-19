/**
 * The kinds of image the app stores, and how each is cut. PURE data and geometry shared by the upload
 * endpoint (which validates `:kind` against it and renders the variants) and the client image
 * components (which pick a variant for the size they draw, and preview a crop with the same maths).
 */

export interface ImageKindSpec {
  /** Width / height the stored image is cropped to; null keeps the uploaded shape. */
  aspect: number | null;
  /** cover crops to `aspect`; contain fits inside it and never crops (logos). */
  fit: "cover" | "contain";
  /**
   * The WebP variants, smallest first, by nominal width in px. A cover variant is exactly that wide;
   * a contain variant fits inside a square of that size. The largest one stored is the canonical `url`.
   */
  variants: readonly number[];
  /** Keeps transparency (logos on brand tiles); other kinds are flattened onto white. */
  alpha: boolean;
  /** May be uploaded without signing in (the QR register page's player photo). */
  publicUpload: boolean;
}

export const IMAGE_KINDS = Object.freeze({
  player_avatar: { aspect: 1, fit: "cover", variants: [48, 96, 256, 512], alpha: false, publicUpload: true },
  // 1024 keeps the logo sharp where today's pages still draw it as a wide card header.
  club_logo: { aspect: null, fit: "contain", variants: [64, 128, 256, 512, 1024], alpha: true, publicUpload: false },
  club_banner: { aspect: 3, fit: "cover", variants: [640, 1280, 1920], alpha: false, publicUpload: false },
  tournament_banner: { aspect: 16 / 9, fit: "cover", variants: [800, 1600], alpha: false, publicUpload: false },
} as const satisfies Record<string, ImageKindSpec>);

export type ImageKind = keyof typeof IMAGE_KINDS;

export const IMAGE_KIND_NAMES = Object.keys(IMAGE_KINDS) as ImageKind[];

export function isImageKind(value: unknown): value is ImageKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(IMAGE_KINDS, value);
}

export function imageKindSpec(kind: ImageKind): ImageKindSpec {
  return IMAGE_KINDS[kind];
}

/** The legacy `entityType` form field of POST /api/upload, mapped to the kind it now means. */
export const LEGACY_ENTITY_KINDS = Object.freeze({
  players: "player_avatar",
  clubs: "club_logo",
  tournaments: "tournament_banner",
} as const satisfies Record<string, ImageKind>);

export type LegacyEntityType = keyof typeof LEGACY_ENTITY_KINDS;

/** The largest upload accepted, before any processing. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The most pixels a decoded upload may have (a 5 MiB file can otherwise decode to gigabytes). */
export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * The declared types an upload may have: the file picker's `accept` list and the server's first check.
 * The server then decides by the file's own bytes, never by this label.
 */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;

/** iPhone and Android HEIF photos: sharp's prebuilt decoder cannot read HEVC, so these are refused clearly. */
export const HEIC_IMAGE_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"] as const;

export const UNSUPPORTED_TYPE_MESSAGE = "Invalid file type. Only JPEG, PNG, GIF, WebP and AVIF images are allowed.";
export const HEIC_MESSAGE =
  "HEIC photos can't be uploaded yet. Please choose a JPEG or PNG instead, or use Take Photo.";

/** A rectangle in whole pixels. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Part of an image as fractions (0-1) of its width and height, so it does not depend on preview size. */
export interface CropFractions {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * The part of a `width × height` image (already turned upright) that a kind keeps: the crop if one
 * is given, clamped to the image; then, for cover kinds, trimmed equally from both sides of the
 * longer dimension to the kind's aspect. Without a crop a cover kind keeps the centre.
 */
export function imageRegion(kind: ImageKind, width: number, height: number, crop?: CropFractions): PixelRect {
  let region: PixelRect = { left: 0, top: 0, width, height };
  if (crop) {
    const left = clamp(Math.round(crop.x * width), 0, width - 1);
    const top = clamp(Math.round(crop.y * height), 0, height - 1);
    region = {
      left,
      top,
      width: clamp(Math.round(crop.width * width), 1, width - left),
      height: clamp(Math.round(crop.height * height), 1, height - top),
    };
  }

  const { aspect } = imageKindSpec(kind);
  if (aspect === null) return region;
  if (region.width / region.height > aspect) {
    const trimmed = Math.max(1, Math.round(region.height * aspect));
    return { ...region, left: region.left + Math.floor((region.width - trimmed) / 2), width: trimmed };
  }
  const trimmed = Math.max(1, Math.round(region.width / aspect));
  return { ...region, top: region.top + Math.floor((region.height - trimmed) / 2), height: trimmed };
}

/** One variant to render: its nominal width (its key) and its actual size in px. */
export interface VariantSize {
  variant: number;
  width: number;
  height: number;
}

/**
 * The variants a region is rendered to, smallest first. Every nominal width the region can fill
 * without enlarging; a region smaller than the smallest variant gets that one variant at its own size.
 * So the stored widths are always the kind's widths up to the largest one stored.
 */
export function imageVariantPlan(kind: ImageKind, region: Pick<PixelRect, "width" | "height">): VariantSize[] {
  const spec = imageKindSpec(kind);
  const extent = spec.fit === "cover" ? region.width : Math.max(region.width, region.height);
  const fitting = spec.variants.filter((variant) => variant <= extent);
  const widths = fitting.length > 0 ? fitting : spec.variants.slice(0, 1);

  return widths.map((variant) => {
    const scale = Math.min(1, variant / extent);
    const width = Math.max(1, Math.round(region.width * scale));
    const height =
      spec.aspect !== null && spec.fit === "cover"
        ? Math.max(1, Math.round(width / spec.aspect))
        : Math.max(1, Math.round(region.height * scale));
    return { variant, width, height };
  });
}

/** Where a variant is stored: `<kind>/<id>/<width>.webp`. Nothing user-supplied ever reaches a key. */
export function imageVariantKey(kind: ImageKind, id: string, variant: number): string {
  return `${kind}/${id}/${variant}.webp`;
}

const STORED_VARIANT = /^(.*\/)([a-z_]+)\/([0-9a-f-]{36})\/(\d+)\.webp$/;

/**
 * Every variant URL of a stored image, from the URL a row keeps (its largest variant), or null for an
 * image stored before variants existed. Lets a page build a srcset from `image_url` alone: every width
 * of the kind up to the stored one exists (imageVariantPlan).
 */
export function imageVariantsFromUrl(url: string): Record<number, string> | null {
  const match = STORED_VARIANT.exec(url);
  if (!match) return null;
  const [, base, kind, id, stored] = match;
  if (!isImageKind(kind)) return null;
  const variants = imageKindSpec(kind).variants;
  const largest = Number(stored);
  if (!variants.includes(largest)) return null;

  return Object.fromEntries(
    variants.filter((variant) => variant <= largest).map((variant) => [variant, `${base}${imageVariantKey(kind, id, variant)}`]),
  );
}
