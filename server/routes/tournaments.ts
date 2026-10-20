import { Router } from "express";
import {
  createTournamentSchema,
  tournamentsQuerySchema,
  updateTournamentSchema,
  type CreateTournamentInput,
  type UpdateTournamentInput,
} from "@shared/api/tournaments";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireAuth, requireClubManager, requireClubOwner } from "../http/authz";
import { parseOrThrow, validateBody } from "../http/validate";
import {
  createTournament,
  deleteTournament,
  getTournamentDetail,
  listTournaments,
  tournamentCounts,
  updateTournament,
} from "../services/tournaments";
import type { RouteDeps } from "./index";

const INVALID = { message: "Invalid tournament data" };

/**
 * Tournaments: the public list and detail, and the staff's create, update and delete (SEC-02). Creating
 * and editing need a manager of the club; deleting needs its owner or an admin (managers can cancel
 * instead). The unauthenticated PATCH twin of PUT is gone (it answers the API's JSON 404).
 */
export function tournamentsRoutes({ env, limiters }: RouteDeps): Router {
  const router = Router();

  router.get("/api/tournaments", asyncHandler(async (req, res) => {
    res.json(await listTournaments(req, parseOrThrow(tournamentsQuerySchema, req.query)));
  }));

  // Before "/api/tournaments/:id", which would take "counts" for an id.
  router.get("/api/tournaments/counts", asyncHandler(async (_req, res) => {
    res.json(await tournamentCounts());
  }));

  router.get("/api/tournaments/:id", asyncHandler(async (req, res) => {
    res.json(await getTournamentDetail(req, req.params.id));
  }));

  router.post(
    "/api/tournaments",
    requireAuth,
    // Upcoming tournaments are on the public home page and any account can open a club (SEC-P2REV-04).
    limiters.tournamentCreate,
    limiters.tournamentCreateVisitor,
    validateBody(createTournamentSchema, INVALID),
    requireClubManager(clubFrom.body()),
    asyncHandler<Record<string, never>, unknown, CreateTournamentInput>(async (req, res) => {
      res.status(201).json(await createTournament(env, req, req.body));
    }),
  );

  router.put(
    "/api/tournaments/:id",
    requireClubManager(clubFrom.tournament()),
    validateBody(updateTournamentSchema, INVALID),
    asyncHandler<{ id: string }, unknown, UpdateTournamentInput>(async (req, res) => {
      res.json(await updateTournament(env, req, req.params.id, req.body));
    }),
  );

  router.delete("/api/tournaments/:id", requireClubOwner(clubFrom.tournament()), asyncHandler(async (req, res) => {
    await deleteTournament(req, req.params.id);
    res.json({ success: true, message: "Tournament deleted successfully" });
  }));

  return router;
}
