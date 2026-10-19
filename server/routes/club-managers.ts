import { Router } from "express";
import {
  acceptStaffInviteSchema,
  clubManagerParamsSchema,
  createStaffInviteSchema,
  setClubOwnerSchema,
  staffInviteParamsSchema,
  type AcceptStaffInviteInput,
  type CreateStaffInviteInput,
  type SetClubOwnerInput,
} from "@shared/api/clubs";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, guardedClubId, requireAdmin, requireAuth, requireClubOwner } from "../http/authz";
import { validateBody, validateParams } from "../http/validate";
import * as staff from "../services/club-managers";
import type { RouteDeps } from "./index";

/**
 * A club's staff (SEC-26): its owner and admins see the managers, invite new ones and remove them;
 * admins also invite or set the owner (Central Stars has none on production). Managers themselves
 * cannot change staff. A role is granted only by accepting an invitation (SEC-P2REV-03).
 */
export function clubManagersRoutes({ limiters }: RouteDeps): Router {
  const router = Router();

  router.get("/api/clubs/:id/managers", requireClubOwner(clubFrom.club()), asyncHandler(async (_req, res) => {
    res.json(await staff.getStaff(guardedClubId(res)));
  }));

  router.post(
    "/api/clubs/:id/invites",
    requireClubOwner(clubFrom.club()),
    limiters.staffChange,
    validateBody(createStaffInviteSchema),
    asyncHandler<{ id: string }, unknown, CreateStaffInviteInput>(async (req, res) => {
      res.status(201).json(await staff.createInvite(req, guardedClubId(res), req.body));
    }),
  );

  router.delete(
    "/api/clubs/:id/invites/:inviteId",
    requireClubOwner(clubFrom.club()),
    limiters.staffChange,
    validateParams(staffInviteParamsSchema),
    asyncHandler<{ id: string; inviteId: string }>(async (req, res) => {
      res.json(await staff.revokeInvite(req, guardedClubId(res), req.params.inviteId));
    }),
  );

  router.post(
    "/api/staff-invites/accept",
    requireAuth,
    limiters.staffChange,
    validateBody(acceptStaffInviteSchema, { message: "Invalid invitation" }),
    asyncHandler<Record<string, string>, unknown, AcceptStaffInviteInput>(async (req, res) => {
      res.json(await staff.acceptInvite(req, req.body.token));
    }),
  );

  router.delete(
    "/api/clubs/:id/managers/:userId",
    requireClubOwner(clubFrom.club()),
    limiters.staffChange,
    validateParams(clubManagerParamsSchema),
    asyncHandler<{ id: string; userId: string }>(async (req, res) => {
      res.json(await staff.removeManager(req, guardedClubId(res), req.params.userId));
    }),
  );

  router.put(
    "/api/clubs/:id/owner",
    requireAdmin,
    validateBody(setClubOwnerSchema),
    asyncHandler<{ id: string }, unknown, SetClubOwnerInput>(async (req, res) => {
      res.json(await staff.setOwner(req, req.params.id, req.body));
    }),
  );

  return router;
}
