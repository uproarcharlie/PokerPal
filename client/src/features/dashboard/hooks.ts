/**
 * The dashboard's reads, scoped to what its cards show (P3REV4-PERF-09): the server filters the
 * tournaments by status and the seasons by club, so the dashboard's downloads grow with the viewer's
 * live tournaments and clubs, not with every tournament the platform has ever run.
 */
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ACTIVE_STATUSES } from "@shared/domain/tournaments";
import type { QueryLike } from "@/components/shared/query-state";
import { seasonQueries } from "@/features/seasons/api";
import { tournamentQueries } from "@/features/tournaments/api";
import { dashboardQueries } from "./api";

export const useDashboardStats = () => useQuery(dashboardQueries.stats());

/** Several list queries read as one: loaded once all are, failed when one failed with nothing to show. */
function combineLists<T>(results: UseQueryResult<T[]>[]): QueryLike<T[]> {
  const failed = results.find((result) => result.isError && result.data === undefined);
  return {
    data: results.every((result) => result.data !== undefined) ? results.flatMap((result) => result.data ?? []) : undefined,
    error: failed?.error ?? null,
    isPending: failed === undefined && results.some((result) => result.isPending),
    isError: failed !== undefined,
    isRefetching: results.some((result) => result.isRefetching),
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}

/** Running and open-for-registration tournaments (every club's; the cards keep the viewer's). */
export const useActiveTournaments = () =>
  useQueries({ queries: ACTIVE_STATUSES.map((status) => tournamentQueries.list({ status })), combine: combineLists });

/**
 * The seasons of the clubs in `clubIds`, one request per club; `undefined` asks for every season in
 * one request, for a viewer who runs every club (an admin), whose scope that is.
 */
export const useScopedSeasons = (clubIds: readonly string[] | undefined) =>
  useQueries({
    queries: clubIds === undefined ? [seasonQueries.list()] : clubIds.map((clubId) => seasonQueries.list(clubId)),
    combine: combineLists,
  });
