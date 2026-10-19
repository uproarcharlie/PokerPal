import { Router } from "express";
import {
  createAllocationSchema,
  createPointsSystemSchema,
  type AllocationInput,
  type CreatePointsSystemInput,
} from "@shared/api/points";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireClubManager } from "../http/authz";
import { validateBody } from "../http/validate";
import * as points from "../services/points";

/** Points systems (per season) and their per-position allocations: public reads, staff writes (SEC-03). */
export function pointsRoutes(): Router {
  const router = Router();

  router.get("/api/seasons/:seasonId/points-systems", asyncHandler(async (req, res) => {
    res.json(await points.listPointsSystems(req.params.seasonId));
  }));

  router.post(
    "/api/seasons/:seasonId/points-systems",
    requireClubManager(clubFrom.season("seasonId")),
    validateBody(createPointsSystemSchema, { message: "Invalid points system data" }),
    asyncHandler<{ seasonId: string }, unknown, CreatePointsSystemInput>(async (req, res) => {
      res.status(201).json(await points.createPointsSystem(req.params.seasonId, req.body));
    }),
  );

  router.get("/api/points-systems/:id", asyncHandler(async (req, res) => {
    res.json(await points.getPointsSystem(req.params.id));
  }));

  router.delete("/api/points-systems/:id", requireClubManager(clubFrom.pointsSystem()), asyncHandler(async (req, res) => {
    await points.deletePointsSystem(req.params.id);
    res.status(204).send();
  }));

  router.get("/api/points-systems/:pointsSystemId/allocations", asyncHandler(async (req, res) => {
    res.json(await points.listAllocations(req.params.pointsSystemId));
  }));

  router.post(
    "/api/points-systems/:pointsSystemId/allocations",
    requireClubManager(clubFrom.pointsSystem("pointsSystemId")),
    validateBody(createAllocationSchema, { message: "Invalid points allocation data" }),
    asyncHandler<{ pointsSystemId: string }, unknown, AllocationInput>(async (req, res) => {
      res.status(201).json(await points.createAllocation(req.params.pointsSystemId, req.body));
    }),
  );

  return router;
}
