/**
 * The money changes only a club's staff make (phase4-contracts §3.3, round5-contracts §3.1): the manual
 * AP total or prize pool, the AP rates and the payouts, and money carried over from earlier tournaments
 * (round 5, item 16). Each change answers the tournament and its prize pool as they now are. The club's
 * name for its AP is a club setting (PUT /api/clubs/:id, `updateClub` in features/clubs/staff-api).
 */
import { queryOptions } from "@tanstack/react-query";
import type { ApUpdateResponse, CarryOversDto, PayoutsUpdateInput, PrizePoolAdjustmentInput, RakeRatesInput } from "@shared/api/prize-pool";
import { apiGet, apiSend } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { prizePoolPath } from "./api";

/** 400 AP_EXCEEDS_GROSS (details.grossCents) for a manual AP total over what was taken in; 409 TOURNAMENT_CLOSED. */
export const adjustPrizePool = (tournamentId: string, input: PrizePoolAdjustmentInput) =>
  apiSend<ApUpdateResponse>("PUT", `${prizePoolPath(tournamentId)}/adjustment`, input);

/** 400 PERCENT_OVER_100 / AMOUNT_REQUIRED (details.field names the amount); 409 TOURNAMENT_CLOSED. */
export const changeRakeRates = (tournamentId: string, input: RakeRatesInput) =>
  apiSend<ApUpdateResponse>("PUT", `${prizePoolPath(tournamentId)}/rates`, input);

/** 400 VALIDATION (each issue at `places[i]`); 409 TOURNAMENT_CLOSED. */
export const changePayouts = (tournamentId: string, input: PayoutsUpdateInput) =>
  apiSend<ApUpdateResponse>("PUT", `${prizePoolPath(tournamentId)}/payouts`, input);

const carryOversPath = (tournamentId: string) => `${prizePoolPath(tournamentId)}/carry-overs`;

/** Under the prize pool's key, so every refresh of the tournament refreshes it too. */
export const carryOverQueries = {
  list: (tournamentId: string) =>
    queryOptions({
      queryKey: [...qk.tournaments.prizePool(tournamentId), "carry-overs"] as const,
      queryFn: ({ signal }) => apiGet<CarryOversDto>(carryOversPath(tournamentId), { signal }),
    }),
};

/** 404 when the money is not this tournament's to take; 409 CONFLICT when another tournament took it first; 409 TOURNAMENT_CLOSED. */
export const applyCarryOver = (tournamentId: string, carryOverId: string) =>
  apiSend<ApUpdateResponse>("POST", `${carryOversPath(tournamentId)}/${encodeURIComponent(carryOverId)}`);

/** 404 when the money is not in this pool; 409 TOURNAMENT_CLOSED once the tournament is completed. */
export const removeCarryOver = (tournamentId: string, carryOverId: string) =>
  apiSend<ApUpdateResponse>("DELETE", `${carryOversPath(tournamentId)}/${encodeURIComponent(carryOverId)}`);
