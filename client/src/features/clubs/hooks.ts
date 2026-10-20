/**
 * The club reads, one hook each, used by every feature that shows a club (the public club and
 * tournament pages included). The staff list and every change are in staff-hooks.ts, so the public
 * pages never load them.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { clubQueries } from "./api";

interface Enabled {
  /** False to wait (e.g. until another query has answered). */
  enabled?: boolean;
}

/** Every club the viewer may see, oldest first; `limit` keeps the first few (the public home page). */
export const useClubs = ({ limit, enabled = true }: { limit?: number } & Enabled = {}) =>
  useQuery({ ...clubQueries.list(limit === undefined ? undefined : { limit }), enabled });

/** One club; nothing is asked until its id is known. */
export const useClub = (id: string | null | undefined) => useQuery({ ...clubQueries.detail(id ?? ""), enabled: Boolean(id) });

/** Several clubs by id, each its own query (the same cache entry `useClub` reads). */
export const useClubsByIds = (ids: readonly string[]) => useQueries({ queries: ids.map((id) => clubQueries.detail(id)) });

export const useClubBySlug = (slug: string) => useQuery({ ...clubQueries.bySlug(slug), enabled: Boolean(slug) });

/** Members per club, for the club lists. */
export const useMemberCounts = ({ enabled = true }: Enabled = {}) => useQuery({ ...clubQueries.memberCounts(), enabled });

export const useClubMembersCount = (id: string) => useQuery({ ...clubQueries.membersCount(id), enabled: Boolean(id) });
