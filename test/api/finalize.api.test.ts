/**
 * Finalize v2, POST /api/tournaments/:id/finalize and /finalize/preview (server/routes/finalize.ts):
 * finishing positions from elimination times (or the order the TD gives for players still in),
 * prizes from the pool by the v2 rule (each place floored to whole dollars, the leftover to 1st), and
 * season points from allocations, participation and knockouts, written in one transaction with a
 * frozen snapshot, once (spec D18-D20, §5.5).
 *
 * The "legacy results" table is the parity baseline from before the rewrite: every scenario is
 * finalized by the club owner with exactly one player still in, and every pool divides into whole
 * dollars, so v2 pays the same as the legacy code did.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import { activityLog, auditLog, pendingActions, pointsSystems, tournamentRegistrations, tournaments } from "@shared/schema";
import {
  createTournamentScenario,
  createUser,
  type TournamentScenario,
  type TournamentScenarioOptions,
} from "../factories";
import { createClubManager } from "../factories/club-managers";
import { getApp, loginAs, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { agentFor, clubWithStaff, MANAGER_ROUTE, VISITORS } from "../helpers/club-staff";

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
  return { scenario, agent, owner };
}

/** As ownedScenario, with the club's manager, a stranger, an admin and a deactivated manager signed in too. */
async function staffedScenario(options: TournamentScenarioOptions) {
  const staff = await clubWithStaff();
  const scenario = await createTournamentScenario({
    ...options,
    owner: { id: staff.owner.user.id },
    tournament: { status: "in_progress", ...options.tournament },
  });
  for (const member of [staff.manager, staff.deactivated]) {
    await createClubManager({ clubId: scenario.club.id, userId: member.user.id });
  }
  return { scenario, staff };
}

const finalizePath = (scenario: TournamentScenario) => `/api/tournaments/${scenario.tournament.id}/finalize`;
const previewPath = (scenario: TournamentScenario) => `${finalizePath(scenario)}/preview`;

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

const tournamentRow = async (scenario: TournamentScenario) =>
  (await testDb().select().from(tournaments).where(eq(tournaments.id, scenario.tournament.id)))[0];

const tournamentStatus = async (scenario: TournamentScenario) => (await tournamentRow(scenario)).status;

const activityTypes = async (scenario: TournamentScenario) =>
  (
    await testDb()
      .select({ eventType: activityLog.eventType })
      .from(activityLog)
      .where(eq(activityLog.tournamentId, scenario.tournament.id))
      .orderBy(asc(activityLog.timestamp))
  ).map((row) => row.eventType);

const auditRows = (scenario: TournamentScenario) =>
  testDb().select().from(auditLog).where(eq(auditLog.targetId, scenario.tournament.id)).orderBy(asc(auditLog.createdAt));

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
  it("completes the tournament, stores the results and the frozen snapshot, and logs and audits it", async () => {
    const { scenario, agent, owner } = await ownedScenario({ players: 3, buyIn: "50.00", eliminations: bustInOrder(3) });

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: "Tournament finalized successfully" });
    const row = await tournamentRow(scenario);
    expect(row).toMatchObject({ status: "completed", finalizedBy: owner.id, prizePoolSnapshot: response.body.snapshot });
    expect(row.finalizedAt).toBeInstanceOf(Date);
    expect(response.body.snapshot).toMatchObject({
      v: 1,
      algorithm: "v2-floor-remainder-first",
      entrants: 3,
      finishOrderSource: "eliminations",
      pool: { grossCents: 15_000, netCents: 15_000, netSource: "calculated" },
      paid: [
        { position: 1, registrationId: scenario.registrations[2].id, playerName: scenario.players[2].name, amountCents: 7_500 },
        { position: 2, registrationId: scenario.registrations[1].id, amountCents: 4_500 },
        { position: 3, registrationId: scenario.registrations[0].id, amountCents: 3_000 },
      ],
    });
    expect(findForbiddenKeys(response.body)).toEqual([]);
    expect(await finalizeLogs(scenario)).toMatchObject([{ eventType: "status_change", playerId: null, eventData: null }]);
    expect(await auditRows(scenario)).toMatchObject([
      { action: "tournament.finalize", actorUserId: owner.id, data: { netCents: 15_000, netSource: "calculated", planHash: expect.any(String) } },
    ]);
  });

  it("completes a tournament with no registrations", async () => {
    const { scenario, agent } = await ownedScenario({ players: 0 });

    expect((await agent.post(finalizePath(scenario))).status).toBe(200);
    expect(await tournamentStatus(scenario)).toBe("completed");
  });

  it("finalizes a tournament that never left registration, as before", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, eliminations: bustInOrder(3), tournament: { status: "registration" } });

    expect((await agent.post(finalizePath(scenario))).status).toBe(200);
    expect(await tournamentStatus(scenario)).toBe("completed");
  });

  it("answers 404 for an unknown tournament to a signed-in user, and 401 to anyone else", async () => {
    const { agent } = await signIn();

    const response = await agent.post(`/api/tournaments/${UNKNOWN_ID}/finalize`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
    expect((await request(await getApp()).post(`/api/tournaments/${UNKNOWN_ID}/finalize`)).status).toBe(401);
  });

  it.each(VISITORS)("answers a %s as the authorization rules say, finalizing only for staff (SEC-02)", async (visitor) => {
    const { scenario, staff } = await staffedScenario({ players: 3, buyIn: "50.00", eliminations: bustInOrder(3) });
    const agent = await agentFor(visitor, staff);

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBe(MANAGER_ROUTE[visitor]);
    if (response.status === 200) {
      expect(prizes(await standings(scenario))).toEqual(["75.00", "45.00", "30.00"]);
    } else {
      expect(await tournamentStatus(scenario)).toBe("in_progress");
      expect(await standings(scenario)).toEqual(unplaced(scenario));
    }
  });

  it("places an eliminated player with no elimination time after every timed elimination", async () => {
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

  it("breaks a tie in elimination time by registration id, so the same data always pays the same (bug-07)", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, buyIn: "50.00", eliminations: [0, 1] });
    const sameTime = new Date("2026-03-01T20:00:00Z");
    await setRegistration(scenario, 0, { eliminationTime: sameTime });
    await setRegistration(scenario, 1, { eliminationTime: sameTime });
    const [first, second] = [0, 1].sort((a, b) => (scenario.registrations[a].id < scenario.registrations[b].id ? -1 : 1));

    await agent.post(finalizePath(scenario));

    expect((await standings(scenario)).map((row) => row.player)).toEqual([2, first, second]);
  });

  describe("players still in at the end (bug-07 / MONEY-20)", () => {
    const options: TournamentScenarioOptions = { players: 4, buyIn: "50.00", eliminations: [0, 1] };

    it("refuses to guess the finishing order when two or more players are still in, and lists them", async () => {
      const { scenario, agent } = await ownedScenario(options);

      const response = await agent.post(finalizePath(scenario));

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "ACTIVE_PLAYERS_NEED_ORDER" });
      expect(response.body.details.activePlayers.map((p: { registrationId: string }) => p.registrationId).sort()).toEqual(
        [scenario.registrations[2].id, scenario.registrations[3].id].sort(),
      );
      expect(response.body.details.activePlayers[0]).toEqual({
        registrationId: expect.any(String),
        playerId: expect.any(String),
        playerName: expect.any(String),
      });
      expect(await standings(scenario)).toEqual(unplaced(scenario));
      expect(await tournamentStatus(scenario)).toBe("in_progress");
    });

    it("places them in the order given, ahead of everyone who busted", async () => {
      const { scenario, agent } = await ownedScenario(options);

      const response = await agent.post(finalizePath(scenario)).send({ finishOrder: [scenario.registrations[2].id, scenario.registrations[3].id] });

      expect(response.status).toBe(200);
      expect(response.body.snapshot.finishOrderSource).toBe("explicit");
      expect(await standings(scenario)).toEqual(
        finishingOrder([
          [2, "100.00", null],
          [3, "60.00", null],
          [1, "40.00", null],
          [0, null, null],
        ]),
      );
    });

    it("refuses an order that does not name exactly the players still in", async () => {
      const { scenario, agent } = await ownedScenario(options);
      const [busted, , stillIn] = scenario.registrations.map((r) => r.id);

      for (const finishOrder of [[stillIn], [stillIn, busted], [stillIn, stillIn]]) {
        const response = await agent.post(finalizePath(scenario)).send({ finishOrder });

        expect(response.status).toBe(409);
        expect(response.body.code).toBe("INVALID_FINISH_ORDER");
        // Either form is accepted, so the sentence names both (the Correct Results dialog sends the whole order: CQ-P2-06).
        expect(response.body.error).toBe("Give the finishing order of every player still in, or of every player, each once");
      }
      expect(await standings(scenario)).toEqual(unplaced(scenario));
    });
  });
});

describe("what finalize pays (money-04, money-01, money-02, MONEY-20)", () => {
  it("pays exactly the pool: whole-dollar shares floored, the leftover to 1st ($475 pays $238 + $142 + $95)", async () => {
    // 10 x $50 less 5% = $475 at 50/30/20 is 237.50 + 142.50 + 95; legacy rounding paid $476.
    const { scenario, agent } = await ownedScenario({
      players: 10,
      buyIn: "50.00",
      rake: { type: "percentage", amount: "5.00" },
      eliminations: bustInOrder(10),
    });

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["238.00", "142.00", "95.00", null]);
  });

  it("pays from the manual prize pool when one is set", async () => {
    // Calculated pool: 8 x $50 = $400. The director set the pool to $300.
    const { scenario, agent } = await ownedScenario({
      players: 8,
      buyIn: "50.00",
      eliminations: bustInOrder(8),
      tournament: { manualPrizePool: "300.00" },
    });

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["150.00", "90.00", "60.00", null]);
  });

  it("pays from the gross less the manual AP total when one is set", async () => {
    // $400 gross; the 10% rate would take $40, the AP was set to $20 for a low turnout.
    const { scenario, agent } = await ownedScenario({
      players: 8,
      buyIn: "50.00",
      rake: { type: "percentage", amount: "10.00" },
      eliminations: bustInOrder(8),
      tournament: { rakeOverride: "20.00" },
    });

    const response = await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["190.00", "114.00", "76.00", null]);
    expect(response.body.snapshot.pool).toMatchObject({ netSource: "ap_override", rakeOverrideCents: 2_000, rakeCalculatedCents: 4_000 });
  });

  it("pays a configured custom split", async () => {
    const { scenario, agent } = await ownedScenario({
      players: 8,
      buyIn: "50.00",
      eliminations: bustInOrder(8),
      tournament: { payoutStructure: "custom", customPayouts: "[60,40]" },
    });

    await agent.post(finalizePath(scenario));

    expect(prizes((await standings(scenario)).slice(0, 4))).toEqual(["240.00", "160.00", null, null]);
  });
});

describe("finalizing again (data-integrity-06, D19)", () => {
  async function finalizedOnce() {
    const { scenario, agent, owner } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: [0, 1] });
    const order = [scenario.registrations[2].id, scenario.registrations[3].id];
    const first = await agent.post(finalizePath(scenario)).send({ finishOrder: order });
    expect(first.status).toBe(200);
    return { scenario, agent, owner, order };
  }

  it("refuses a second run and keeps what was paid", async () => {
    const { scenario, agent } = await finalizedOnce();
    await testDb().update(tournaments).set({ buyInAmount: "100.00" }).where(eq(tournaments.id, scenario.tournament.id));

    const second = await agent.post(finalizePath(scenario));

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "ALREADY_FINALIZED" });
    expect(prizes(await standings(scenario))).toEqual(["100.00", "60.00", "40.00", null]);
    expect(await finalizeLogs(scenario)).toHaveLength(1);
  });

  it("needs the preview's plan hash to force a second run", async () => {
    const { scenario, agent } = await finalizedOnce();

    const response = await agent.post(finalizePath(scenario)).send({ force: true });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("PLAN_HASH_REQUIRED");
  });

  it("corrects the results when forced with the preview's hash, logging and auditing what was paid before", async () => {
    const { scenario, agent, owner, order } = await finalizedOnce();
    const corrected = [...order].reverse();
    const preview = await agent.post(previewPath(scenario)).send({ finishOrder: corrected, force: true });
    expect(preview.body).toMatchObject({ ok: true, requiresForce: true, previous: { rows: [{ position: 1, amountCents: 10_000 }, {}, {}] } });

    const response = await agent
      .post(finalizePath(scenario))
      .send({ finishOrder: corrected, force: true, expectedPlanHash: preview.body.planHash });

    expect(response.status).toBe(200);
    expect(await standings(scenario)).toEqual(
      finishingOrder([
        [3, "100.00", null],
        [2, "60.00", null],
        [1, "40.00", null],
        [0, null, null],
      ]),
    );
    expect(await activityTypes(scenario)).toEqual(["status_change", "tournament_refinalized"]);
    expect((await auditRows(scenario)).map((row) => row.action)).toEqual(["tournament.finalize", "tournament.refinalize"]);
    // Everything the re-finalize overwrote, so the first payout can be rebuilt (MONEY-REV-06).
    const [r0, r1, r2, r3] = scenario.registrations.map((r) => r.id);
    expect((await auditRows(scenario))[1]).toMatchObject({
      actorUserId: owner.id,
      data: {
        previous: {
          snapshot: {
            pool: { netCents: 20_000, netSource: "calculated" },
            paid: [
              { position: 1, registrationId: r2, playerName: scenario.players[2].name, amountCents: 10_000 },
              { position: 2, registrationId: r3, amountCents: 6_000 },
              { position: 3, registrationId: r1, amountCents: 4_000 },
            ],
          },
          results: expect.arrayContaining([
            { registrationId: r0, playerId: scenario.players[0].id, finalPosition: 4, prizeAmount: null, pointsAwarded: null },
            { registrationId: r2, playerId: scenario.players[2].id, finalPosition: 1, prizeAmount: "100.00", pointsAwarded: null },
          ]),
        },
      },
    });
  });

  it("corrects who busted when with a full finishing order, once eliminations are frozen (MONEY-REV-05, D19)", async () => {
    const { scenario, agent, order } = await finalizedOnce();
    const [r0, r1] = scenario.registrations.map((r) => r.id);
    // The TD tapped the busts the wrong way round: player 0 really outlasted player 1.
    const full = [...order, r0, r1];
    const preview = await agent.post(previewPath(scenario)).send({ finishOrder: full, force: true });
    expect(preview.body).toMatchObject({ ok: true, requiresForce: true });

    const response = await agent.post(finalizePath(scenario)).send({ finishOrder: full, force: true, expectedPlanHash: preview.body.planHash });

    expect(response.status).toBe(200);
    expect(response.body.snapshot.finishOrderSource).toBe("explicit");
    expect(await standings(scenario)).toEqual(
      finishingOrder([
        [2, "100.00", null],
        [3, "60.00", null],
        [0, "40.00", null],
        [1, null, null],
      ]),
    );
  });

  describe("season points on a correction (P2REV1-01)", () => {
    async function finalizedWithPoints() {
      const { scenario, agent } = await ownedScenario({
        players: 4,
        buyIn: "50.00",
        eliminations: [0, 1],
        tournament: { trackPoints: true },
        points: { participation: 5, allocations: [{ position: 1, points: 100 }, { position: 2, points: 50 }] },
      });
      const order = [scenario.registrations[2].id, scenario.registrations[3].id];
      expect((await agent.post(finalizePath(scenario)).send({ finishOrder: order })).status).toBe(200);
      return { scenario, agent, order };
    }

    it("freezes the points settings once the tournament is completed", async () => {
      const { scenario, agent } = await finalizedWithPoints();

      const switchOff = await agent.put(`/api/tournaments/${scenario.tournament.id}`).send({ trackPoints: false });
      const unlink = await agent.put(`/api/tournaments/${scenario.tournament.id}`).send({ pointsSystemId: null });
      const resent = await agent.put(`/api/tournaments/${scenario.tournament.id}`).send({ trackPoints: true, name: "Renamed" });

      expect(switchOff.status).toBe(409);
      expect(switchOff.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { fields: ["trackPoints"] } });
      expect(unlink.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { fields: ["pointsSystemId"] } });
      expect(resent.status).toBe(200);
    });

    it("scores a correction with the rules the first finalize used, even after the points system is deleted", async () => {
      const { scenario, agent, order } = await finalizedWithPoints();
      expect((await standings(scenario)).map((row) => row.points)).toEqual([100, 50, 5, 5]);
      await testDb().delete(pointsSystems).where(eq(pointsSystems.id, scenario.pointsSystem!.id));
      expect((await tournamentRow(scenario)).pointsSystemId).toBeNull();

      const corrected = [...order].reverse();
      const preview = await agent.post(previewPath(scenario)).send({ finishOrder: corrected, force: true });
      expect(preview.body.rows.map((row: { pointsAwarded: number | null }) => row.pointsAwarded)).toEqual([100, 50, 5, 5]);
      expect(preview.body.previous.results).toEqual(
        expect.arrayContaining([{ registrationId: scenario.registrations[2].id, finalPosition: 1, pointsAwarded: 100 }]),
      );
      const response = await agent.post(finalizePath(scenario)).send({ finishOrder: corrected, force: true, expectedPlanHash: preview.body.planHash });

      expect(response.status).toBe(200);
      expect(await standings(scenario)).toEqual(
        finishingOrder([
          [3, "100.00", 100],
          [2, "60.00", 50],
          [1, "40.00", 5],
          [0, null, 5],
        ]),
      );
    });

    it("warns, by name, when correcting a tournament finalized before the rules were frozen would change unmoved players' points", async () => {
      const { scenario, agent, order } = await finalizedWithPoints();
      const snapshot = (await tournamentRow(scenario)).prizePoolSnapshot!;
      const { points: _frozen, ...withoutPoints } = snapshot;
      await testDb().update(tournaments).set({ prizePoolSnapshot: withoutPoints }).where(eq(tournaments.id, scenario.tournament.id));
      await testDb().delete(pointsSystems).where(eq(pointsSystems.id, scenario.pointsSystem!.id));

      const preview = await agent.post(previewPath(scenario)).send({ finishOrder: [...order].reverse(), force: true });

      expect(preview.body.warnings).toContain(
        `Season points change for 2 players whose place stays the same: ${scenario.players[1].name} 5 → none, ${scenario.players[0].name} 5 → none`,
      );
    });
  });

  it("refuses a forced run whose plan changed since the preview, and sends the fresh preview", async () => {
    const { scenario, agent, order } = await finalizedOnce();
    const preview = await agent.post(previewPath(scenario)).send({ finishOrder: order, force: true });

    const response = await agent
      .post(finalizePath(scenario))
      .send({ finishOrder: [...order].reverse(), force: true, expectedPlanHash: preview.body.planHash });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PLAN_CHANGED");
    expect(response.body.details.preview).toMatchObject({ ok: true, planHash: expect.any(String) });
    expect(response.body.details.preview.planHash).not.toBe(preview.body.planHash);
    expect(prizes(await standings(scenario))).toEqual(["100.00", "60.00", "40.00", null]);
  });
});

describe("tournaments finalize refuses (data-integrity-06)", () => {
  it("refuses a cancelled tournament and leaves it cancelled, even when forced", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, eliminations: bustInOrder(3), tournament: { status: "cancelled" } });

    const plain = await agent.post(finalizePath(scenario));
    const forced = await agent.post(finalizePath(scenario)).send({ force: true, expectedPlanHash: "0".repeat(32) });

    expect([plain.status, forced.status]).toEqual([409, 409]);
    expect(plain.body.code).toBe("TOURNAMENT_CANCELLED");
    expect(await tournamentStatus(scenario)).toBe("cancelled");
    expect(await standings(scenario)).toEqual(unplaced(scenario));
  });

  it("answers 400 for a malformed body", async () => {
    const { scenario, agent } = await ownedScenario({ players: 2, eliminations: [0] });

    const response = await agent.post(finalizePath(scenario)).send({ finishOrder: "everyone", expectedPlanHash: "abc" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
  });
});

describe("finalize is all or nothing (data-integrity-06)", () => {
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

  it("writes nothing when any part fails, and answers 500 without the database's message", async () => {
    const { scenario, agent } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: bustInOrder(4) });
    const cleanup = await rejectFinalPosition(2);
    let response: request.Response;
    try {
      response = await agent.post(finalizePath(scenario));
    } finally {
      await cleanup();
    }

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong on our side. Please try again.", code: "INTERNAL" });
    expect(await standings(scenario)).toEqual(unplaced(scenario));
    expect(await tournamentRow(scenario)).toMatchObject({ status: "in_progress", prizePoolSnapshot: null, finalizedAt: null });
    expect(await finalizeLogs(scenario)).toEqual([]);
    expect(await auditRows(scenario)).toEqual([]);
  });
});

describe("the finalized tournament's snapshot on GET /api/tournaments/:id (P2REV1-MONEY-02, SEC-P2REV-05)", () => {
  it("keeps its warnings, the TD's bookkeeping, for the club's staff: never who did not pay or discarded requests for anyone else", async () => {
    const { scenario, staff } = await staffedScenario({
      players: 4,
      buyIn: "50.00",
      paid: [1, 2, 3],
      eliminations: bustInOrder(4),
    });
    await testDb()
      .insert(pendingActions)
      .values({ tournamentId: scenario.tournament.id, playerId: scenario.players[1].id, actionType: "rebuy", timestamp: new Date() });
    const preview = await staff.owner.agent.post(previewPath(scenario)).send({ excludeUnpaid: true });
    const finalized = await staff.owner.agent.post(finalizePath(scenario)).send({ expectedPlanHash: preview.body.planHash, excludeUnpaid: true });
    expect(finalized.status).toBe(200);
    const detailPath = `/api/tournaments/${scenario.tournament.id}`;

    for (const visitor of ["anonymous", "stranger"] as const) {
      const response = await (await agentFor(visitor, staff)).get(detailPath);
      expect(response.status, visitor).toBe(200);
      expect(response.body.prizePoolSnapshot?.warnings, visitor).toBeUndefined();
      expect(JSON.stringify(response.body), visitor).not.toMatch(/not paid|left out|re-buy|discarded/);
    }
    for (const member of ["owner", "manager", "admin"] as const) {
      const response = await (await agentFor(member, staff)).get(detailPath);
      expect(response.body.prizePoolSnapshot, member).toMatchObject({ pool: { netCents: 15_000 } });
      expect(response.body.prizePoolSnapshot.warnings, member).toEqual(
        expect.arrayContaining([
          `1 player who has not paid is left out, not ranked, paid or scored: ${scenario.players[0].name}`,
          expect.stringMatching(/^1 player request still waiting will be discarded/),
        ]),
      );
    }
  });
});

describe("players who have not paid (round 6: only paid players are in the prize pool)", () => {
  /** Ten paid players and two at the front who never paid (both out first); the last one in won. */
  const twoUnpaid = { players: 12, buyIn: "50.00", rake: { type: "percentage" as const, amount: "5.00" }, paid: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eliminations: bustInOrder(12) };

  it("refuses to finalize while anyone in the field has not paid, naming them, and writes nothing", async () => {
    const { scenario, agent } = await ownedScenario(twoUnpaid);

    const response = await agent.post(finalizePath(scenario));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "UNPAID_PLAYERS",
      error: `${scenario.players[0].name} and ${scenario.players[1].name} have not paid, so are not in the prize pool: confirm their payments, or leave them out`,
      details: {
        unpaid: [0, 1].map((player) => ({
          registrationId: scenario.registrations[player].id,
          playerId: scenario.players[player].id,
          playerName: scenario.players[player].name,
          amountDueCents: 5_000,
        })),
      },
    });
    expect(await standings(scenario)).toEqual(unplaced(scenario));
    expect(await tournamentStatus(scenario)).toBe("in_progress");
    expect(await auditRows(scenario)).toEqual([]);
  });

  it("previews the refusal with the pool of the paid players and who has not paid", async () => {
    const { scenario, agent } = await ownedScenario(twoUnpaid);

    const response = await agent.post(previewPath(scenario));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: false, code: "UNPAID_PLAYERS", rows: [], prizePool: { breakdown: { net: 47_500, counts: { registrations: 10 } } } });
    expect(response.body).not.toHaveProperty("planHash");
    expect(response.body.unpaid.map((player: { registrationId: string }) => player.registrationId)).toEqual([0, 1].map((i) => scenario.registrations[i].id));
  });

  it("leaves them out when asked: not ranked, paid or scored, and audited", async () => {
    const { scenario, agent } = await ownedScenario({ ...twoUnpaid, points: { participation: 10, allocations: [] }, tournament: { trackPoints: true } });

    const preview = await agent.post(previewPath(scenario)).send({ excludeUnpaid: true });
    expect(preview.body).toMatchObject({ ok: true, warnings: expect.arrayContaining([expect.stringMatching(/^2 players who have not paid are left out/)]) });
    const response = await agent.post(finalizePath(scenario)).send({ excludeUnpaid: true, expectedPlanHash: preview.body.planHash });

    expect(response.status).toBe(200);
    const rows = await standings(scenario);
    expect(prizes(rows).slice(0, 4)).toEqual(["238.00", "142.00", "95.00", null]);
    expect(rows.slice(0, 2).map((row) => row.player)).toEqual([11, 10]);
    expect(rows.filter((row) => row.position === null)).toEqual([0, 1].map((player) => ({ player, position: null, prize: null, points: null })));
    expect(rows.filter((row) => row.points === 10)).toHaveLength(10);
    expect(response.body.snapshot).toMatchObject({ entrants: 10, pool: { netCents: 47_500 } });
    const [audit] = await auditRows(scenario);
    expect(audit.data).toMatchObject({ unpaidLeftOut: [0, 1].map((i) => scenario.registrations[i].id) });
    expect(audit.data).not.toHaveProperty("resultsCleared");
  });

  it("pays a player whose payment is confirmed before finalizing, from a pool that grew by their entry", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, buyIn: "50.00", paid: [0, 2], eliminations: bustInOrder(3) });
    const before = await agent.post(previewPath(scenario));
    expect(before.body).toMatchObject({ code: "UNPAID_PLAYERS", prizePool: { breakdown: { net: 10_000 } } });

    expect((await agent.patch(`/api/registrations/${scenario.registrations[1].id}/confirm-payment`)).status).toBe(200);
    const after = await agent.post(previewPath(scenario));
    expect(after.body).toMatchObject({ ok: true, unpaid: [], prizePool: { breakdown: { net: 15_000 } } });
    expect((await agent.post(finalizePath(scenario)).send({ expectedPlanHash: after.body.planHash })).status).toBe(200);

    expect(prizes(await standings(scenario))).toEqual(["75.00", "45.00", "30.00"]);
  });

  it("clears the place, prize and points a correction leaves out, and audits it", async () => {
    const { scenario, agent } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: bustInOrder(4) });
    expect((await agent.post(finalizePath(scenario))).status).toBe(200);
    // Player 0 (4th) turns out never to have paid.
    await setRegistration(scenario, 0, { paymentConfirmed: false, pointsAwarded: 3 });

    const preview = await agent.post(previewPath(scenario)).send({ force: true, excludeUnpaid: true });
    expect(preview.body.rows).toHaveLength(3);
    const response = await agent.post(finalizePath(scenario)).send({ force: true, excludeUnpaid: true, expectedPlanHash: preview.body.planHash });

    expect(response.status).toBe(200);
    expect(await standings(scenario)).toEqual([
      { player: 3, position: 1, prize: "75.00", points: null },
      { player: 2, position: 2, prize: "45.00", points: null },
      { player: 1, position: 3, prize: "30.00", points: null },
      { player: 0, position: null, prize: null, points: null },
    ]);
    const audits = await auditRows(scenario);
    expect(audits.at(-1)).toMatchObject({ action: "tournament.refinalize", data: { resultsCleared: [scenario.registrations[0].id] } });
  });
});

describe("POST /api/tournaments/:id/finalize/preview", () => {
  it("shows the rows, pool, warnings and plan hash finalize would use, and writes nothing", async () => {
    const { scenario, agent } = await ownedScenario({
      players: 10,
      buyIn: "50.00",
      rake: { type: "percentage", amount: "5.00" },
      eliminations: bustInOrder(10),
    });

    const response = await agent.post(previewPath(scenario));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      requiresForce: false,
      planHash: expect.stringMatching(/^[0-9a-f]{32}$/),
      activePlayers: [{ registrationId: scenario.registrations[9].id, playerName: scenario.players[9].name }],
      warnings: ["The prize pool is not locked"],
      unpaid: [],
      previous: null,
      prizePool: { tournamentId: scenario.tournament.id, breakdown: { net: 47_500 }, display: { source: "live" } },
    });
    expect(response.body.rows.slice(0, 4)).toEqual([
      { registrationId: scenario.registrations[9].id, playerId: scenario.players[9].id, playerName: scenario.players[9].name, finalPosition: 1, amountCents: 23_800, prizeAmount: "238.00", pointsAwarded: null },
      expect.objectContaining({ finalPosition: 2, amountCents: 14_200, prizeAmount: "142.00" }),
      expect.objectContaining({ finalPosition: 3, amountCents: 9_500, prizeAmount: "95.00" }),
      expect.objectContaining({ finalPosition: 4, amountCents: 0, prizeAmount: null }),
    ]);
    expect(response.body).not.toHaveProperty("code");
    expect(await standings(scenario)).toEqual(unplaced(scenario));
    expect(await tournamentStatus(scenario)).toBe("in_progress");
    expect(await activityTypes(scenario)).toEqual([]);
  });

  it("says when finalize would refuse, listing the players still in", async () => {
    const { scenario, agent } = await ownedScenario({ players: 4, buyIn: "50.00", eliminations: [0, 1] });

    const response = await agent.post(previewPath(scenario));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: false, code: "ACTIVE_PLAYERS_NEED_ORDER", rows: [], message: expect.any(String) });
    expect(response.body).not.toHaveProperty("planHash");
    expect(response.body.activePlayers).toHaveLength(2);
  });

  it("gives the hash finalize accepts, and finalize then pays exactly the previewed rows", async () => {
    const { scenario, agent } = await ownedScenario({ players: 5, buyIn: "33.55", eliminations: bustInOrder(5) });
    const preview = await agent.post(previewPath(scenario));

    const response = await agent.post(finalizePath(scenario)).send({ expectedPlanHash: preview.body.planHash });

    expect(response.status).toBe(200);
    const paid = (await standings(scenario)).map((row) => row.prize);
    expect(paid).toEqual(preview.body.rows.map((row: { prizeAmount: string | null }) => row.prizeAmount));
    expect(paid).toEqual(["84.75", "50.00", "33.00", null, null]);
  });

  it("refuses a plan that changed since the preview (a late re-buy) and writes nothing", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, buyIn: "50.00", eliminations: bustInOrder(3), rebuys: { 0: 0 } });
    const preview = await agent.post(previewPath(scenario));
    await setRegistration(scenario, 0, { rebuys: 1 });

    const response = await agent.post(finalizePath(scenario)).send({ expectedPlanHash: preview.body.planHash });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "PLAN_CHANGED", details: { preview: { prizePool: { breakdown: { net: 20_000 } } } } });
    expect(await standings(scenario)).toEqual(unplaced(scenario));
  });

  it("lists the player requests finalize would discard, and refuses a plan a new request arrived after (P2REV1-02)", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, buyIn: "50.00", eliminations: bustInOrder(3), rebuys: { 0: 0 } });
    const [busted, , stillIn] = scenario.players;
    const waiting = await testDb()
      .insert(pendingActions)
      .values({ tournamentId: scenario.tournament.id, playerId: busted.id, actionType: "rebuy", timestamp: new Date() })
      .returning();

    const preview = await agent.post(previewPath(scenario));
    expect(preview.body.pendingRequests).toEqual([{ id: waiting[0].id, actionType: "rebuy", playerName: busted.name, targetPlayerName: null }]);
    expect(preview.body.warnings).toContain(
      `1 player request still waiting will be discarded: ${busted.name}'s re-buy ($50). Confirm or dismiss them under Confirm Actions first`,
    );

    // A knockout claim arrives from a phone between the preview and the confirm.
    const late = await request(await getApp())
      .post(`/api/tournaments/${scenario.tournament.id}/pending-actions`)
      .send({ playerId: stillIn.id, actionType: "knockout", targetPlayerId: scenario.players[1].id });
    expect(late.status).toBe(201);

    const stale = await agent.post(finalizePath(scenario)).send({ expectedPlanHash: preview.body.planHash });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("PLAN_CHANGED");
    expect(stale.body.details.preview.pendingRequests).toHaveLength(2);
    expect(await testDb().select().from(pendingActions)).toHaveLength(2);

    const confirmed = await agent.post(finalizePath(scenario)).send({ expectedPlanHash: stale.body.details.preview.planHash });
    expect(confirmed.status).toBe(200);
    expect(await testDb().select().from(pendingActions)).toEqual([]);
  });

  it("says a finalized tournament needs force, and shows what it paid", async () => {
    const { scenario, agent } = await ownedScenario({ players: 3, buyIn: "50.00", eliminations: bustInOrder(3) });
    await agent.post(finalizePath(scenario));

    const response = await agent.post(previewPath(scenario));

    expect(response.body).toMatchObject({
      ok: false,
      code: "ALREADY_FINALIZED",
      requiresForce: true,
      previous: {
        finalizedAt: expect.any(String),
        rows: [
          { position: 1, playerName: scenario.players[2].name, amountCents: 7_500 },
          { position: 2, amountCents: 4_500 },
          { position: 3, amountCents: 3_000 },
        ],
      },
      prizePool: { display: { source: "snapshot", totalCents: 15_000 } },
    });
    expect(response.body.warnings[0]).toBe("Finalizing again replaces the stored positions, prizes and points");
  });

  it("shows a tournament finalized before snapshots by its stored prizes", async () => {
    const { scenario, agent } = await ownedScenario({ players: 2, eliminations: [0], tournament: { status: "completed" } });
    await setRegistration(scenario, 1, { finalPosition: 1, prizeAmount: "70.00" });
    await setRegistration(scenario, 0, { finalPosition: 2, prizeAmount: "30.00" });

    const response = await agent.post(previewPath(scenario)).send({ force: true });

    expect(response.body).toMatchObject({
      ok: true,
      requiresForce: true,
      previous: { finalizedAt: null, rows: [{ position: 1, amountCents: 7_000 }, { position: 2, amountCents: 3_000 }] },
      prizePool: { display: { source: "stored", totalCents: 10_000 } },
    });
  });

  it("says a cancelled tournament cannot be finalized", async () => {
    const { scenario, agent } = await ownedScenario({ players: 2, eliminations: [0], tournament: { status: "cancelled" } });

    expect((await agent.post(previewPath(scenario))).body).toMatchObject({ ok: false, code: "TOURNAMENT_CANCELLED" });
  });

  it.each(VISITORS)("answers a %s as the authorization rules say", async (visitor) => {
    const { scenario, staff } = await staffedScenario({ players: 2, eliminations: [0] });

    expect((await (await agentFor(visitor, staff)).post(previewPath(scenario))).status).toBe(MANAGER_ROUTE[visitor]);
  });
});
