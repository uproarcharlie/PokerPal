import { Router } from "express";
import {
  clubsQuerySchema,
  createClubSchema,
  updateClubPaymentsSchema,
  updateClubSchema,
  type CreateClubInput,
  type UpdateClubInput,
  type UpdateClubPaymentsInput,
} from "@shared/api/clubs";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, currentUser, guardedClubId, requireAuth, requireClubManager, requireClubOwner } from "../http/authz";
import { parseOrThrow, validateBody } from "../http/validate";
import { getClubPayments, updateClubPayments } from "../services/club-payments";
import * as clubs from "../services/clubs";
import type { RouteDeps } from "./index";

const INVALID = { message: "Invalid club data" };
const INVALID_PAYMENTS = { message: "Invalid bank details" };

/**
 * Clubs: public reads (no ownerId; `viewer.canManage` instead), create by any signed-in user (who
 * becomes the owner; a few per hour, and at most MAX_CLUBS_PER_OWNER per account), update by its
 * staff, delete by its owner or an admin. Its bank details (round 8) are read and set by its staff
 * only, apart from every other club field, and never cached. Literal paths come before /api/clubs/:id.
 */
export function clubsRoutes({ env, limiters }: RouteDeps): Router {
  const router = Router();

  router.get("/api/clubs", asyncHandler(async (req, res) => {
    res.json(await clubs.listClubs(req, parseOrThrow(clubsQuerySchema, req.query)));
  }));

  router.get("/api/clubs/member-counts", asyncHandler(async (_req, res) => {
    res.json(await clubs.memberCounts());
  }));

  router.get("/api/clubs/slug/:slug", asyncHandler(async (req, res) => {
    res.json(await clubs.getClubBySlug(req, req.params.slug));
  }));

  router.get("/api/clubs/:id", asyncHandler(async (req, res) => {
    res.json(await clubs.getClub(req, req.params.id));
  }));

  router.get("/api/clubs/:id/members-count", asyncHandler(async (req, res) => {
    res.json({ count: await clubs.membersCount(req.params.id) });
  }));

  router.post(
    "/api/clubs",
    requireAuth,
    limiters.clubCreate,
    limiters.clubCreateVisitor,
    validateBody(createClubSchema, INVALID),
    asyncHandler<Record<string, string>, unknown, CreateClubInput>(async (req, res) => {
      res.status(201).json(await clubs.createClub(env, currentUser(req), req.body));
    }),
  );

  router.put(
    "/api/clubs/:id",
    requireClubManager(clubFrom.club()),
    validateBody(updateClubSchema, INVALID),
    asyncHandler<{ id: string }, unknown, UpdateClubInput>(async (req, res) => {
      res.json(await clubs.updateClub(env, req, guardedClubId(res), req.body));
    }),
  );

  router.get("/api/clubs/:id/payments", requireClubManager(clubFrom.club()), asyncHandler(async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await getClubPayments(guardedClubId(res)));
  }));

  router.put(
    "/api/clubs/:id/payments",
    requireClubManager(clubFrom.club()),
    validateBody(updateClubPaymentsSchema, INVALID_PAYMENTS),
    asyncHandler<{ id: string }, unknown, UpdateClubPaymentsInput>(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await updateClubPayments(req, guardedClubId(res), req.body));
    }),
  );

  router.delete("/api/clubs/:id", requireClubOwner(clubFrom.club()), asyncHandler(async (req, res) => {
    await clubs.deleteClub(req, guardedClubId(res));
    res.status(204).send();
  }));

  return router;
}
