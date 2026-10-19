import { Router } from "express";
import {
  confirmPendingActionSchema,
  createPendingActionSchema,
  type ConfirmPendingActionInput,
  type CreatePendingActionInput,
} from "@shared/api/pending-actions";
import { asyncHandler } from "../http/async-handler";
import { allowPublic, clubFrom, requireClubManager } from "../http/authz";
import { validateBody } from "../http/validate";
import {
  confirmPendingAction,
  createPendingAction,
  dismissPendingAction,
  listPendingActions,
} from "../services/pending-actions";
import type { RouteDeps } from "./index";

/**
 * Player-requested re-buys, add-ons and knockouts: requested from the public player-actions page,
 * listed, confirmed (applied exactly once) or dismissed by the tournament's staff (SEC-05).
 */
export function pendingActionsRoutes({ limiters }: RouteDeps): Router {
  const router = Router();

  router.get(
    "/api/tournaments/:id/pending-actions",
    requireClubManager(clubFrom.tournament()),
    asyncHandler(async (req, res) => {
      res.json(await listPendingActions(req.params.id));
    }),
  );

  router.post(
    "/api/tournaments/:id/pending-actions",
    allowPublic("player request"),
    limiters.publicWrite,
    validateBody(createPendingActionSchema, { message: "Invalid action data" }),
    asyncHandler<{ id: string }, unknown, CreatePendingActionInput>(async (req, res) => {
      res.status(201).json(await createPendingAction(req.params.id, req.body));
    }),
  );

  router.post(
    "/api/pending-actions/:id/confirm",
    requireClubManager(clubFrom.pendingAction()),
    validateBody(confirmPendingActionSchema, { message: "Invalid action data" }),
    asyncHandler<{ id: string }, unknown, ConfirmPendingActionInput>(async (req, res) => {
      res.json(await confirmPendingAction(req.params.id, req.body));
    }),
  );

  router.delete(
    "/api/pending-actions/:id",
    requireClubManager(clubFrom.pendingAction()),
    asyncHandler(async (req, res) => {
      await dismissPendingAction(req, req.params.id);
      res.json({ success: true });
    }),
  );

  return router;
}
