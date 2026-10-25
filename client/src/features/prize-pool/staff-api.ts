/**
 * The AP changes only a club's staff make (phase4-contracts §3.3): the manual AP total or prize pool,
 * and the AP rates. Both answer the tournament and its prize pool as they now are. The club's name for
 * its AP is a club setting (PUT /api/clubs/:id, `updateClub` in features/clubs/staff-api).
 */
import type { ApUpdateResponse, PrizePoolAdjustmentInput, RakeRatesInput } from "@shared/api/prize-pool";
import { apiSend } from "@/lib/api/http";
import { prizePoolPath } from "./api";

/** 400 AP_EXCEEDS_GROSS (details.grossCents) for a manual AP total over what was taken in; 409 TOURNAMENT_CLOSED. */
export const adjustPrizePool = (tournamentId: string, input: PrizePoolAdjustmentInput) =>
  apiSend<ApUpdateResponse>("PUT", `${prizePoolPath(tournamentId)}/adjustment`, input);

/** 400 PERCENT_OVER_100 / AMOUNT_REQUIRED (details.field names the amount); 409 TOURNAMENT_CLOSED. */
export const changeRakeRates = (tournamentId: string, input: RakeRatesInput) =>
  apiSend<ApUpdateResponse>("PUT", `${prizePoolPath(tournamentId)}/rates`, input);
