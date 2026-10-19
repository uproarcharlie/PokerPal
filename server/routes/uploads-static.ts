import express, { Router } from "express";
import type { AppEnv } from "../config/env";
import { localUploadDir } from "../services/images/store";

/**
 * Serves the local disk store's files at /uploads. The app mounts it ahead of the rate limiter and
 * the session middleware, so image requests never load or touch a session (img-12). Every stored
 * name is unique and never rewritten, so files are cached for a year. A missing file is a 404 from
 * the central error handler, never the SPA's index.html with a 200 (img-06).
 */
export function uploadsStatic(env: AppEnv): Router {
  const router = Router();
  router.use(
    "/uploads",
    express.static(localUploadDir(env), {
      fallthrough: false,
      index: false,
      redirect: false,
      maxAge: "1y",
      immutable: true,
    }),
  );
  return router;
}
