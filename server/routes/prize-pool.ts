import { Router } from "express";
import {
  prizePoolAdjustmentSchema,
  rakeRatesSchema,
  type PrizePoolAdjustmentInput,
  type RakeRatesInput,
} from "@shared/api/prize-pool";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireClubManager } from "../http/authz";
import { validateBody } from "../http/validate";
import { adjustPrizePool, changeRakeRates, getPrizePool } from "../services/prize-pool";

/**
 * A tournament's prize pool and AP (spec §5.2 #19-#20): the public breakdown, and the staff's manual
 * AP total / manual prize pool and AP rates. The AP endpoints are open until the tournament is
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

  return router;
}
