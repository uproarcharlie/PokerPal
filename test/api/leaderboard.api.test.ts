/**
 * The season leaderboard (GET /api/seasons/:seasonId/leaderboard, server/routes/leaderboard.ts):
 * one aggregate over the season's registrations, highest total first with competition ranks, and
 * players reduced to their public fields (SEC-09).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Player } from "@shared/schema";
import { findForbiddenKeys, pickFields, PUBLIC_PLAYER_FIELDS } from "@shared/api/public";
import { createClub, createPlayer, createRegistration, createSeason, createTournament, createUser } from "../factories";
import { anon, resetDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

/** Registers each player in the tournament with the points they were awarded (null: none). */
async function award(tournamentId: string, results: ReadonlyArray<[Player, number | null]>) {
  for (const [player, pointsAwarded] of results) {
    await createRegistration({ tournamentId, playerId: player.id, pointsAwarded, paymentConfirmed: true });
  }
}

const publicPlayer = (player: Player) => pickFields(player, PUBLIC_PLAYER_FIELDS);

async function seasonOfClub() {
  const club = await createClub();
  return { club, season: await createSeason({ clubId: club.id }) };
}

describe("GET /api/seasons/:seasonId/leaderboard", () => {
  it("totals points per player across the season's tournaments, highest first, counting only tournaments where they scored", async () => {
    const { club, season } = await seasonOfClub();
    const otherSeason = await createSeason({ clubId: club.id });
    const [alice, bob, carol, dave, erin] = await Promise.all(
      ["Alice", "Bob", "Carol", "Dave", "Erin"].map((name) => createPlayer({ name })),
    );
    const finished = await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" });
    const running = await createTournament({ clubId: club.id, seasonId: season.id, status: "in_progress" });
    const elsewhere = await createTournament({ clubId: club.id, seasonId: otherSeason.id, status: "completed" });
    const unseasoned = await createTournament({ clubId: club.id, seasonId: null, status: "completed" });
    await award(finished.id, [[alice, 10], [bob, 7], [carol, 3], [dave, null], [erin, 0]]);
    await award(running.id, [[alice, 5], [carol, 7], [dave, 2]]);
    await award(elsewhere.id, [[bob, 100]]);
    await award(unseasoned.id, [[alice, 50]]);

    const response = await (await anon()).get(`/api/seasons/${season.id}/leaderboard`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { rank: 1, player: publicPlayer(alice), points: 15, tournaments: 2 },
      { rank: 2, player: publicPlayer(carol), points: 10, tournaments: 2 },
      { rank: 3, player: publicPlayer(bob), points: 7, tournaments: 1 },
      { rank: 4, player: publicPlayer(dave), points: 2, tournaments: 1 },
    ]);
  });

  it("gives tied players the same rank, ordered by name, and skips the ranks they share", async () => {
    const { club, season } = await seasonOfClub();
    const [alice, bob, carol, dave] = await Promise.all(["Alice", "Bob", "Carol", "Dave"].map((name) => createPlayer({ name })));
    const first = await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" });
    const second = await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" });
    await award(first.id, [[bob, 10], [alice, 6], [dave, 3]]);
    await award(second.id, [[alice, 4], [carol, 4]]);

    const response = await (await anon()).get(`/api/seasons/${season.id}/leaderboard`);

    expect(response.status).toBe(200);
    expect((response.body as Array<{ rank: number; player: { name: string }; points: number }>).map((e) => [e.rank, e.player.name, e.points])).toEqual([
      [1, "Alice", 10],
      [1, "Bob", 10],
      [3, "Carol", 4],
      [4, "Dave", 3],
    ]);
  });

  it("returns an empty list for a season with no points awarded", async () => {
    const { club, season } = await seasonOfClub();
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id });
    await award(tournament.id, [[await createPlayer(), null]]);

    const response = await (await anon()).get(`/api/seasons/${season.id}/leaderboard`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("answers 404 for an unknown season", async () => {
    const response = await (await anon()).get(`/api/seasons/${UNKNOWN_ID}/leaderboard`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found", code: "NOT_FOUND" });
  });

  it("does not expose players' email addresses, phone numbers or linked accounts (SEC-09)", async () => {
    const { club, season } = await seasonOfClub();
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" });
    const account = await createUser();
    const player = await createPlayer({ email: "alice@example.test", phone: "021 555 0101", userId: account.id });
    await award(tournament.id, [[player, 10]]);

    const response = await (await anon()).get(`/api/seasons/${season.id}/leaderboard`);

    expect(response.status).toBe(200);
    expect(findForbiddenKeys(response.body)).toEqual([]);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain("alice@example.test");
    expect(body).not.toContain("021 555 0101");
    expect(body).not.toContain(account.id);
  });
});
