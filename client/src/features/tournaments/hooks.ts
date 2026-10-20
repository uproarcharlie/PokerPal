/**
 * The tournament reads the public pages and the staff screens share: the lists, a tournament, its
 * registrations and its activity. Polling follows the screens as they were (phase3-conventions §3.5):
 * a followed tournament every LIVE_REFRESH_MS while it is open and slowly for a while after it is
 * finalized (lib/live-refresh). The desks' own lists and every change are in staff-hooks.ts, so the
 * public pages never load them.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TournamentDetailDto, TournamentsQuery } from "@shared/api/tournaments";
import { invalidateWrittenResults } from "@/lib/api/invalidate";
import { LIVE_REFRESH_MS, liveRegistrationsInterval, liveTournamentInterval, resultsVersion, unlessRefused } from "@/lib/live-refresh";
import { tournamentQueries } from "./api";

/**
 * A tournament. With `live` (a page that follows it: the TD's page, the public page) it is asked again
 * while it is open, and for a while after it is finalized so a Correct Results shows up; a tournament
 * that never loaded is not polled. The desks read it once, for its name, prices and who may run it.
 */
export function useTournament(id: string, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    ...tournamentQueries.detail(id),
    enabled: Boolean(id),
    refetchInterval: live ? ({ state }) => unlessRefused(state.error, liveTournamentInterval(state.data)) : false,
  });
}

type Followed = Pick<TournamentDetailDto, "status" | "finalizedAt">;

/**
 * Its registrations. Asked for from the URL's id, alongside the tournament (PERF-07), and, given the
 * loaded tournament to `follow`: polled every LIVE_REFRESH_MS while it is open, so the pool on screen is
 * the one the server pays from; and whenever it closes or its results are written again, the results
 * (these registrations, the season's leaderboard) are asked for once more, so the places and prizes
 * appear even when the last poll ran before the finalize (P3REV0-PARITY-01).
 */
export function useRegistrations(id: string, { follow }: { follow?: Followed } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...tournamentQueries.registrations(id),
    enabled: Boolean(id),
    refetchInterval: ({ state }) => unlessRefused(state.error, liveRegistrationsInterval(follow)),
  });
  const version = follow === undefined ? undefined : resultsVersion(follow);
  const seenVersion = useRef(version);
  useEffect(() => {
    const previous = seenVersion.current;
    seenVersion.current = version;
    if (previous !== undefined && version !== undefined && version !== previous) void invalidateWrittenResults(queryClient, id);
  }, [version, queryClient, id]);
  return query;
}

/**
 * How many of the newest events the feed follows. Every phone with the feed open asks for it every few
 * seconds over the venue's Wi-Fi, and the newest are what anyone is reading; the rest of a long night
 * is fetched once, when asked for (P3REV-PERF-ACTIVITY-FULL-LIST-POLL).
 */
export const ACTIVITY_FEED_LIMIT = 50;

/** What has happened in it lately, newest first; followed every LIVE_REFRESH_MS while it is `live` (open). */
export function useActivity(id: string, { live }: { live: boolean }) {
  return useQuery({
    ...tournamentQueries.activity(id, ACTIVITY_FEED_LIMIT),
    enabled: Boolean(id),
    refetchInterval: ({ state }) => unlessRefused(state.error, live ? LIVE_REFRESH_MS : false),
  });
}

/** Everything that has happened in it, newest first, read once when `enabled` (the feed's "Show earlier activity"). */
export function useWholeActivity(id: string, { enabled }: { enabled: boolean }) {
  return useQuery({ ...tournamentQueries.activity(id), enabled: enabled && Boolean(id) });
}

export function useTournaments(query: TournamentsQuery = {}, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...tournamentQueries.list(query), enabled });
}

/**
 * How many tournaments each club and season has: what the Clubs and Seasons pages count, without
 * downloading every tournament ever run to count them (P3REV3-CQ-12).
 */
export const useTournamentCounts = () => useQuery(tournamentQueries.counts());
