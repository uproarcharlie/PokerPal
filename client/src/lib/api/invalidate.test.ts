import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  invalidateClub,
  invalidatePlayers,
  invalidateResults,
  invalidateSeason,
  invalidateTournament,
  invalidateTournamentLists,
  invalidateWrittenResults,
} from "./invalidate";
import { qk } from "./query-keys";

function clientWith(keys: readonly (readonly unknown[])[]): QueryClient {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData(key, { cached: true });
  return client;
}

const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated ?? false;

describe("invalidation helpers", () => {
  it("invalidateTournament refreshes that tournament, every list under it, the tournament lists and the dashboard", async () => {
    const keys = [
      qk.tournaments.detail("t1"),
      qk.tournaments.registrations("t1"),
      qk.tournaments.activity("t1"),
      qk.tournaments.pendingActions("t1"),
      qk.tournaments.list({ clubId: "c1" }),
      qk.dashboard.stats(),
      qk.tournaments.detail("t2"),
      qk.finalizePreview("t1", {}),
      qk.clubs.detail("c1"),
    ];
    const client = clientWith(keys);

    await invalidateTournament(client, "t1");

    expect(keys.slice(0, 6).map((key) => invalidated(client, key))).toEqual([true, true, true, true, true, true]);
    expect(invalidated(client, qk.tournaments.detail("t2"))).toBe(false);
    expect(invalidated(client, qk.finalizePreview("t1", {}))).toBe(false);
    expect(invalidated(client, qk.clubs.detail("c1"))).toBe(false);
  });

  it("invalidateResults adds the season leaderboards and the players", async () => {
    const client = clientWith([qk.seasons.leaderboard("s1"), qk.players.list(), qk.tournaments.detail("t1")]);

    await invalidateResults(client, "t1");

    expect(invalidated(client, qk.seasons.leaderboard("s1"))).toBe(true);
    expect(invalidated(client, qk.players.list())).toBe(true);
    expect(invalidated(client, qk.tournaments.detail("t1"))).toBe(true);
  });

  it("invalidateWrittenResults refreshes what results change, never the tournament whose poll reported them", async () => {
    const keys = [qk.tournaments.registrations("t1"), qk.tournaments.activity("t1"), qk.seasons.leaderboard("s1"), qk.players.list(), qk.tournaments.detail("t1")];
    const client = clientWith(keys);

    await invalidateWrittenResults(client, "t1");

    expect(keys.map((key) => invalidated(client, key))).toEqual([true, true, true, true, false]);
  });

  it("invalidateTournamentLists refreshes the leaderboards and players only for a deleted tournament, whose results go with it (P3REV-PARITY-DEL-01)", async () => {
    const client = clientWith([qk.tournaments.list(), qk.dashboard.stats(), qk.seasons.leaderboard("s1"), qk.players.list()]);

    await invalidateTournamentLists(client);
    expect(invalidated(client, qk.tournaments.list())).toBe(true);
    expect(invalidated(client, qk.dashboard.stats())).toBe(true);
    expect(invalidated(client, qk.seasons.leaderboard("s1"))).toBe(false);
    expect(invalidated(client, qk.players.list())).toBe(false);

    await invalidateTournamentLists(client, { deleted: true });
    expect(invalidated(client, qk.seasons.leaderboard("s1"))).toBe(true);
    expect(invalidated(client, qk.players.list())).toBe(true);
  });

  it("invalidateWrittenResults lets a refetch already on its way finish, not cancel it and ask again (P3REV-PERF-RESULTS-VERSION)", async () => {
    const client = new QueryClient();
    let asked = 0;
    let answer: () => void = () => {};
    const observer = new QueryObserver(client, {
      queryKey: qk.tournaments.registrations("t1"),
      queryFn: () => {
        asked += 1;
        return new Promise<never[]>((resolve) => (answer = () => resolve([])));
      },
    });
    const stop = observer.subscribe(() => {});
    expect(asked).toBe(1);

    const refreshed = invalidateWrittenResults(client, "t1");
    answer();
    await refreshed;

    expect(asked).toBe(1);
    stop();
  });

  it("invalidateClub reaches the club by slug too, and a deleted club's seasons and tournaments", async () => {
    const client = clientWith([qk.clubs.bySlug("central-stars"), qk.clubs.memberCounts(), qk.seasons.list(), qk.tournaments.list()]);

    await invalidateClub(client);
    expect(invalidated(client, qk.clubs.bySlug("central-stars"))).toBe(true);
    expect(invalidated(client, qk.clubs.memberCounts())).toBe(true);
    expect(invalidated(client, qk.seasons.list())).toBe(false);

    await invalidateClub(client, { deleted: true });
    expect(invalidated(client, qk.seasons.list())).toBe(true);
    expect(invalidated(client, qk.tournaments.list())).toBe(true);
  });

  it("invalidateSeason covers points systems; invalidatePlayers covers the lists that show players", async () => {
    const client = clientWith([qk.pointsSystems.allocations("p1"), qk.tournaments.registrations("t1"), qk.seasons.leaderboard("s1")]);

    await invalidateSeason(client);
    expect(invalidated(client, qk.pointsSystems.allocations("p1"))).toBe(true);
    expect(invalidated(client, qk.tournaments.registrations("t1"))).toBe(false);

    await invalidatePlayers(client);
    expect(invalidated(client, qk.tournaments.registrations("t1"))).toBe(true);
  });

  it("invalidatePlayers also refreshes the admin's user list, which shows players too, wherever one was edited (P3REV5-CQ-16)", async () => {
    const client = clientWith([qk.admin.users()]);

    await invalidatePlayers(client);

    expect(invalidated(client, qk.admin.users())).toBe(true);
  });
});
