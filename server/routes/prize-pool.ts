import { Router } from "express";
import {
  carryOverParamsSchema,
  payoutsUpdateSchema,
  prizePoolAdjustmentSchema,
  rakeRatesSchema,
  type PayoutsUpdateInput,
  type PrizePoolAdjustmentInput,
  type RakeRatesInput,
} from "@shared/api/prize-pool";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireClubManager } from "../http/authz";
import { validateBody, validateParams } from "../http/validate";
import { applyCarryOver, listCarryOvers, removeCarryOver } from "../services/carry-overs";
import { changePayouts } from "../services/payouts";
import { adjustPrizePool, changeRakeRates, getPrizePool } from "../services/prize-pool";

/**
 * A tournament's prize pool and AP (spec §5.2 #19-#20): the public breakdown, and the staff's manual
 * AP total / manual prize pool, AP rates and payouts (round 5's payout editor), and money carried over
 * from earlier tournaments (round 5, item 16). The staff endpoints are open until the tournament is
 * completed or cancelled (409 TOURNAMENT_CLOSED), even while the pool is locked (D14).
 */
export function prizePoolRoutes(): Router {
  const router = Router();

  router.get("/api/tournaments/:id/prize-pool", asyncHandler(async (req, res) => {
    res.json(await getPrizePool(req.params.id));
  }));

  router.put(
    "/api/tournaments/:id/prize-pool/adjustment",
    requireClubManager(clubFrom.tournament()),
    validateBody(prizePoolAdjustmentSchema),
    asyncHandler<{ id: string }, unknown, PrizePoolAdjustmentInput>(async (req, res) => {
      res.json(await adjustPrizePool(req, req.params.id, req.body));
    }),
  );

  router.put(
    "/api/tournaments/:id/prize-pool/rates",
    requireClubManager(clubFrom.tournament()),
    validateBody(rakeRatesSchema),
    asyncHandler<{ id: string }, unknown, RakeRatesInput>(async (req, res) => {
      res.json(await changeRakeRates(req, req.params.id, req.body));
    }),
  );

  router.put(
    "/api/tournaments/:id/prize-pool/payouts",
    requireClubManager(clubFrom.tournament()),
    validateBody(payoutsUpdateSchema),
    asyncHandler<{ id: string }, unknown, PayoutsUpdateInput>(async (req, res) => {
      res.json(await changePayouts(req, req.params.id, req.body));
    }),
  );

  router.get(
    "/api/tournaments/:id/prize-pool/carry-overs",
    requireClubManager(clubFrom.tournament()),
    asyncHandler(async (req, res) => {
      res.json(await listCarryOvers(req.params.id));
    }),
  );

  router.post(
    "/api/tournaments/:id/prize-pool/carry-overs/:carryOverId",
    requireClubManager(clubFrom.tournament()),
    validateParams(carryOverParamsSchema),
    asyncHandler<{ id: string; carryOverId: string }>(async (req, res) => {
      res.json(await applyCarryOver(req, req.params.id, req.params.carryOverId));
    }),
  );

  router.delete(
    "/api/tournaments/:id/prize-pool/carry-overs/:carryOverId",
    requireClubManager(clubFrom.tournament()),
    validateParams(carryOverParamsSchema),
    asyncHandler<{ id: string; carryOverId: string }>(async (req, res) => {
      res.json(await removeCarryOver(req, req.params.id, req.params.carryOverId));
    }),
  );

  return router;
}
