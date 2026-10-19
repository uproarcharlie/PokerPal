/**
 * Image uploads. POST /api/images/:kind takes multipart/form-data with the file in field `image`
 * (at most 5 MiB, declared as one of ACCEPTED_IMAGE_TYPES, and a JPEG, PNG, WebP, GIF or AVIF by its
 * own bytes; HEIC is refused with HEIC_MESSAGE) and an optional `crop` field (JSON, see
 * imageCropSchema). The server decodes with pixel limits (first frame only), applies the crop and the
 * kind's aspect, renders the kind's variants as WebP (never enlarging: see imageVariantPlan) and
 * stores them under `<kind>/<uuid>/<width>.webp` with an immutable cache header. Nothing stored is ever
 * deleted in this phase; replaced images are only logged.
 */
import { z } from "zod";
import { IMAGE_KIND_NAMES, LEGACY_ENTITY_KINDS, type ImageKind, type LegacyEntityType } from "../domain/images";

export const imageKindSchema = z.enum(IMAGE_KIND_NAMES as [ImageKind, ...ImageKind[]]);

export const imageKindParamsSchema = z.object({ kind: imageKindSchema });

/**
 * The part of the (EXIF-rotated) image to keep, as fractions of its width and height, so the client
 * can crop a preview of any size. Must stay inside the image.
 */
export const imageCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((crop) => crop.x + crop.width <= 1 + 1e-9 && crop.y + crop.height <= 1 + 1e-9, "The crop must stay inside the image");
export type ImageCrop = z.infer<typeof imageCropSchema>;

/** The `crop` multipart field: JSON text of an ImageCrop, or absent. */
export const imageCropFieldSchema = z
  .string()
  .optional()
  .transform((text, ctx) => {
    if (text === undefined || text.trim() === "") return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "crop must be JSON" });
      return z.NEVER;
    }
  })
  .pipe(imageCropSchema.optional());

/** POST /api/images/:kind (201). */
export interface ImageUploadResponse {
  kind: ImageKind;
  /** The largest variant: what an image_url column stores. */
  url: string;
  /** Every variant stored, by nominal width in px (imageVariantsFromUrl(url) gives the same map). */
  variants: Record<number, string>;
  /** The canonical variant's size in px. */
  width: number;
  height: number;
  /** "#rrggbb" of the dominant colour, for placeholders and palette suggestions. */
  dominantColor: string | null;
}

/** The `entityType` form field of the legacy POST /api/upload. Anything else is 400 VALIDATION (SEC-15). */
export const legacyEntityTypeSchema = z.enum(
  Object.keys(LEGACY_ENTITY_KINDS) as [LegacyEntityType, ...LegacyEntityType[]],
);

/** POST /api/upload and /api/upload/public (200, as today): `imageUrl` is the new `url`. */
export type LegacyUploadResponse = { imageUrl: string } & ImageUploadResponse;
