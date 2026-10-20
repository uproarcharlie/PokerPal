/**
 * The season reads: seasons, their leaderboards and points systems, used by the seasons screens and by
 * every other screen that shows a season (the public club and tournament pages, the dashboard). A
 * season, its leaderboard and its points rules are lookups (LOOKUP_STALE_MS): finalizing, correcting
 * results or changing a season refreshes them through the invalidation helpers. Changes are in
 * staff-api.ts, so the public pages never load them.
 */
import { queryOptions } from "@tanstack/react-query";
import type { PublicPointsAllocation, PublicPointsSystem, PublicSeason } from "@shared/api/public";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { apiGet, segment, withQuery } from "@/lib/api/http";
import { LOOKUP_STALE_MS } from "@/lib/api/query-client";
import { qk } from "@/lib/api/query-keys";

export const seasonPath = (id: string) => `/api/seasons/${segment(id)}`;

export const seasonQueries = {
  /** Every season (or one club's), oldest first. */
  list: (clubId?: string) =>
    queryOptions({
      queryKey: qk.seasons.list({ clubId }),
      queryFn: ({ signal }) => apiGet<PublicSeason[]>(withQuery("/api/seasons", { clubId }), { signal }),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: qk.seasons.detail(id),
      queryFn: ({ signal }) => apiGet<PublicSeason>(seasonPath(id), { signal }),
      staleTime: LOOKUP_STALE_MS,
    }),
  /** Ranked by the server: tied players share a rank and are ordered by name. 404 for an unknown season. */
  leaderboard: (id: string) =>
    queryOptions({
      queryKey: qk.seasons.leaderboard(id),
      queryFn: ({ signal }) => apiGet<LeaderboardEntryDto[]>(`${seasonPath(id)}/leaderboard`, { signal }),
      staleTime: LOOKUP_STALE_MS,
    }),
  pointsSystems: (id: string) =>
    queryOptions({
      queryKey: qk.seasons.pointsSystems(id),
      queryFn: ({ signal }) => apiGet<PublicPointsSystem[]>(`${seasonPath(id)}/points-systems`, { signal }),
      staleTime: LOOKUP_STALE_MS,
    }),
};

export const pointsSystemQueries = {
  detail: (id: string) =>
    queryOptions({
      queryKey: qk.pointsSystems.detail(id),
      queryFn: ({ signal }) => apiGet<PublicPointsSystem>(`/api/points-systems/${segment(id)}`, { signal }),
      staleTime: LOOKUP_STALE_MS,
    }),
  /** Ordered by position. */
  allocations: (id: string) =>
    queryOptions({
      queryKey: qk.pointsSystems.allocations(id),
      queryFn: ({ signal }) => apiGet<PublicPointsAllocation[]>(`/api/points-systems/${segment(id)}/allocations`, { signal }),
      staleTime: LOOKUP_STALE_MS,
    }),
};
