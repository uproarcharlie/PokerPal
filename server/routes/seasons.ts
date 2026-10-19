import { Router } from "express";
import {
  createSeasonSchema,
  seasonsQuerySchema,
  updateSeasonSchema,
  type CreateSeasonInput,
  type UpdateSeasonInput,
} from "@shared/api/seasons";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, guardedClubId, requireAuth, requireClubManager, requireClubOwner } from "../http/authz";
import { parseOrThrow, validateBody } from "../http/validate";
import * as seasons from "../services/seasons";

const INVALID = { message: "Invalid season data" };

/** Seasons: public reads; create and update by the club's staff; delete by its owner or an admin (SEC-03). */
export function seasonsRoutes(): Router {
  const router = Router();

  router.get(
    "/api/seasons",
    asyncHandler(async (req, res) => {
      res.json(await seasons.listSeasons(parseOrThrow(seasonsQuerySchema, req.query).clubId));
    }),
  );

  router.post(
    "/api/seasons",
    requireAuth,
    validateBody(createSeasonSchema, INVALID),
    requireClubManager(clubFrom.body()),
    asyncHandler<Record<string, string>, unknown, CreateSeasonInput>(async (req, res) => {
      res.status(201).json(await seasons.createSeason({ ...req.body, clubId: guardedClubId(res) }));
    }),
  );

  router.get("/api/seasons/:id", asyncHandler(async (req, res) => {
    res.json(await seasons.getSeason(req.params.id));
  }));

  router.put(
    "/api/seasons/:id",
    requireClubManager(clubFrom.season()),
    validateBody(updateSeasonSchema, INVALID),
    asyncHandler<{ id: string }, unknown, UpdateSeasonInput>(async (req, res) => {
      res.json(await seasons.updateSeason(req.params.id, req.body));
    }),
  );

  router.delete("/api/seasons/:id", requireClubOwner(clubFrom.season()), asyncHandler(async (req, res) => {
    await seasons.deleteSeason(req, req.params.id);
    res.status(204).send();
  }));

  return router;
}
