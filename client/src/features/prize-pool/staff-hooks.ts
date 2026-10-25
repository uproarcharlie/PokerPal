/**
 * The AP changes and their refreshes. Both money endpoints answer the tournament and its prize pool as
 * they now are: shown at once, then everything about the tournament refreshes (its lists, the
 * dashboard's totals). Apart from hooks.ts so a public page never loads them.
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ApUpdateResponse, PrizePoolAdjustmentInput, RakeRatesInput } from "@shared/api/prize-pool";
import { hasErrorCode } from "@/lib/api/http";
import { invalidateTournament } from "@/lib/api/invalidate";
import { qk } from "@/lib/api/query-keys";
import { adjustPrizePool, changeRakeRates } from "./staff-api";

function showMoneyResponse(queryClient: QueryClient, tournamentId: string, { tournament, prizePool }: ApUpdateResponse): void {
  queryClient.setQueryData(qk.tournaments.detail(tournamentId), tournament);
  queryClient.setQueryData(qk.tournaments.prizePool(tournamentId), prizePool);
  void invalidateTournament(queryClient, tournamentId);
}

/**
 * A refusal that says the tournament moved on meanwhile (it closed, or entries came out so the gross
 * is lower): the figures on screen are out of date, so they are fetched again.
 */
function refreshWhenOutOfDate(queryClient: QueryClient, tournamentId: string, error: unknown): void {
  if (hasErrorCode(error, "TOURNAMENT_CLOSED", "AP_EXCEEDS_GROSS")) void invalidateTournament(queryClient, tournamentId);
}

/** Sets the manual AP total or the manual prize pool (clearing the other), or goes back to the calculated pool. */
export function useAdjustPrizePool(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PrizePoolAdjustmentInput) => adjustPrizePool(tournamentId, input),
    onSuccess: (response) => showMoneyResponse(queryClient, tournamentId, response),
    onError: (error) => refreshWhenOutOfDate(queryClient, tournamentId, error),
  });
}

/** Changes the AP rates; the manual AP total is cleared unless `keepOverride`. */
export function useChangeRakeRates(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RakeRatesInput) => changeRakeRates(tournamentId, input),
    onSuccess: (response) => showMoneyResponse(queryClient, tournamentId, response),
    onError: (error) => refreshWhenOutOfDate(queryClient, tournamentId, error),
  });
}
