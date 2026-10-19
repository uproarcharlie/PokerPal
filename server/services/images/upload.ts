import { randomUUID } from "node:crypto";
import type { ImageUploadResponse } from "@shared/api/images";
import { imageVariantKey, imageVariantsFromUrl, type CropFractions, type ImageKind } from "@shared/domain/images";
import type { AppEnv } from "../../config/env";
import { badRequest, HttpError } from "../../http/errors";
import { renderImage, type RenderLimits } from "./render";
import { ownsImageUrl, type ImageStore } from "./store";

/**
 * Renders an upload to its kind's variants and stores them under a new random id: what
 * POST /api/images/:kind and the legacy upload routes answer. Nothing is written unless the whole
 * file decodes; if the store fails part-way the variants already written are logged as orphans.
 */
export async function saveUploadedImage(
  store: ImageStore,
  kind: ImageKind,
  file: Buffer,
  crop?: CropFractions,
  limits?: RenderLimits,
): Promise<ImageUploadResponse> {
  const rendered = await renderImage(file, kind, crop, limits);
  const id = randomUUID();
  const keys = rendered.variants.map(({ variant }) => imageVariantKey(kind, id, variant));

  const results = await Promise.allSettled(rendered.variants.map(({ body }, index) => store.put(keys[index], body)));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) {
    console.error("Storing an image failed:", failure.reason);
    const written = keys.filter((_, index) => results[index].status === "fulfilled");
    logOrphanedImages(written.map((key) => store.publicUrl(key)), "an upload that failed part-way");
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "We couldn't save the image just now. Please try again.");
  }

  const variants: Record<number, string> = Object.fromEntries(
    rendered.variants.map(({ variant }, index) => [variant, store.publicUrl(keys[index])]),
  );
  const canonical = rendered.variants[rendered.variants.length - 1];
  return {
    kind,
    url: variants[canonical.variant],
    variants,
    width: canonical.width,
    height: canonical.height,
    dominantColor: rendered.dominantColor,
  };
}

/**
 * Records stored images that nothing points at any more (replaced, or their club or tournament
 * deleted). They are never deleted here: removing stored files needs the owner's sign-off. Uploads
 * that were never attached are not in this log (see ImageStore), so a later clean-up starts from the
 * bucket compared with the database, using this log as a hint.
 */
export function logOrphanedImages(urls: readonly string[], reason: string): void {
  if (urls.length === 0) return;
  console.info(`[images] orphaned, kept (${reason}): ${urls.join(" ")}`);
}

/**
 * For services that set an image column (club, player, tournament), before the write: a new image must
 * be one our upload endpoints stored, never a link to another server (img-24). An unchanged one is
 * accepted as stored (legacy URLs predate the check), and so is removing it. 400 VALIDATION on
 * `imageUrl` under the form's own message ("Invalid club data").
 */
export function assertOwnedImage(
  env: AppEnv,
  next: string | null | undefined,
  previous: string | null | undefined,
  message: string,
): void {
  if (next && next !== previous && !ownsImageUrl(env, next)) {
    throw badRequest(message, "VALIDATION", [{ code: "custom", path: ["imageUrl"], message: "Must be an uploaded image" }]);
  }
}

/** An image with every variant it has (just the URL when it is not one of ours). */
const withVariants = (url: string): string[] => {
  const variants = imageVariantsFromUrl(url);
  return variants ? Object.values(variants) : [url];
};

/**
 * For the same services, once the write is committed: logs the previous image, with every variant it
 * has, when a change replaces or removes it. `where` names the row, e.g. "club 1f3…".
 */
export function noteReplacedImage(previous: string | null | undefined, next: string | null | undefined, where: string): void {
  if (!previous || previous === next) return;
  logOrphanedImages(withVariants(previous), `replaced on ${where}`);
}

/** Once a delete is committed: logs the images its rows pointed at, e.g. "club 1f3… was deleted". */
export function noteDeletedImages(urls: ReadonlyArray<string | null | undefined>, what: string): void {
  logOrphanedImages(urls.flatMap((url) => (url ? withVariants(url) : [])), `${what} was deleted`);
}
