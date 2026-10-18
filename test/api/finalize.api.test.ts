/**
 * Characterization of today's finalize, POST /api/tournaments/:id/finalize
 * (server/routes.ts): finishing positions from elimination times, prizes from
 * the payout structure (each place rounded to whole dollars on its own), and
 * season points from allocations, participation and knockouts.
 *
 * The "legacy results" table is the parity baseline for the Phase 2 rewrite.
 * Every scenario is finalized by the club owner with exactly one player still
 * in and a tournament in progress, so the rewrite's auth, ownership and
 * finish-order rules accept it unchanged, and every pool divides into whole
 * dollars, so the new rounding pays the same.
 *
 * `it.fails` tests state the correct behaviour for a known bug, tagged with
 * its audit finding id. They pass while the bug is there; when it is fixed,
 * Vitest reports them as failing, so switch them to `it` and delete the
 * "today" test beside them.
 */
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { activityLog, tournamentRegistrations, tournaments } from "@shared/schema";
import {
  createTournamentScenario,
  createUser,
  type TournamentScenario,
  type TournamentScenarioOptions,
} from "../factories";
import { getApp, loginAs, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const FINALIZED = "Tournament finalized - positions, prizes, and points assigned";

/** Player indexes 0..count-1 in the order they bust (first out first), leaving the last one in. */
const bustInOrder = (count: number) => Array.from({ length: count - 1 }, (_, index) => index);

/** A scenario in a club owned by a signed-in user; the tournament is in progress unless overridden. */
async function ownedScenario(options: TournamentScenarioOptions) {
  const owner = await createUser();
  const scenario = await createTournamentScenario({
    ...options,
    owner,
    tournament: { status: "in_progress", ...options.tournament },
  });
  const { agent } = await loginAs({ email: owner.email });
  return { scenario, agent };
}

const finalizePath = (scenario: TournamentScenario) => `/api/tournaments/${scenario.tournament.id}/finalize`;

/** One registration's stored result; `player` is its index in the scenario. */
interface Standing {
  player: number;
  position: number | null;
  prize: string | null;
  points: number | null;
}

/** Stored results, best finish first; unplaced registrations last. */
async function standings(scenario: TournamentScenario): Promise<Standing[]> {
  const indexOf = new Map(scenario.players.map((player, index) => [player.id, index]));
  const rows = await testDb()
    .select()
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, scenario.tournament.id));
  return rows
    .map((row) => ({
      player: indexOf.get(row.playerId) ?? -1,
      position: row.finalPosition,
      prize: row.prizeAmount,
      points: row.pointsAwarded,
    }))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.player - b.player);
}

/** Expected standings written as [player, prize, points] rows in finishing order. */
const finishingOrder = (rows: ReadonlyArray<readonly [number, string | null, number | null]>): Standing[] =>
  rows.map(([player, prize, points], index) => ({ player, position: index + 1, prize, points }));

const unplaced = (scenario: TournamentScenario): Standing[] =>
  scenario.players.map((_, player) => ({ player, position: null, prize: null, points: null }));

const prizes = (rows: Standing[]) => rows.map((row) => row.prize);

const tournamentStatus = async (scenario: TournamentScenario) =>
  (await testDb().select().from(tournaments).where(eq(tournaments.id, scenario.tournament.id)))[0].status;

const finalizeLogs = (scenario: TournamentScenario) =>
  testDb()
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.tournamentId, scenario.tournament.id), eq(activityLog.description, FINALIZED)));

async function setRegistration(scenario: TournamentScenario, player: number, values: Partial<typeof tournamentRegistrations.$inferInsert>) {
  await testDb().update(tournamentRegistrations).set(values).where(eq(tournamentRegistrations.id, scenario.registrations[player].id));
}

interface LegacyCase {
  name: string;
  options: TournamentScenarioOptions;
  /** Direct DB changes the scenario factory cannot express. */
  prepare?: (scenario: TournamentScenario) => Promise<void>;
  expected: Standing[];
}

const legacyCases: LegacyCase[] = [
  {
    name: "standard 50/30/20 of the buy-ins, everyone else unpaid and without points",
    options: { players: 8, buyIn: "50.00", eliminations: bustInOrder(8) },
    // 8 x $50 = $400.
    expected: finishingOrder([
      [7, "200.00", null],
      [6, "120.00", null],
      [5, "80.00", null],
      [4, null, null],
      [3, null, null],
      [2, null, null],
      [1, null, null],
      [0, null, null],
    ]),
  },
  {
    name: "top 5 after a separate rake on buy-ins (fixed per buy-in), re-buys (percentage) and add-ons (fixed per add-on)",
    options: {
      players: 10,
      buyIn: "40.00",
      rake: { type: "fixed", amount: "4.00" },
      rebuys: { 0: 2, 3: 1, 5: 1 },
      addons: { 1: 1, 2: 1 },
      eliminations: bustInOrder(10),
      tournament: {
        payoutStructure: "top5",
        rebuyRakeType: "percentage",
        rebuyRakeAmount: "25.00",
        addonRakeType: "fixed",
        addonRakeAmount: "10.00",
      },
    },
    // Gross 400 + 4x40 + 2x40 = 640; rake 10x4 + 25% of 160 + 2x10 = 100; net 540 at 40/25/20/10/5.
    expected: finishingOrder([
      [9, "216.00", null],
      [8, "135.00", null],
      [7, "108.00", null],
      [6, "54.00", null],
      [5, "27.00", null],
      [4, null, null],
      [3, null, null],
      [2, null, null],
      [1, null, null],
      [0, null, null],
    ]),
  },
  {
    name: "a percentage buy-in rake leaves re-buys and add-ons unraked unless they have their own rake",
    options: {
      players: 5,
      buyIn: "20.00",
      rake: { type: "percentage", amount: "50.00" },
      rebuys: { 1: 2 },
      addons: { 2: 1 },
      eliminations: [4, 3, 2, 1],
    },
    // Buy-ins 100 less 50% = 50, plus 2x20 re-buys and 1x20 add-on unraked: net 110 at 50/30/20.
    expected: finishingOrder([
      [0, "55.00", null],
      [1, "33.00", null],
      [2, "22.00", null],
      [3, null, null],
      [4, null, null],
    ]),
  },
  {
    name: "a second buy-in adds to the pool and to a fixed per-buy-in rake",
    options: {
      players: 5,
      buyIn: "20.00",
      rake: { type: "fixed", amount: "5.00" },
      rebuys: { 1: 2 },
      addons: { 2: 1 },
      eliminations: [4, 3, 2, 1],
    },
    prepare: (scenario) => setRegistration(scenario, 0, { buyIns: 2 }),
    // 6 buy-ins x 20 = 120 less 6x5 = 90, plus 40 re-buys and 20 add-on: net 150.
    expected: finishingOrder([
      [0, "75.00", null],
      [1, "45.00", null],
      [2, "30.00", null],
      [3, null, null],
      [4, null, null],
    ]),
  },
  {
    name: "top 8 of $1,000",
    options: { players: 10, buyIn: "100.00", eliminations: bustInOrder(10), tournament: { payoutStructure: "top8" } },
    expected: finishingOrder([
      [9, "350.00", null],
      [8, "220.00", null],
      [7, "150.00", null],
      [6, "120.00", null],
      [5, "80.00", null],
      [4, "40.00", null],
      [3, "20.00", null],
      [2, "20.00", null],
      [1, null, null],
      [0, null, null],
    ]),
  },
  {
    name: "top 9 of $1,000",
    options: { players: 10, buyIn: "100.00", eliminations: bustInOrder(10), tournament: { payoutStructure: "top9" } },
    expected: finishingOrder([
      [9, "300.00", null],
      [8, "200.00", null],
      [7, "150.00", null],
      [6, "120.00", null],
      [5, "90.00", null],
      [4, "60.00", null],
      [3, "40.00", null],
      [2, "20.00", null],
      [1, "20.00", null],
      [0, null, null],
    ]),
  },
  {
    name: "top 3 pays 50/30/20 like standard, not the 60/25/15 its label promised (money-03)",
    options: { players: 4, buyIn: "50.00", eliminations: bustInOrder(4), tournament: { payoutStructure: "top3" } },
    expected: finishingOrder([
      [3, "100.00", null],
      [2, "60.00", null],
      [1, "40.00", null],
      [0, null, null],
    ]),
  },
  {
    name: "points: allocation by place (single or range), participation beyond the table, plus knockout points",
    options: {
      players: 8,
      buyIn: "50.00",
      points: {
        participation: 10,
        knockout: 5,
        allocations: [
          { position: 1, points: 100 },
          { position: 2, points: 75 },
          { position: 3, points: 50 },
          { position: 4, positionEnd: 6, points: 25 },
        ],
      },
      eliminations: [
        { player: 0, by: 7 },
        { player: 1, by: 7 },
        { player: 2, by: 6 },
        3,
        { player: 4, by: 5 },
        { player: 5, by: 7 },
        { player: 6, by: 7 },
      ],
    },
    // Knockouts: player 7 has 4, players 6 and 5 have 1 each.
    expected: finishingOrder([
      [7, "200.00", 120],
      [6, "120.00", 80],
      [5, "80.00", 55],
      [4, null, 25],
      [3, null, 25],
      [2, null, 25],
      [1, null, 10],
      [0, null, 10],
    ]),
  },
  {
    name: "points: a place allocated 0 points gets none (not participation), stored as null",
    options: {
      players: 4,
      buyIn: "50.00",
      points: { participation: 5, allocations: [{ position: 1, points: 50 }, { position: 2, points: 0 }] },
      eliminations: bustInOrder(4),
    },
    expected: finishingOrder([
      [3, "100.00", 50],
      [2, "60.00", null],
      [1, "40.00", 5],
      [0, null, 5],
    ]),
  },
  {
    name: "points: none at all when the tournament does not track points",
    options: {
      players: 4,
      buyIn: "50.00",
      points: { participation: 10, knockout: 5, allocations: [{ position: 1, points: 100 }] },
      eliminations: [{ player: 0, by: 3 }, 1, 2],
      tournament: { trackPoints: false },
    },
    expected: finishingOrder([
      [3, "100.00", null],
      [2, "60.00", null],
      [1, "40.00", null],
      [0, null, null],
    ]),
  },
  {
    name: "points: knockouts score nothing when the tournament has no points system",
    options: { players: 3, buyIn: "50.00", eliminations: [{ player: 0, by: 2 }, 1] },
    expected: finishingOrder([
      [2, "75.00", null],
      [1, "45.00", null],
      [0, "30.00", null],
    ]),
  },
  {
    name: "fewer players than paid places: the unfilled places' share is paid to no one (money-05; kept by spec decision D28)",
    options: { players: 2, buyIn: "50.00", eliminations: [0] },
    // $100 pool: 1st 50%, 2nd 30%, and the 20% for 3rd is not paid out.
    expected: finishingOrder([
      [1, "50.00", null],
      [0, "30.00", null],
    ]),
  },
  {
    name: "unpaid registrations still count toward the pool and can win (money-15; kept by spec decision D27)",
    options: { players: 4, buyIn: "50.00", paid: [0, 1], eliminations: bustInOrder(4) },
    expected: finishingOrder([
      [3, "100.00", null],
      [2, "60.00", null],
      [1, "40.00", null],
      [0, null, null],
    ]),
  },
  {
    name: "high-hand entries stay out of the prize pool",
    options: {
      players: 4,
      buyIn: "50.00",
      eliminations: bustInOrder(4),
      tournament: { enableHighHand: true, highHandAmount: "20.00" },
    },
    prepare: async (scenario) => {
      await testDb()
        .update(tournamentRegistrations)
        .set({ enteringHighHands: true })
        .where(eq(tournamentRegistrations.tournamentId, scenario.tournament.id));
    },
    expected: finishingOrder([
      [3, "100.00", null],
      [2, "60.00", null],
      [1, "40.00", null],
      [0, null, null],
    ]),
  },
];

describe("POST /api/tournaments/:id/finalize: legacy results (parity baseline)", () => {
  it.each(legacyCases)("$name", async ({ options, prepare, expected }) => {
    const { scenario, agent } = await ownedScenario(options);
    await prepare?.(scenario);

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBe(200);
    expect(await standings(scenario)).toEqual(expected);
  });
});

describe("POST /api/tournaments/:id/finalize", () => {
  it("completes the tournament, logs it and answers success", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, eliminations: bustInOrder(3) });

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: "Tournament finalized successfully" });
    expect(await tournamentStatus(scenario)).toBe("completed");
    expect(await finalizeLogs(scenario)).toMatchObject([{ eventType: "status_change", playerId: null, eventData: null }]);
  });

  it("completes a tournament with no registrations", async () => {
    const { scenario, agent } = await ownedScenario({ players: 0 });

    expect((await agent.post(finalizePath(scenario))).status).toBe(200);
    expect(await tournamentStatus(scenario)).toBe("completed");
  });

  it("answers 404 for an unknown tournament", async () => {
    const response = await request(await getApp()).post(`/api/tournaments/${UNKNOWN_ID}/finalize`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found" });
  });

  it("places every player still in ahead of the eliminated ones, in no defined order among themselves (bug-07)", async () => {
    const { scenario, agent } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: [0, 1] });

    await agent.post(finalizePath(scenario));

    const rows = await standings(scenario);
    expect(rows.slice(0, 2).map((row) => row.player).sort()).toEqual([2, 3]);
    expect(rows.slice(0, 2).map((row) => row.prize)).toEqual(["100.00", "60.00"]);
    expect(rows.slice(2)).toEqual([
      { player: 1, position: 3, prize: "40.00", points: null },
      { player: 0, position: 4, prize: null, points: null },
    ]);
  });

  it("places an eliminated player with no elimination time after every timed elimination (bug-07)", async () => {
    const { scenario, agent } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: [0, 1] });
    await setRegistration(scenario, 2, { isEliminated: true, eliminationTime: null });

    await agent.post(finalizePath(scenario));

    expect(await standings(scenario)).toEqual(
      finishingOrder([
        [3, "100.00", null],
        [1, "60.00", null],
        [0, "40.00", null],
        [2, null, null],
      ]),
    );
  });

  it.fails("refuses to guess the finishing order when two or more players are still in (bug-07 / MONEY-20)", async () => {
    const { scenario, agent } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: [0, 1] });

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await standings(scenario)).toEqual(unplaced(scenario));
    expect(await tournamentStatus(scenario)).toBe("in_progress");
  });
});

describe("known bug money-04: each place is rounded on its own, so payouts can exceed the pool", () => {
  // 10 x $50 less 5% = $475 at 50/30/20 is 237.50 + 142.50 + 95.
  const options: TournamentScenarioOptions = {
    players: 10,
    buyIn: "50.00",
    rake: { type: "percentage", amount: "5.00" },
    eliminations: bustInOrder(10),
  };

  it("today: a $475 pool pays $238 + $143 + $95 = $476", async () => {
    const { scenario, agent } = await ownedScenario(options);

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["238.00", "143.00", "95.00", null]);
  });

  it.fails("pays exactly the pool: whole-dollar shares floored, the leftover to 1st ($238 + $142 + $95)", async () => {
    const { scenario, agent } = await ownedScenario(options);

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["238.00", "142.00", "95.00", null]);
  });
});

describe("known bug money-01 / MONEY-20: finalize ignores the manual prize pool", () => {
  // Calculated pool: 8 x $50 = $400. The director set the pool to $300.
  const options: TournamentScenarioOptions = {
    players: 8,
    buyIn: "50.00",
    eliminations: bustInOrder(8),
    tournament: { manualPrizePool: "300.00" },
  };

  it("today: pays from the calculated $400", async () => {
    const { scenario, agent } = await ownedScenario(options);

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["200.00", "120.00", "80.00", null]);
  });

  it.fails("pays from the manual $300", async () => {
    const { scenario, agent } = await ownedScenario(options);

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["150.00", "90.00", "60.00", null]);
  });
});

describe("known bug money-02 / MONEY-20: the custom payout structure pays standard", () => {
  const options: TournamentScenarioOptions = {
    players: 8,
    buyIn: "50.00",
    eliminations: bustInOrder(8),
    tournament: { payoutStructure: "custom", customPayouts: "[60,40]" },
  };

  it("today: pays 50/30/20 and never reads customPayouts", async () => {
    const { scenario, agent } = await ownedScenario(options);

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["200.00", "120.00", "80.00", null]);
  });

  it.fails("pays the configured 60/40 split", async () => {
    const { scenario, agent } = await ownedScenario(options);

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["240.00", "160.00", null, null]);
  });
});

describe("known bug data-integrity-06: finalize can run again and overwrite every result", () => {
  async function finalizeThenRaiseTheBuyIn() {
    const { scenario, agent } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: bustInOrder(4) });
    const first = await agent.post(finalizePath(scenario));
    await agent.patch(`/api/tournaments/${scenario.tournament.id}`).send({ buyInAmount: "100.00" });
    const second = await agent.post(finalizePath(scenario));
    return { scenario, first, second };
  }

  it("today: a second run succeeds, re-pays from the edited buy-in and logs a second finalization", async () => {
    const { scenario, first, second } = await finalizeThenRaiseTheBuyIn();

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(prizes(await standings(scenario))).toEqual(["200.00", "120.00", "80.00", null]);
    expect(await finalizeLogs(scenario)).toHaveLength(2);
  });

  it.fails("refuses a second run and keeps what was paid", async () => {
    const { scenario, first, second } = await finalizeThenRaiseTheBuyIn();

    expect(first.status).toBe(200);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
    expect(prizes(await standings(scenario))).toEqual(["100.00", "60.00", "40.00", null]);
    expect(await finalizeLogs(scenario)).toHaveLength(1);
  });
});

describe("known bug data-integrity-06: finalize does not check the tournament's status", () => {
  it.each(["scheduled", "cancelled"])("today: completes a %s tournament", async (status) => {
    const { scenario, agent } = await ownedScenario({ players: 3, eliminations: bustInOrder(3), tournament: { status } });

    expect((await agent.post(finalizePath(scenario))).status).toBe(200);
    expect(await tournamentStatus(scenario)).toBe("completed");
  });

  it.fails("refuses a cancelled tournament and leaves it cancelled", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, eliminations: bustInOrder(3), tournament: { status: "cancelled" } });

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await tournamentStatus(scenario)).toBe("cancelled");
    expect(await standings(scenario)).toEqual(unplaced(scenario));
  });
});

describe("known bug data-integrity-06: finalize is not atomic", () => {
  /**
   * Make the database reject any write that gives a registration `position`,
   * whatever code path or statement shape finalize uses. Returns the cleanup.
   */
  async function rejectFinalPosition(position: number): Promise<() => Promise<void>> {
    const db = testDb();
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION c2c_reject_final_position() RETURNS trigger AS $$
        BEGIN
          IF NEW.final_position = ${Number(position)} THEN
            RAISE EXCEPTION 'injected failure writing final_position %', NEW.final_position;
          END IF;
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql`),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER c2c_reject_final_position BEFORE INSERT OR UPDATE ON tournament_registrations
        FOR EACH ROW EXECUTE FUNCTION c2c_reject_final_position()`),
    );
    return async () => {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS c2c_reject_final_position ON tournament_registrations"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS c2c_reject_final_position()"));
    };
  }

  /** Finalize with the write of 2nd place failing; returns the response. */
  async function finalizeFailingAtSecondPlace(scenario: TournamentScenario, agent: request.Agent) {
    const cleanup = await rejectFinalPosition(2);
    try {
      return await agent.post(finalizePath(scenario));
    } finally {
      await cleanup();
    }
  }

  const options: TournamentScenarioOptions = { players: 4, buyIn: "50.00", eliminations: bustInOrder(4) };

  it("today: a failure part-way leaves the winner paid, everyone else unplaced and the tournament in progress", async () => {
    const { scenario, agent } = await ownedScenario(options);

    const response = await finalizeFailingAtSecondPlace(scenario, agent);

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: "Failed to finalize tournament" });
    expect(await standings(scenario)).toEqual([
      { player: 3, position: 1, prize: "100.00", points: null },
      { player: 0, position: null, prize: null, points: null },
      { player: 1, position: null, prize: null, points: null },
      { player: 2, position: null, prize: null, points: null },
    ]);
    expect(await tournamentStatus(scenario)).toBe("in_progress");
    expect(await finalizeLogs(scenario)).toEqual([]);
  });

  it.fails("writes nothing when any part fails", async () => {
    const { scenario, agent } = await ownedScenario(options);

    const response = await finalizeFailingAtSecondPlace(scenario, agent);

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await standings(scenario)).toEqual(unplaced(scenario));
    expect(await tournamentStatus(scenario)).toBe("in_progress");
  });
});

describe("known bug SEC-02 / security-08: anyone can finalize any tournament", () => {
  const options: TournamentScenarioOptions = { players: 3, buyIn: "50.00", eliminations: bustInOrder(3) };

  it("today: an anonymous visitor finalizes it", async () => {
    const { scenario } = await ownedScenario(options);

    const response = await request(await getApp()).post(finalizePath(scenario));

    expect(response.status).toBe(200);
    expect(await tournamentStatus(scenario)).toBe("completed");
    expect(prizes(await standings(scenario))).toEqual(["75.00", "45.00", "30.00"]);
  });

  it.fails("refuses an anonymous visitor (401) and changes nothing", async () => {
    const { scenario } = await ownedScenario(options);

    const response = await request(await getApp()).post(finalizePath(scenario));

    expect(response.status).toBe(401);
    expect(await tournamentStatus(scenario)).toBe("in_progress");
    expect(await standings(scenario)).toEqual(unplaced(scenario));
  });

  it.fails("refuses a signed-in user who does not own the club (403) and changes nothing", async () => {
    const { scenario } = await ownedScenario(options);
    const { agent } = await signIn();

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBe(403);
    expect(await tournamentStatus(scenario)).toBe("in_progress");
    expect(await standings(scenario)).toEqual(unplaced(scenario));
  });
});
