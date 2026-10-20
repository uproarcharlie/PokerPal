/**
 * The club endpoints anyone may read (phase2-contracts §2.4), used by the public club pages and by
 * every staff screen that shows a club. Changes and the staff list are in staff-api.ts, so the public
 * pages never load them. Every key comes from `qk`; every type from shared/api.
 */
import { queryOptions } from "@tanstack/react-query";
import type { ClubsQuery, MemberCountsResponse, MembersCountResponse } from "@shared/api/clubs";
import type { ClubDto } from "@shared/api/public";
import { apiGet, segment, withQuery } from "@/lib/api/http";
import { LOOKUP_STALE_MS } from "@/lib/api/query-client";
import { qk } from "@/lib/api/query-keys";

export const clubPath = (id: string) => `/api/clubs/${segment(id)}`;

export const clubQueries = {
  /** Oldest first; the public home page asks for the first few only. */
  list: (query?: ClubsQuery) =>
    queryOptions({
      queryKey: qk.clubs.list(query),
      queryFn: ({ signal }) => apiGet<ClubDto[]>(withQuery("/api/clubs", { limit: query?.limit }), { signal }),
    }),
  detail: (id: string) =>
    queryOptions({ queryKey: qk.clubs.detail(id), queryFn: ({ signal }) => apiGet<ClubDto>(clubPath(id), { signal }), staleTime: LOOKUP_STALE_MS }),
  bySlug: (slug: string) =>
    queryOptions({
      queryKey: qk.clubs.bySlug(slug),
      queryFn: ({ signal }) => apiGet<ClubDto>(`/api/clubs/slug/${segment(slug)}`, { signal }),
      staleTime: LOOKUP_STALE_MS,
    }),
  memberCounts: () =>
    queryOptions({
      queryKey: qk.clubs.memberCounts(),
      queryFn: ({ signal }) => apiGet<MemberCountsResponse>("/api/clubs/member-counts", { signal }),
    }),
  membersCount: (id: string) =>
    queryOptions({
      queryKey: qk.clubs.membersCount(id),
      queryFn: ({ signal }) => apiGet<MembersCountResponse>(`${clubPath(id)}/members-count`, { signal }),
    }),
};
