import { Router } from "express";
import {
  adjustCountsSchema,
  publicRegistrationSchema,
  staffRegistrationSchema,
  updateRegistrationSchema,
  type AdjustCountsInput,
  type UpdateRegistrationInput,
} from "@shared/api/registrations";
import { asyncHandler } from "../http/async-handler";
import { allowPublic, canManageClub, clubFrom, clubScope, currentUser, requireClubManager } from "../http/authz";
import { parseOrThrow, validateBody } from "../http/validate";
import {
  adjustCounts,
  confirmPayment,
  listPaymentRegistrations,
  listRegistrations,
  registerPlayer,
  removeRegistration,
  updateRegistration,
} from "../services/registrations";
import { isValidSignUpToken } from "../services/sign-up-tokens";
import { requireTournament } from "../services/tournaments";
import type { RouteDeps } from "./index";

const INVALID = { message: "Invalid registration data" };

/**
 * Tournament registrations: the public list and sign-up, and the staff's updates, count changes,
 * removals, payment confirmation and payment-desk lists. Every write but the sign-up needs staff of
 * the tournament's club (SEC-01). The two old PATCH routes are gone (they skipped the lock and the
 * log): PUT /api/registrations/:id and POST /api/registrations/:id/counts replace them.
 */
export function registrationsRoutes({ env, limiters }: RouteDeps): Router {
  const router = Router();

  router.get("/api/tournaments/:id/registrations", asyncHandler(async (req, res) => {
    res.json(await listRegistrations(req, req.params.id));
  }));

  /**
   * Public sign-up (QR page) with the narrow body (SEC-06), for the club's own players or the one the
   * caller just typed in (signUpToken); staff of the club may also set the opening counts and payment,
   * register anyone, and are not held to maxPlayers.
   */
  router.post(
    "/api/tournaments/:id/registrations",
    allowPublic("QR sign-up"),
    limiters.publicWrite,
    asyncHandler(async (req, res) => {
      const tournament = await requireTournament(req.params.id);
      const staff = await canManageClub(req.user, tournament.clubId);
      const input = parseOrThrow(staff ? staffRegistrationSchema : publicRegistrationSchema, req.body ?? {}, INVALID);
      const vouched = isValidSignUpToken(env, input.playerId, input.signUpToken);
      res.status(201).json(await registerPlayer(tournament.id, input, { staff, vouched }));
    }),
  );

  router.put(
    "/api/registrations/:id",
    requireClubManager(clubFrom.registration()),
    validateBody(updateRegistrationSchema, INVALID),
    asyncHandler<{ id: string }, unknown, UpdateRegistrationInput>(async (req, res) => {
      res.json(await updateRegistration(req, req.params.id, req.body));
    }),
  );

  router.delete(
    "/api/registrations/:id",
    requireClubManager(clubFrom.registration()),
    asyncHandler(async (req, res) => {
      await removeRegistration(req, req.params.id);
      res.status(204).end();
    }),
  );

  router.post(
    "/api/registrations/:id/counts",
    requireClubManager(clubFrom.registration()),
    validateBody(adjustCountsSchema, INVALID),
    asyncHandler<{ id: string }, unknown, AdjustCountsInput>(async (req, res) => {
      res.json(await adjustCounts(req.params.id, req.body));
    }),
  );

  router.patch(
    "/api/registrations/:id/confirm-payment",
    requireClubManager(clubFrom.registration()),
    asyncHandler(async (req, res) => {
      res.json(await confirmPayment(req.params.id));
    }),
  );

  router.get(
    "/api/tournaments/:id/pending-registrations",
    requireClubManager(clubFrom.tournament()),
    asyncHandler(async (req, res) => {
      res.json(await listPaymentRegistrations(await clubScope(currentUser(req)), req.params.id, false));
    }),
  );

  router.get(
    "/api/tournaments/:id/confirmed-registrations",
    requireClubManager(clubFrom.tournament()),
    asyncHandler(async (req, res) => {
      res.json(await listPaymentRegistrations(await clubScope(currentUser(req)), req.params.id, true));
    }),
  );

  return router;
}
