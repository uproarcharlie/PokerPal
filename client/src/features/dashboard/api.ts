/**
 * The staff dashboard's own read: its totals, scoped by the server to the viewer's clubs. The club,
 * tournament and season lists it narrows to those clubs come from their own features. Every key comes
 * from `qk`; every type from shared/api.
 */
import { queryOptions } from "@tanstack/react-query";
import type { DashboardStatsDto } from "@shared/api/dashboard";
import { apiGet } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";

export const dashboardQueries = {
  stats: () =>
    queryOptions({ queryKey: qk.dashboard.stats(), queryFn: ({ signal }) => apiGet<DashboardStatsDto>("/api/dashboard/stats", { signal }) }),
};
