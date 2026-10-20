/**
 * The tournament reads anyone may make: the lists, a tournament, its registrations and its activity,
 * used by the TD's desk and the public pages alike. The desk's own lists, the finalize preview and
 * every change are in staff-api.ts, so the public pages never load them. Every key comes from `qk`;
 * every type from shared/api.
 */
import { queryOptions } from "@tanstack/react-query";
import type { ActivityDto, PublicRegistration } from "@shared/api/public";
import type { TournamentCountsDto, TournamentDetailDto, TournamentListItemDto, TournamentsQuery } from "@shared/api/tournaments";
import { apiGet, segment, withQuery } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";

export const tournamentPath = (id: string) => `/api/tournaments/${segment(id)}`;

export const tournamentQueries = {
  list: (query: TournamentsQuery = {}) =>
    queryOptions({
      queryKey: qk.tournaments.list(query),
      queryFn: ({ signal }) =>
        apiGet<TournamentListItemDto[]>(withQuery("/api/tournaments", query), { signal }),
    }),
  /** Tournaments per club (all and active) and per season, counted by the server. */
  counts: () =>
    queryOptions({
      queryKey: qk.tournaments.counts(),
      queryFn: ({ signal }) => apiGet<TournamentCountsDto>("/api/tournaments/counts", { signal }),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: qk.tournaments.detail(id),
      queryFn: ({ signal }) => apiGet<TournamentDetailDto>(tournamentPath(id), { signal }),
    }),
  /** The club's staff get ManagedRegistration (with payment status); everyone else PublicRegistration. */
  registrations: (id: string) =>
    queryOptions({
      queryKey: qk.tournaments.registrations(id),
      queryFn: ({ signal }) => apiGet<PublicRegistration[]>(`${tournamentPath(id)}/registrations`, { signal }),
    }),
  /** The newest `limit` events, or (without one) the whole feed as the server keeps it. */
  activity: (id: string, limit?: number) =>
    queryOptions({
      queryKey: qk.tournaments.activity(id, limit === undefined ? undefined : { limit }),
      queryFn: ({ signal }) => apiGet<ActivityDto[]>(withQuery(`${tournamentPath(id)}/activity`, { limit }), { signal }),
    }),
};
