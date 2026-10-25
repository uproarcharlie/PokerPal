/**
 * A tournament's prize pool and AP as the server works them out (GET /api/tournaments/:id/prize-pool,
 * public): the live breakdown, the payouts to show and the last manual adjustment. The changes (the
 * manual AP total, the manual pool, the rates) are in staff-api.ts, so a public page never loads them.
 */
import { queryOptions } from "@tanstack/react-query";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import { apiGet } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { tournamentPath } from "@/features/tournaments/api";

export const prizePoolPath = (tournamentId: string) => `${tournamentPath(tournamentId)}/prize-pool`;

export const prizePoolQueries = {
  detail: (tournamentId: string) =>
    queryOptions({
      queryKey: qk.tournaments.prizePool(tournamentId),
      queryFn: ({ signal }) => apiGet<PrizePoolDto>(prizePoolPath(tournamentId), { signal }),
    }),
};
