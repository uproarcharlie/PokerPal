/**
 * What to refresh after a change, in one place per kind of change, so every mutation that touches a
 * tournament (or a club, a season, a player) refreshes the same screens. Each helper returns the
 * promise of the refetches, for a mutation that wants to wait for fresh data before it closes.
 */
import type { InvalidateOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import { qk } from "./query-keys";

function invalidateAll(queryClient: QueryClient, keys: readonly QueryKey[], options?: InvalidateOptions): Promise<void> {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }, options))).then(() => undefined);
}

/**
 * A tournament changed, or anything in it (a registration, a count, an elimination, a payment, a
 * request, the pool): its detail and every list under it, the tournament lists (counts, status) and
 * the dashboard's totals.
 */
export function invalidateTournament(queryClient: QueryClient, id: string): Promise<void> {
  return invalidateAll(queryClient, [qk.tournaments.detail(id), qk.tournaments.lists(), qk.dashboard.stats()]);
}

/**
 * Results changed (finalize, or a correction): the tournament as above, plus the season leaderboards
 * and the players' lists (their points and places).
 */
export function invalidateResults(queryClient: QueryClient, tournamentId: string): Promise<void> {
  return Promise.all([
    invalidateTournament(queryClient, tournamentId),
    invalidateAll(queryClient, [qk.seasons.all(), qk.players.all()]),
  ]).then(() => undefined);
}

/**
 * A followed tournament's results were written (it closed, or they were corrected), as its own poll
 * just said: what the results change, without the tournament itself — its registrations, activity and
 * prize pool, the season leaderboards and the players' lists. A refetch already on its way (this
 * device's own finalize started one) is left to finish rather than cancelled and sent again
 * (P3REV-PERF-RESULTS-VERSION; the prize pool too: R4-CQ-03).
 */
export function invalidateWrittenResults(queryClient: QueryClient, tournamentId: string): Promise<void> {
  return invalidateAll(
    queryClient,
    [
      qk.tournaments.registrations(tournamentId),
      qk.tournaments.activity(tournamentId),
      qk.tournaments.prizePool(tournamentId),
      qk.seasons.all(),
      qk.players.all(),
    ],
    { cancelRefetch: false },
  );
}

/**
 * A tournament was created or deleted: every tournament list and the dashboard. A deleted tournament
 * also takes its results with it (its registrations cascade), so the season leaderboards it counted
 * towards and the players' lists it fed are refreshed too (P3REV-PARITY-DEL-01).
 */
export function invalidateTournamentLists(queryClient: QueryClient, { deleted = false }: { deleted?: boolean } = {}): Promise<void> {
  const keys: QueryKey[] = [qk.tournaments.lists(), qk.dashboard.stats()];
  if (deleted) keys.push(qk.seasons.all(), qk.players.all());
  return invalidateAll(queryClient, keys);
}

/**
 * A club changed, was created or deleted, or its staff changed: every club query (by id and by slug
 * alike) and the dashboard. A deleted club also takes its seasons and tournaments with it. A renamed
 * rake ("AP") heads every one of its tournaments' prize pools and live displays, so they refresh too
 * (P4REV4-CQ-04).
 */
export function invalidateClub(queryClient: QueryClient, { deleted = false, rakeRenamed = false }: { deleted?: boolean; rakeRenamed?: boolean } = {}): Promise<void> {
  const keys: QueryKey[] = [qk.clubs.all(), qk.dashboard.stats()];
  if (deleted) keys.push(qk.seasons.all(), qk.tournaments.all());
  else if (rakeRenamed) keys.push(qk.tournaments.all());
  return invalidateAll(queryClient, keys);
}

/** A season, its points systems or allocations changed: every season query, and the dashboard. */
export function invalidateSeason(queryClient: QueryClient): Promise<void> {
  return invalidateAll(queryClient, [qk.seasons.all(), qk.pointsSystems.all(), qk.dashboard.stats()]);
}

/**
 * A player changed (name, phone, photo): the player lists, the tournament lists that show players by
 * name and photo (registrations, standings, leaderboards), and the admin's user list, whose player
 * rows show them too, wherever the player was edited from (P3REV5-CQ-16).
 */
export function invalidatePlayers(queryClient: QueryClient): Promise<void> {
  return invalidateAll(queryClient, [qk.players.all(), qk.tournaments.all(), qk.seasons.all(), qk.admin.users()]);
}

/** An admin changed an account: the user list. */
export function invalidateUsers(queryClient: QueryClient): Promise<void> {
  return invalidateAll(queryClient, [qk.admin.users()]);
}
