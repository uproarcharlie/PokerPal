import { describe, expect, it } from "vitest";
import { qk } from "./query-keys";

/** Whether invalidating `prefix` reaches `key` (TanStack Query matches keys by prefix). */
const covers = (prefix: readonly unknown[], key: readonly unknown[]) => JSON.stringify(key.slice(0, prefix.length)) === JSON.stringify(prefix);

describe("qk", () => {
  it("puts everything about one tournament under its detail key, so one invalidation refreshes it all", () => {
    const detail = qk.tournaments.detail("t1");
    for (const key of [
      qk.tournaments.registrations("t1"),
      qk.tournaments.activity("t1"),
      qk.tournaments.prizePool("t1"),
      qk.tournaments.pendingRegistrations("t1"),
      qk.tournaments.confirmedRegistrations("t1"),
      qk.tournaments.pendingActions("t1"),
      qk.tournaments.playerSearch("t1", "Bo"),
      qk.tournaments.display("t1"),
      qk.tournaments.seating("t1"),
      qk.tournaments.publicSeating("t1"),
    ]) {
      expect(covers(detail, key)).toBe(true);
    }
    expect(covers(detail, qk.tournaments.registrations("t2"))).toBe(false);
  });

  it("puts a season's public leaderboard and a club's blind structures under their detail keys", () => {
    expect(covers(qk.seasons.detail("s1"), qk.seasons.publicLeaderboard("s1"))).toBe(true);
    expect(covers(qk.clubs.detail("c1"), qk.clubs.blindStructures("c1"))).toBe(true);
  });

  it("keeps the finalize preview out of the tournament's keys, so refreshing a finalized tournament never re-previews it", () => {
    expect(covers(qk.tournaments.all(), qk.finalizePreview("t1", {}))).toBe(false);
  });

  it("makes equal filters equal keys, whatever is left undefined", () => {
    expect(qk.tournaments.list({ clubId: "c1", seasonId: undefined })).toEqual(qk.tournaments.list({ clubId: "c1" }));
    expect(qk.seasons.list()).toEqual(qk.seasons.list({}));
    expect(covers(qk.tournaments.lists(), qk.tournaments.list({ upcoming: true, limit: 6 }))).toBe(true);
  });

  it("reaches a club looked up by slug or by id from the clubs root, slug case ignored", () => {
    expect(qk.clubs.bySlug("Central-Stars")).toEqual(qk.clubs.bySlug("central-stars"));
    expect(covers(qk.clubs.all(), qk.clubs.bySlug("central-stars"))).toBe(true);
    expect(covers(qk.clubs.detail("c1"), qk.clubs.staff("c1"))).toBe(true);
    expect(covers(qk.seasons.detail("s1"), qk.seasons.leaderboard("s1"))).toBe(true);
    expect(covers(qk.pointsSystems.detail("p1"), qk.pointsSystems.allocations("p1"))).toBe(true);
  });

  it("never names a URL, so a key cannot be mistaken for the legacy URL-keyed queries", () => {
    const roots = [qk.auth.me(), qk.admin.users(), qk.clubs.all(), qk.seasons.all(), qk.pointsSystems.all(), qk.players.all(), qk.tournaments.all(), qk.dashboard.stats()];
    for (const [root] of roots) expect(String(root).startsWith("/")).toBe(false);
  });
});
