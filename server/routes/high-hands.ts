import { Router } from "express";
import {
  highHandAwardCorrectionSchema,
  highHandAwardParamsSchema,
  highHandAwardSchema,
  highHandParamsSchema,
  highHandsUpdateSchema,
  type HighHandAwardCorrectionInput,
  type HighHandAwardInput,
  type HighHandsUpdateInput,
} from "@shared/api/high-hands";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireClubManager } from "../http/authz";
import { validateBody, validateParams } from "../http/validate";
import { awardHighHand, correctHighHandAward, takeBackHighHandAward } from "../services/high-hand-awards";
import { updateHighHands } from "../services/high-hand-config";

/**
 * A tournament's high hands (round 10), all the club staff's: the list (each its own fee, AP and
 * prizes) and each one's awards. Open after the game for the awards (settled at the end of the night,
 * as before); the list refuses changes once the tournament is completed or cancelled (409
 * TOURNAMENT_CLOSED). Staff writes like PUT /api/registrations/:id, under the global API limit.
 */
export function highHandsRoutes(): Router {
  const router = Router();

  router.put(
    "/api/tournaments/:id/high-hands",
    requireClubManager(clubFrom.tournament()),
    validateBody(highHandsUpdateSchema, { message: "Invalid high hands" }),
    asyncHandler<{ id: string }, unknown, HighHandsUpdateInput>(async (req, res) => {
      res.json(await updateHighHands(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/high-hands/:highHandId/awards",
    requireClubManager(clubFrom.tournament()),
    validateParams(highHandParamsSchema),
    validateBody(highHandAwardSchema),
    asyncHandler<{ id: string; highHandId: string }, unknown, HighHandAwardInput>(async (req, res) => {
      res.status(201).json(await awardHighHand(req, req.params.id, req.params.highHandId, req.body));
    }),
  );

  router.patch(
    "/api/tournaments/:id/high-hands/:highHandId/awards/:registrationId",
    requireClubManager(clubFrom.tournament()),
    validateParams(highHandAwardParamsSchema),
    validateBody(highHandAwardCorrectionSchema),
    asyncHandler<{ id: string; highHandId: string; registrationId: string }, unknown, HighHandAwardCorrectionInput>(async (req, res) => {
      const { id: tournamentId, highHandId, registrationId } = req.params;
      res.json(await correctHighHandAward(req, { tournamentId, highHandId, registrationId }, req.body));
    }),
  );

  router.delete(
    "/api/tournaments/:id/high-hands/:highHandId/awards/:registrationId",
    requireClubManager(clubFrom.tournament()),
    validateParams(highHandAwardParamsSchema),
    asyncHandler<{ id: string; highHandId: string; registrationId: string }>(async (req, res) => {
      const { id: tournamentId, highHandId, registrationId } = req.params;
      res.json(await takeBackHighHandAward(req, { tournamentId, highHandId, registrationId }));
    }),
  );

  return router;
}
