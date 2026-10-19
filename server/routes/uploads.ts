import { Router } from "express";
import { z } from "zod";
import { legacyEntityTypeSchema, type ImageUploadResponse, type LegacyUploadResponse } from "@shared/api/images";
import { LEGACY_ENTITY_KINDS } from "@shared/domain/images";
import { admitImageUpload, receiveImageUpload } from "../config/multer";
import { asyncHandler } from "../http/async-handler";
import { allowPublic, requireAuth } from "../http/authz";
import { parseOrThrow } from "../http/validate";
import { imageStoreFor } from "../services/images/store";
import { saveUploadedImage } from "../services/images/upload";
import { refuseWhenRenderBusy, uploadedImage, withImageStore } from "./images";
import type { RouteDeps } from "./index";

const entityTypeFieldSchema = z.object({ entityType: legacyEntityTypeSchema });

const legacyResponse = (image: ImageUploadResponse): LegacyUploadResponse => ({ imageUrl: image.url, ...image });

/**
 * The legacy upload routes, as thin aliases of POST /api/images/:kind that answer 200 with `imageUrl`
 * (the canonical variant) beside the new fields. Today's client posts to /api/images/:kind instead;
 * these stay for browsers still running the previous bundle while a deploy rolls out, and for the
 * e2e smoke and anonymous-API checks (test/e2e), and can be removed in Phase 3 with those checks.
 */
export function uploadsRoutes({ env, limiters }: RouteDeps): Router {
  const router = Router();
  const store = withImageStore(imageStoreFor(env));

  // Signed-in uploads: `entityType` (players, clubs, tournaments) picks the kind; anything else is a
  // 400 before anything is stored, so it can never become a path or key (SEC-15, img-05).
  router.post(
    "/api/upload",
    requireAuth,
    admitImageUpload,
    limiters.upload,
    store.require,
    refuseWhenRenderBusy,
    receiveImageUpload,
    asyncHandler(async (req, res) => {
      const { file, crop } = uploadedImage(req);
      const { entityType } = parseOrThrow(entityTypeFieldSchema, req.body ?? {}, {
        message: "Unknown entityType: use players, clubs or tournaments",
      });
      res.json(legacyResponse(await saveUploadedImage(store.get(), LEGACY_ENTITY_KINDS[entityType], file, crop)));
    }),
  );

  // The QR register page's photo: always a player photo, whatever the form says.
  router.post(
    "/api/upload/public",
    allowPublic("player photo"),
    admitImageUpload,
    limiters.publicWrite,
    limiters.upload,
    store.require,
    refuseWhenRenderBusy,
    receiveImageUpload,
    asyncHandler(async (req, res) => {
      const { file, crop } = uploadedImage(req);
      res.json(legacyResponse(await saveUploadedImage(store.get(), "player_avatar", file, crop)));
    }),
  );

  return router;
}
