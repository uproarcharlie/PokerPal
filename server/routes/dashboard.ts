import { Router } from "express";
import { asyncHandler } from "../http/async-handler";
import { currentUser, requireAuth } from "../http/authz";
import { dashboardStats } from "../services/dashboard";

/** The admin dashboard's headline numbers, for the clubs the viewer runs (every club for an admin). */
export function dashboardRoutes(): Router {
  const router = Router();

  router.get("/api/dashboard/stats", requireAuth, asyncHandler(async (req, res) => {
    res.json(await dashboardStats(currentUser(req)));
  }));

  return router;
}
