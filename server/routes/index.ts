import type { Express, Router } from "express";
import type { AppEnv } from "../config/env";
import type { RateLimiters } from "../http/rate-limits";
import { activityRoutes } from "./activity";
import { adminRoutes } from "./admin";
import { authRoutes } from "./auth";
import { clubManagersRoutes } from "./club-managers";
import { clubsRoutes } from "./clubs";
import { dashboardRoutes } from "./dashboard";
import { finalizeRoutes } from "./finalize";
import { imagesRoutes } from "./images";
import { leaderboardRoutes } from "./leaderboard";
import { pendingActionsRoutes } from "./pending-actions";
import { playersRoutes } from "./players";
import { pointsRoutes } from "./points";
import { prizePoolRoutes } from "./prize-pool";
import { publicRoutes } from "./public";
import { registrationsRoutes } from "./registrations";
import { seasonsRoutes } from "./seasons";
import { tournamentsRoutes } from "./tournaments";
import { uploadsRoutes } from "./uploads";

/** What a route module may need from the app. A module that needs nothing takes no argument. */
export interface RouteDeps {
  env: AppEnv;
  limiters: RateLimiters;
}

/**
 * Every API route module, in mount order. Each declares full paths ("/api/clubs/:id"), and no two
 * modules answer the same method and path, so the order between modules never decides a match.
 * Within a module, register a literal path before a parameter route of the same shape
 * ("/api/clubs/member-counts" before "/api/clubs/:id"), or the parameter route answers it.
 */
const ROUTE_MODULES: ReadonlyArray<(deps: RouteDeps) => Router> = [
  authRoutes,
  adminRoutes,
  imagesRoutes,
  uploadsRoutes,
  clubsRoutes,
  clubManagersRoutes,
  seasonsRoutes,
  leaderboardRoutes,
  pointsRoutes,
  playersRoutes,
  publicRoutes,
  tournamentsRoutes,
  prizePoolRoutes,
  finalizeRoutes,
  registrationsRoutes,
  pendingActionsRoutes,
  activityRoutes,
  dashboardRoutes,
];

export function registerRoutes(app: Express, deps: RouteDeps): void {
  for (const routes of ROUTE_MODULES) app.use(routes(deps));
}
