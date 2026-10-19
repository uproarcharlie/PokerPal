import { Router } from "express";
import { asyncHandler } from "../http/async-handler";
import { getSeasonLeaderboard } from "../services/leaderboard";

/** A season's points leaderboard: public, one aggregate query, no contact details. */
export function leaderboardRoutes(): Router {
  const router = Router();

  router.get("/api/seasons/:seasonId/leaderboard", asyncHandler(async (req, res) => {
    res.json(await getSeasonLeaderboard(req.params.seasonId));
  }));

  return router;
}
