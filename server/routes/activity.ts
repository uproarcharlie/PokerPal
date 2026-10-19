import { Router } from "express";
import { activityQuerySchema } from "@shared/api/tournaments";
import { asyncHandler } from "../http/async-handler";
import { parseOrThrow } from "../http/validate";
import { tournamentActivity } from "../services/activity";

/** A tournament's activity feed: public, newest first, `?limit=` entries (default 1000). */
export function activityRoutes(): Router {
  const router = Router();

  router.get("/api/tournaments/:tournamentId/activity", asyncHandler(async (req, res) => {
    const { limit } = parseOrThrow(activityQuerySchema, req.query);
    res.json(await tournamentActivity(req, req.params.tournamentId, limit));
  }));

  return router;
}
