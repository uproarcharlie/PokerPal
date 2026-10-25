/**
 * GET /api/public/seasons/:id/leaderboard (phase4-contracts §3.2 rule 10): the season page the TV's
 * QR code opens. The same rows as GET /api/seasons/:id/leaderboard (competition ranking, players with
 * points only, PublicPlayer), headed by the season and its club, with how far the season has got.
 * Public, PII-free and never cached.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import type { Season } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createSeason, createTournament, createUser } from "../factories";
import { anon, resetDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const leaderboardOf = async (season: Pick<Season, "id">) => (await anon()).get(`/api/public/seasons/${season.id}/leaderboard`);

describe("GET /api/public/seasons/:id/leaderboard", () => {
  it("answers 404 for an unknown season", async () => {
    const response = await leaderboardOf({ id: UNKNOWN_ID });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found", code: "NOT_FOUND" });
  });

  it("heads the standings with the season and club, counts its tournaments, and is never cached", async () => {
    const owner = await createUser({ email: "owner@example.test" });
    const club = await createClub({ ownerId: owner.id, name: "Central Stars", imageUrl: "/uploads/club.webp" });
    const season = await createSeason({
      clubId: club.id,
      name: "Winter 2026",
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: null,
      isActive: true,
    });
    const [first, second, cancelled] = [
      await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" }),
      await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" }),
      await createTournament({ clubId: club.id, seasonId: season.id, status: "cancelled" }),
    ];
    await createTournament({ clubId: club.id, seasonId: season.id, status: "scheduled" });
    const [alice, bob, carol, dave] = [
      await createPlayer({ name: "Alice", email: "alice@example.test", phone: "021 000 001" }),
      await createPlayer({ name: "Bob", email: "bob@example.test", phone: "021 000 002" }),
      await createPlayer({ name: "Carol", email: "carol@example.test", phone: "021 000 003" }),
      await createPlayer({ name: "Dave", email: "dave@example.test", phone: "021 000 004" }),
    ];
    await createRegistration({ tournamentId: first.id, playerId: alice.id, pointsAwarded: 50 });
    await createRegistration({ tournamentId: first.id, playerId: bob.id, pointsAwarded: 30 });
    await createRegistration({ tournamentId: second.id, playerId: carol.id, pointsAwarded: 30 });
    await createRegistration({ tournamentId: second.id, playerId: alice.id, pointsAwarded: 10 });
    await createRegistration({ tournamentId: second.id, playerId: dave.id, pointsAwarded: 0 });
    await createRegistration({ tournamentId: cancelled.id, playerId: dave.id });

    const response = await leaderboardOf(season);
    const legacy = await (await anon()).get(`/api/seasons/${season.id}/leaderboard`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      season: { id: season.id, name: "Winter 2026", startDate: "2026-06-01T00:00:00.000Z", endDate: null, isActive: true },
      club: { id: club.id, name: "Central Stars", slug: club.slug, imageUrl: "/uploads/club.webp", theme: null },
      entries: legacy.body,
      tournaments: { completed: 2, total: 3 },
      generatedAt: expect.any(String),
    });
    expect(response.body.entries.map((entry: { rank: number; player: { name: string }; points: number }) => [entry.rank, entry.player.name, entry.points])).toEqual([
      [1, "Alice", 60],
      [2, "Bob", 30],
      [2, "Carol", 30],
    ]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
    expect(JSON.stringify(response.body)).not.toMatch(/@example\.test|021 000|ownerId/);
    expect(JSON.stringify(response.body)).not.toContain(owner.id);
  });

  it("shows a season with no points yet, and a finished one as not active", async () => {
    const club = await createClub();
    const season = await createSeason({ clubId: club.id, isActive: false });

    const response = await leaderboardOf(season);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ season: { isActive: false }, entries: [], tournaments: { completed: 0, total: 0 } });
  });
});
