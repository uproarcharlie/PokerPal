/**
 * The seating read anyone may make: "Find your seat" (/tournament/:id/seats) and the TV clock's
 * seating overlay both show it. Staff reads and every change are in staff-api.ts, so public pages never
 * load them. The key comes from `qk`, the type from shared/api.
 */
import { queryOptions } from "@tanstack/react-query";
import type { PublicSeatingDto } from "@shared/api/seating";
import { apiGet, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";

/** How often a public seating screen asks again while it is shown (phase4-contracts §6). */
export const PUBLIC_SEATING_REFRESH_MS = 15_000;

export const publicSeatingQueries = {
  /** Active tables and every seated player (PublicPlayer only); 404 for an unknown tournament. */
  detail: (tournamentId: string) =>
    queryOptions({
      queryKey: qk.tournaments.publicSeating(tournamentId),
      queryFn: ({ signal }) => apiGet<PublicSeatingDto>(`/api/public/tournaments/${segment(tournamentId)}/seating`, { signal }),
    }),
};
