import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { imageCropFieldSchema, imageKindParamsSchema, type ImageCrop, type ImageUploadResponse } from "@shared/api/images";
import { imageKindSpec } from "@shared/domain/images";
import { admitImageUpload, receiveImageUpload } from "../config/multer";
import { asyncHandler } from "../http/async-handler";
import { allowPublic } from "../http/authz";
import { HttpError, unauthenticated } from "../http/errors";
import { parseOrThrow, validateParams } from "../http/validate";
import { renderBusy, renderQueueFull } from "../services/images/render";
import { imageStoreFor, type ImageStore } from "../services/images/store";
import { saveUploadedImage } from "../services/images/upload";
import type { RouteDeps } from "./index";

const storageUnavailable = () =>
  new HttpError(503, "STORAGE_UNAVAILABLE", "Image uploads are not available on this server right now.");

/**
 * The store to write to. Mounted before the body is read, so a server with nowhere to keep images
 * (production without R2 or UPLOAD_DIR) refuses at once instead of after taking a 5 MB upload.
 */
export function withImageStore(store: ImageStore | null): { require: RequestHandler; get: () => ImageStore } {
  return {
    require: (_req, _res, next) => next(store ? undefined : storageUnavailable()),
    get: () => {
      if (!store) throw storageUnavailable();
      return store;
    },
  };
}

/**
 * 503 while the renderer's queue is full, before the body is read. Bodies still arriving are bounded
 * separately, by receiveImageUpload (server/config/multer.ts): this only stops new uploads joining a
 * render queue that is already full.
 */
export const refuseWhenRenderBusy: RequestHandler = (_req, _res, next) => {
  next(renderQueueFull() ? renderBusy() : undefined);
};

const cropFieldSchema = z.object({ crop: imageCropFieldSchema });

/** The file and optional crop of a parsed multipart upload: 400 NO_FILE without a file, 400 for a bad crop. */
export function uploadedImage(req: Request): { file: Buffer; crop?: ImageCrop } {
  if (!req.file) throw new HttpError(400, "NO_FILE", "No file uploaded");
  const { crop } = parseOrThrow(cropFieldSchema, req.body ?? {}, { message: "Invalid crop" });
  return { file: req.file.buffer, crop };
}

/** Only a player photo may be uploaded anonymously (the QR register page); every other kind needs a user. */
const requireUserUnlessPublicKind: RequestHandler = (req, _res, next) => {
  const { kind } = parseOrThrow(imageKindParamsSchema, req.params);
  next(imageKindSpec(kind).publicUpload || req.user ? undefined : unauthenticated());
};

/**
 * POST /api/images/:kind: multipart `image` (+ optional `crop`), answered 201 with every variant's URL
 * (ImageUploadResponse). `:kind` must be one of IMAGE_KINDS, so nothing a client sends reaches a
 * storage key or path (SEC-15, img-05). Uploading is not attaching: a row gets the image only through
 * its own guarded route.
 */
export function imagesRoutes({ env, limiters }: RouteDeps): Router {
  const router = Router();
  const store = withImageStore(imageStoreFor(env));

  router.post(
    "/api/images/:kind",
    allowPublic("player photo"),
    validateParams(imageKindParamsSchema, { message: "Unknown image kind" }),
    requireUserUnlessPublicKind,
    // A slot for the body first: an upload refused because others are still arriving is not counted (TN-REV2-01).
    admitImageUpload,
    limiters.publicWrite,
    limiters.upload,
    store.require,
    refuseWhenRenderBusy,
    receiveImageUpload,
    asyncHandler(async (req, res) => {
      const { kind } = parseOrThrow(imageKindParamsSchema, req.params);
      const { file, crop } = uploadedImage(req);
      const body: ImageUploadResponse = await saveUploadedImage(store.get(), kind, file, crop);
      res.status(201).json(body);
    }),
  );

  return router;
}
