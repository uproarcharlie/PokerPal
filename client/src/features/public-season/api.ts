/**
 * The public season page behind the TV clock's QR code (GET /api/public/seasons/:id/leaderboard): the
 * season, its club and its standings in one PII-free answer, counted by the server's `live` limit
 * rather than the venue's shared budget. 404 for an unknown season.
 */
import { queryOptions } from "@tanstack/react-query";
import type { PublicSeasonLeaderboardDto } from "@shared/api/live-display";
import { apiGet, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";

/** How often the page asks again (phase4-contracts §7): points change only when a tournament is finalized. */
export const PUBLIC_SEASON_REFRESH_MS = 60_000;

export const publicSeasonQueries = {
  leaderboard: (seasonId: string) =>
    queryOptions({
      queryKey: qk.seasons.publicLeaderboard(seasonId),
      queryFn: ({ signal }) => apiGet<PublicSeasonLeaderboardDto>(`/api/public/seasons/${segment(seasonId)}/leaderboard`, { signal }),
      staleTime: 0,
    }),
};
