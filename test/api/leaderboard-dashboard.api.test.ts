/**
 * Characterization of today's season leaderboard and dashboard stats
 * (server/routes.ts), including the dashboard's own prize-pool arithmetic,
 * which differs from finalize's.
 *
 * The dashboard is public today; it is exercised as an admin, who keeps access
 * once it is locked down. `it.fails` tests state the correct behaviour for a
 * known hole, tagged with its audit finding id; switch them to `it` when the
 * hole is fixed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Player } from "@shared/schema";
import {
  createClub,
  createPlayer,
  createRegistration,
  createSeason,
  createTournament,
  createUser,
  type NewRegistration,
  type NewTournament,
} from "../factories";
import { anon, asJson, resetDb, signIn, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const signInAdmin = () => signIn({ role: "admin" });

interface LeaderboardEntry {
  player: { id: string };
  points: number;
  tournaments: number;
}

describe("GET /api/seasons/:seasonId/leaderboard", () => {
  /** Registers each player in the tournament with the points they were awarded (null: none). */
  async function award(tournamentId: string, results: ReadonlyArray<[Player, number | null]>) {
    for (const [player, pointsAwarded] of results) {
      await createRegistration({ tournamentId, playerId: player.id, pointsAwarded, paymentConfirmed: true });
    }
  }

  it("totals points per player across the season's tournaments, highest first, counting only tournaments where they scored", async () => {
    const club = await createClub();
    const season = await createSeason({ clubId: club.id });
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
      { player: asJson(alice), points: 15, tournaments: 2 },
      { player: asJson(carol), points: 10, tournaments: 2 },
      { player: asJson(bob), points: 7, tournaments: 1 },
      { player: asJson(dave), points: 2, tournaments: 1 },
    ]);
  });

  it("lists tied players next to each other with equal points and no rank of their own", async () => {
    const club = await createClub();
    const season = await createSeason({ clubId: club.id });
    const [alice, bob, carol] = await Promise.all(["Alice", "Bob", "Carol"].map((name) => createPlayer({ name })));
    const first = await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" });
    const second = await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" });
    await award(first.id, [[alice, 10], [bob, 6]]);
    await award(second.id, [[bob, 4], [carol, 4]]);

    const response = await (await anon()).get(`/api/seasons/${season.id}/leaderboard`);

    expect(response.status).toBe(200);
    const entries = response.body as LeaderboardEntry[];
    expect(entries.map((entry) => entry.points)).toEqual([10, 10, 4]);
    expect(entries.slice(0, 2).map((entry) => entry.player.id).sort()).toEqual([alice.id, bob.id].sort());
    expect(entries[2].player.id).toBe(carol.id);
    for (const entry of entries) expect(Object.keys(entry).sort()).toEqual(["player", "points", "tournaments"]);
  });

  it("returns an empty list for a season with no points awarded and for an unknown season", async () => {
    const club = await createClub();
    const season = await createSeason({ clubId: club.id });
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id });
    await award(tournament.id, [[await createPlayer(), null]]);

    for (const id of [season.id, UNKNOWN_ID]) {
      const response = await (await anon()).get(`/api/seasons/${id}/leaderboard`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    }
  });

  it.fails("does not expose players' email addresses, phone numbers or linked accounts (SEC-09)", async () => {
    const club = await createClub();
    const season = await createSeason({ clubId: club.id });
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id, status: "completed" });
    const account = await createUser();
    const player = await createPlayer({ email: "alice@example.test", phone: "021 555 0101", userId: account.id });
    await award(tournament.id, [[player, 10]]);

    const response = await (await anon()).get(`/api/seasons/${season.id}/leaderboard`);

    expect(response.status).toBe(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain("alice@example.test");
    expect(body).not.toContain("021 555 0101");
    expect(body).not.toContain(account.id);
  });
});

describe("GET /api/dashboard/stats", () => {
  /** A tournament in `clubId` with one registration (and one new player) per entry in `entries`. */
  async function tournamentWith(
    clubId: string,
    tournament: Partial<NewTournament>,
    entries: ReadonlyArray<
      Partial<Pick<NewRegistration, "buyIns" | "rebuys" | "addons" | "paymentConfirmed" | "finalPosition" | "prizeAmount">>
    > = [],
  ) {
    const created = await createTournament({ clubId, ...tournament });
    for (const entry of entries) {
      await createRegistration({ tournamentId: created.id, playerId: (await createPlayer()).id, paymentConfirmed: true, ...entry });
    }
    return created;
  }

  it("reports zeros when there is nothing yet", async () => {
    const { agent } = await signInAdmin();

    const response = await agent.get("/api/dashboard/stats");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ activeTournaments: 0, totalPlayers: 0, totalPrizePool: 0, activeClubs: 0 });
  });

  it("counts registration and in-progress tournaments as active, and every player and club on the platform", async () => {
    const [club, otherClub] = [await createClub(), await createClub()];
    await createClub();
    for (const status of ["scheduled", "registration", "in_progress", "completed", "cancelled"]) {
      await tournamentWith(club.id, { status });
    }
    await tournamentWith(otherClub.id, { status: "in_progress" });
    for (let index = 0; index < 4; index++) await createPlayer();
    const { agent } = await signInAdmin();

    const response = await agent.get("/api/dashboard/stats");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ activeTournaments: 3, totalPlayers: 4, totalPrizePool: 0, activeClubs: 3 });
  });

  it("totals every tournament's pool, applying the buy-in rake once to all money in it, and rounds to whole dollars", async () => {
    const club = await createClub();
    // 5 buy-ins x $50 + 2 rebuys x $25 + 1 add-on x $20 = $320, less 10% = $288.
    // The rebuy and add-on rakes are ignored, and the unpaid entry still counts.
    await tournamentWith(
      club.id,
      {
        status: "registration",
        buyInAmount: "50.00",
        rebuyAmount: "25.00",
        addonAmount: "20.00",
        rakeType: "percentage",
        rakeAmount: "10.00",
        rebuyRakeType: "percentage",
        rebuyRakeAmount: "50.00",
        addonRakeType: "fixed",
        addonRakeAmount: "5.00",
      },
      [{ buyIns: 2 }, { rebuys: 2 }, { addons: 1 }, { paymentConfirmed: false }],
    );
    // 3 x $20 = $60, less a fixed $5 taken once (not per entry) = $55; the manual prize pool is ignored.
    await tournamentWith(
      club.id,
      { status: "completed", buyInAmount: "20.00", rakeType: "fixed", rakeAmount: "5.00", manualPrizePool: "500.00" },
      [{}, {}, {}],
    );
    // Cancelled tournaments count too: 2 x $10 = $20.
    await tournamentWith(club.id, { status: "cancelled", buyInAmount: "10.00" }, [{}, {}]);
    // An empty tournament with a fixed rake subtracts it: -$7.50.
    await tournamentWith(club.id, { status: "scheduled", buyInAmount: "30.00", rakeType: "fixed", rakeAmount: "7.50" });
    const { agent } = await signInAdmin();

    const response = await agent.get("/api/dashboard/stats");

    expect(response.status).toBe(200);
    // 288 + 55 + 20 - 7.50 = 355.50, which Math.round makes 356.
    expect(response.body).toEqual({ activeTournaments: 1, totalPlayers: 9, totalPrizePool: 356, activeClubs: 1 });
  });

  it.fails("computes an open tournament's pool with each pot's own rake, fixed rake per entry, as finalize does (money-14)", async () => {
    const club = await createClub();
    // Buy-ins $60 less 3 x $5 = $45, plus rebuys 2 x $10 with no rebuy rake = $65.
    await tournamentWith(
      club.id,
      { status: "registration", buyInAmount: "20.00", rakeType: "fixed", rakeAmount: "5.00", rebuyAmount: "10.00", rebuyRakeType: "none" },
      [{ rebuys: 2 }, {}, {}],
    );
    // Buy-ins $100 less 10% = $90, plus a $50 rebuy with no rebuy rake = $140.
    await tournamentWith(
      club.id,
      { status: "in_progress", buyInAmount: "50.00", rakeType: "percentage", rakeAmount: "10.00", rebuyAmount: "50.00", rebuyRakeType: "none" },
      [{ rebuys: 1 }, {}],
    );
    const { agent } = await signInAdmin();

    const response = await agent.get("/api/dashboard/stats");

    expect(response.body.totalPrizePool).toBe(205);
  });

  it.fails("counts what a completed tournament paid, never a recomputed pool (money-14, spec D20)", async () => {
    const club = await createClub();
    // A $180 pool (4 x $50 less 10%) that paid $100 and $50: it adds the $150 paid.
    await tournamentWith(
      club.id,
      { status: "completed", buyInAmount: "50.00", rakeType: "percentage", rakeAmount: "10.00" },
      [{ finalPosition: 1, prizeAmount: "100.00" }, { finalPosition: 2, prizeAmount: "50.00" }, { finalPosition: 3 }, {}],
    );
    // Completed with no prize recorded: it adds nothing, not the $60 its rates would give.
    await tournamentWith(club.id, { status: "completed", buyInAmount: "20.00" }, [{}, {}, {}]);
    const { agent } = await signInAdmin();

    const response = await agent.get("/api/dashboard/stats");

    expect(response.body.totalPrizePool).toBe(150);
  });

  it.fails("leaves cancelled tournaments out of the total prize pool (money-14)", async () => {
    const club = await createClub();
    await tournamentWith(club.id, { status: "cancelled", buyInAmount: "10.00" }, [{}, {}]);
    const { agent } = await signInAdmin();

    const response = await agent.get("/api/dashboard/stats");

    expect(response.body.totalPrizePool).toBe(0);
  });

  it.fails("is not served to anonymous visitors (MONEY-23)", async () => {
    const response = await (await anon()).get("/api/dashboard/stats");

    expect(response.status).toBe(401);
  });
});
