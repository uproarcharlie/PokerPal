/**
 * A tournament's high hands as a list (round 10): staff set them (PUT /api/tournaments/:id/high-hands,
 * or `highHands` on the tournament form), each its own pot with its own fee, AP and winners, awarded
 * one at a time (POST/PATCH/DELETE …/high-hands/:highHandId/awards). A tournament that keeps its one
 * legacy high hand reads exactly as before until staff change its high hands; then the legacy high hand
 * becomes the first of the list with its players and winners, and no money moves. Each pot is on the
 * public page and (when the TD shows them) the TV by name, never with its AP; finalize records each pot.
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { presetStructure } from "@shared/domain/blind-structures";
import type { HighHandAwardResultDto, HighHandAwardsDto, HighHandDto } from "@shared/api/high-hands";
import type { PublicPrizesDto } from "@shared/api/live-display";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import { findForbiddenKeys, findTakingsKeys, type ActivityDto } from "@shared/api/public";
import type { PendingRegistrationDto } from "@shared/api/registrations";
import {
  activityLog,
  auditLog,
  highHandAwards,
  registrationHighHands,
  tournamentHighHands,
  tournamentRegistrations,
  tournaments,
  type Tournament,
  type TournamentRegistration,
} from "@shared/schema";
import { createPlayer, createRegistration, createTournament, type NewRegistration, type NewTournament } from "../factories";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff, type ClubStaffAgents } from "../helpers/club-staff";

beforeEach(resetDb);

type Agent = ClubStaffAgents["manager"]["agent"];

async function setUp(overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff({ rakeLabel: "AP" });
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", buyInAmount: "50.00", ...overrides });
  const entry = async (name: string, extra: Partial<NewRegistration> = {}) =>
    createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer({ name, phone: "021 555 0123" })).id, paymentConfirmed: true, ...extra });
  return { staff, tournament, td: staff.manager.agent, entry };
}

const putHighHands = (agent: Agent, tournamentId: string, body: Record<string, unknown>) => agent.put(`/api/tournaments/${tournamentId}/high-hands`).send(body);

const TWO_HALVES = [
  { name: "First half", entryFee: "5.00", winners: 2, note: "Before the break" },
  { name: "Second half", entryFee: "5.00", rakeType: "percentage", rakeAmount: "10.00" },
];

/** A game listing two high hands, with Ann, Bea and Cy paid into the first and Ann and Bea into the second. */
async function listedGame(overrides: Partial<NewTournament> = {}) {
  const world = await setUp(overrides);
  const listed = await putHighHands(world.td, world.tournament.id, { highHands: TWO_HALVES });
  if (listed.status !== 200) throw new Error(`Setup: ${JSON.stringify(listed.body)}`);
  const [first, second] = listed.body.tournament.highHands as HighHandDto[];
  const into = async (name: string, ids: string[]) => {
    const registration = await world.entry(name, { enteringHighHands: ids.length > 0 });
    if (ids.length > 0) {
      await testDb().insert(registrationHighHands).values(ids.map((highHandId) => ({ registrationId: registration.id, highHandId, tournamentId: world.tournament.id })));
    }
    return registration;
  };
  const ann = await into("Ann", [first.id, second.id]);
  const bea = await into("Bea", [first.id, second.id]);
  const cy = await into("Cy", [first.id]);
  return { ...world, first, second, ann, bea, cy };
}

const prizePool = async (agent: Agent, id: string) => (await agent.get(`/api/tournaments/${id}/prize-pool`)).body as PrizePoolDto;

const awardsPath = (tournamentId: string, highHandId: string, registrationId?: string) =>
  `/api/tournaments/${tournamentId}/high-hands/${highHandId}/awards${registrationId ? `/${registrationId}` : ""}`;

const feed = async (agent: Agent | Awaited<ReturnType<typeof anon>>, id: string) =>
  ((await agent.get(`/api/tournaments/${id}/activity`)).body as ActivityDto[]).map((entry) => ({ type: entry.eventType, description: entry.description }));

const activityRows = async (id: string, eventType: string) =>
  (await testDb().select().from(activityLog).where(and(eq(activityLog.tournamentId, id), eq(activityLog.eventType, eventType))).orderBy(asc(activityLog.timestamp), asc(activityLog.id))).map(
    (row) => ({ description: row.description, data: row.eventData ? (JSON.parse(row.eventData) as unknown) : null }),
  );

const auditRows = (action: string, targetId: string) =>
  testDb().select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId))).orderBy(asc(auditLog.createdAt), asc(auditLog.id));

const registrationRow = async (id: string): Promise<TournamentRegistration> =>
  (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];

const tournamentRow = async (id: string): Promise<Tournament> => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

describe("PUT /api/tournaments/:id/high-hands", () => {
  it("lists two high hands: each its own pot, the legacy columns their summary, logged for the staff and audited", async () => {
    const { tournament, td, staff } = await setUp();

    const response = await putHighHands(td, tournament.id, { highHands: TWO_HALVES, reason: "Two halves tonight" });

    expect(response.status).toBe(200);
    const highHands = response.body.tournament.highHands as HighHandDto[];
    expect(highHands).toEqual([
      { id: expect.any(String), name: "First half", position: 1, entryFee: "5.00", winners: 2, note: "Before the break", rakeType: "none", rakeAmount: "0.00" },
      { id: expect.any(String), name: "Second half", position: 2, entryFee: "5.00", winners: 1, note: null, rakeType: "percentage", rakeAmount: "10.00" },
    ]);
    expect(response.body.prizePool.breakdown.highHands.map((pot: { name: string }) => pot.name)).toEqual(["First half", "Second half"]);
    // Whether it runs any high hand, and what entering every one costs: for every reader of the old columns.
    expect(await tournamentRow(tournament.id)).toMatchObject({ enableHighHand: true, highHandAmount: "10.00" });
    expect(await activityRows(tournament.id, "high_hands_changed")).toEqual([
      {
        description: "High hands: First half $5 (no AP, 2 winners), Second half $5 (AP 10%) - Two halves tonight",
        data: { highHandIds: highHands.map((highHand) => highHand.id), reason: "Two halves tonight" },
      },
    ]);
    const anonymousFeed = await feed(await anon(), tournament.id);
    expect(anonymousFeed.map((entry) => entry.type)).not.toContain("high_hands_changed");
    const [audit] = await auditRows("tournament.high_hands", tournament.id);
    expect(audit).toMatchObject({ actorUserId: staff.manager.user.id, data: { before: null, removed: [], reason: "Two halves tonight", potsAfter: [{ netCents: 0 }, { netCents: 0 }] } });
  });

  it("shows each high hand's AP only to the club's staff", async () => {
    const { tournament, staff } = await listedGame();

    const [publicRead, publicList, staffRead] = await Promise.all([
      (await anon()).get(`/api/tournaments/${tournament.id}`),
      staff.stranger.agent.get(`/api/tournaments?clubId=${staff.club.id}`),
      staff.owner.agent.get(`/api/tournaments/${tournament.id}`),
    ]);

    expect(publicRead.body.highHands).toEqual([
      { id: expect.any(String), name: "First half", position: 1, entryFee: "5.00", winners: 2, note: "Before the break" },
      { id: expect.any(String), name: "Second half", position: 2, entryFee: "5.00", winners: 1, note: null },
    ]);
    expect(publicList.body[0].highHands).toEqual(publicRead.body.highHands);
    for (const body of [publicRead.body, publicList.body]) {
      expect(findTakingsKeys(body)).toEqual([]);
      expect(findForbiddenKeys(body)).toEqual([]);
    }
    expect(staffRead.body.highHands[1]).toMatchObject({ rakeType: "percentage", rakeAmount: "10.00" });
  });

  it("changes nothing, and logs nothing, for the list resent as it is", async () => {
    const { tournament, td, first, second } = await listedGame();
    const resent = TWO_HALVES.map((highHand, index) => ({ ...highHand, id: [first.id, second.id][index] }));

    const response = await putHighHands(td, tournament.id, { highHands: resent });

    expect(response.status).toBe(200);
    expect(await activityRows(tournament.id, "high_hands_changed")).toHaveLength(1);
  });

  it("refuses to take a high hand anyone is in off the list, and keeps the row of one nobody is in, marked removed", async () => {
    const { tournament, td, first, second } = await listedGame();
    const keepFirst = [{ ...TWO_HALVES[0], id: first.id }];

    const refused = await putHighHands(td, tournament.id, { highHands: keepFirst });
    await testDb().delete(registrationHighHands).where(eq(registrationHighHands.highHandId, second.id));
    const removed = await putHighHands(td, tournament.id, { highHands: keepFirst });

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: "2 players have entered the Second half high hand: take them out of it before removing it",
      code: "HIGH_HAND_ENTRIES",
      details: { highHandId: second.id, entrants: 2 },
    });
    expect(removed.status).toBe(200);
    expect((removed.body.tournament.highHands as HighHandDto[]).map((highHand) => highHand.name)).toEqual(["First half"]);
    const rows = await testDb().select().from(tournamentHighHands).where(eq(tournamentHighHands.id, second.id));
    expect(rows[0].removedAt).toBeInstanceOf(Date);
    expect(await tournamentRow(tournament.id)).toMatchObject({ highHandAmount: "5.00" });
  });

  it("asks before re-pricing a high hand entries are recorded at (409 ENTRIES_REPRICED), then re-prices it", async () => {
    const { tournament, td, first, second } = await listedGame();
    const dearer = [{ ...TWO_HALVES[0], id: first.id, entryFee: "6.00" }, { ...TWO_HALVES[1], id: second.id }];

    const asked = await putHighHands(td, tournament.id, { highHands: dearer });
    const confirmed = await putHighHands(td, tournament.id, { highHands: dearer, repriceEntries: true });

    expect(asked.status).toBe(409);
    expect(asked.body).toEqual({
      error: "This re-prices what is already recorded: 3 First half high hand entries from $5 to $6. The prize pool and what players owe change with it.",
      code: "ENTRIES_REPRICED",
      details: { changes: [{ highHandId: first.id, name: "First half", count: 3, fromCents: 500, toCents: 600 }] },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.prizePool.breakdown.highHands[0]).toMatchObject({ feeCents: 600, gross: 1_800 });
  });

  it("refuses any change once the tournament is completed or cancelled, but not the list resent as it is", async () => {
    const { tournament, td, first, second } = await listedGame();
    await testDb().update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, tournament.id));
    const resent = TWO_HALVES.map((highHand, index) => ({ ...highHand, id: [first.id, second.id][index] }));

    const changed = await putHighHands(td, tournament.id, { highHands: [...resent, { name: "Late", entryFee: "5.00" }] });
    const same = await putHighHands(td, tournament.id, { highHands: resent });

    expect([changed.status, changed.body.code]).toEqual([409, "TOURNAMENT_CLOSED"]);
    expect(same.status).toBe(200);
  });

  it("refuses an id that is not one of the tournament's high hands", async () => {
    const { tournament, td } = await listedGame();

    const response = await putHighHands(td, tournament.id, { highHands: [{ id: "legacy", name: "High hand", entryFee: "10.00" }] });

    expect([response.status, response.body.code, response.body.details]).toEqual([400, "HIGH_HAND_NOT_AVAILABLE", { highHandId: "legacy" }]);
  });

  it("refuses an AP rule or prize count the awards already made no longer fit, naming the pot", async () => {
    const { tournament, td, first, second, ann } = await listedGame();
    // Second half: $10 in, 10% AP, one prize: Ann wins the $9.
    await td.post(awardsPath(tournament.id, second.id)).send({ registrationId: ann.id });

    const response = await putHighHands(td, tournament.id, { highHands: [{ ...TWO_HALVES[0], id: first.id }, { ...TWO_HALVES[1], id: second.id, rakeAmount: "20.00" }] });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "HIGH_HAND_OVER_POOL",
      details: { highHandId: second.id, name: "Second half", awardedCents: 900, potCents: 800 },
    });
  });

  it("is the club staff's validation: two high hands of one name, a fee of $0, more than six", async () => {
    const { tournament, td } = await setUp();

    const sameName = await putHighHands(td, tournament.id, { highHands: [TWO_HALVES[0], { ...TWO_HALVES[1], name: "first HALF" }] });
    const free = await putHighHands(td, tournament.id, { highHands: [{ name: "Free", entryFee: "0" }] });
    const seven = await putHighHands(td, tournament.id, { highHands: Array.from({ length: 7 }, (_, index) => ({ name: `High hand ${index + 1}`, entryFee: "5" })) });

    for (const response of [sameName, free, seven]) expect([response.status, response.body.code]).toEqual([400, "VALIDATION"]);
    expect(sameName.body.details).toEqual([expect.objectContaining({ path: ["highHands", 1, "name"] })]);
  });
});

describe("a legacy high hand taken into the list", () => {
  /** A legacy $10 high hand, 10% AP, two prizes: Ann, Bea and Cy paid and in it, Dee in it and not paid, Ann awarded the first prize. */
  async function legacyGame() {
    const world = await setUp({ enableHighHand: true, highHandAmount: "10.00", highHandRakeType: "percentage", highHandRakeAmount: "10.00", highHandPayouts: 2 });
    const ann = await world.entry("Ann", { enteringHighHands: true });
    const bea = await world.entry("Bea", { enteringHighHands: true });
    const cy = await world.entry("Cy", { enteringHighHands: true });
    const dee = await world.entry("Dee", { enteringHighHands: true, paymentConfirmed: false });
    const awarded = await world.td.put(`/api/registrations/${ann.id}`).send({ highHandWinner: true });
    if (awarded.status !== 200) throw new Error(`Setup: ${JSON.stringify(awarded.body)}`);
    return { ...world, ann, bea, cy, dee };
  }

  const LEGACY_AS_SET = { id: "legacy", name: "High hand", entryFee: "10.00", rakeType: "percentage", rakeAmount: "10.00", winners: 2 };

  it("reads as one high hand \"legacy\" with today's figures, and changes nothing while resent as it is", async () => {
    const { tournament, td } = await legacyGame();

    const before = await prizePool(td, tournament.id);
    const resent = await putHighHands(td, tournament.id, { highHands: [LEGACY_AS_SET] });

    expect(before.breakdown.highHands).toEqual([
      { highHandId: "legacy", name: "High hand", position: 1, feeCents: 1_000, entrants: 3, gross: 3_000, rake: 300, net: 2_700, winners: 2 },
    ]);
    expect(before.breakdown.highHand).toEqual({ entrants: 3, gross: 3_000, rake: 300, net: 2_700, winners: 2 });
    expect(resent.status).toBe(200);
    expect(resent.body.tournament.highHands).toBeNull();
    expect(await testDb().select().from(tournamentHighHands)).toEqual([]);
    expect(await activityRows(tournament.id, "high_hands_changed")).toEqual([]);
  });

  it("keeps every pot, award and amount owed when a second high hand is added", async () => {
    const { tournament, td, ann, bea, cy, dee } = await legacyGame();
    const pendingBefore = (await td.get(`/api/tournaments/${tournament.id}/pending-registrations`)).body as PendingRegistrationDto[];
    const poolBefore = await prizePool(td, tournament.id);

    const response = await putHighHands(td, tournament.id, { highHands: [LEGACY_AS_SET, { name: "Second half", entryFee: "5.00" }] });

    expect(response.status).toBe(200);
    const [adopted, added] = response.body.tournament.highHands as HighHandDto[];
    expect(adopted).toMatchObject({ name: "High hand", entryFee: "10.00", winners: 2, rakeType: "percentage", rakeAmount: "10.00" });
    expect(adopted.id).not.toBe("legacy");
    const { highHandId: _legacyId, ...legacyPot } = poolBefore.breakdown.highHands[0];
    expect(response.body.prizePool.breakdown.highHands).toEqual([
      { ...legacyPot, highHandId: adopted.id },
      { highHandId: added.id, name: "Second half", position: 2, feeCents: 500, entrants: 0, gross: 0, rake: 0, net: 0, winners: 1 },
    ]);
    // The prize pool itself is untouched: high-hand money is never in it.
    expect(response.body.prizePool.breakdown.net).toBe(poolBefore.breakdown.net);
    expect((await testDb().select().from(highHandAwards)).map(({ highHandId, registrationId, amountCents }) => ({ highHandId, registrationId, amountCents }))).toEqual([
      { highHandId: adopted.id, registrationId: ann.id, amountCents: 1_350 },
    ]);
    const entrants = await testDb().select().from(registrationHighHands).where(eq(registrationHighHands.highHandId, adopted.id));
    expect(entrants.map((row) => row.registrationId).sort()).toEqual([ann.id, bea.id, cy.id, dee.id].sort());
    const pendingAfter = (await td.get(`/api/tournaments/${tournament.id}/pending-registrations`)).body as PendingRegistrationDto[];
    expect(pendingAfter.map((row) => row.amountOwed)).toEqual(pendingBefore.map((row) => row.amountOwed));
    expect(pendingAfter[0]).toMatchObject({ id: dee.id, highHandIds: [adopted.id] });
    // The next prize is what it was: the rest of the pot.
    const next = await td.post(awardsPath(tournament.id, adopted.id)).send({ registrationId: bea.id });
    expect(next.body).toMatchObject({ award: { amountCents: 1_350 }, nextAwardCents: null });
    expect(await tournamentRow(tournament.id)).toMatchObject({ enableHighHand: true, highHandAmount: "15.00" });
    const [audit] = await auditRows("tournament.high_hands", tournament.id);
    expect(audit.data).toMatchObject({
      before: null,
      legacy: { enableHighHand: true, highHandAmount: "10.00", highHandRakeType: "percentage", highHandRakeAmount: "10.00", highHandPayouts: 2 },
      adoptedLegacy: { entrants: 4, awards: 1 },
      removed: [],
      potsBefore: [{ highHandId: "legacy", netCents: 2_700 }],
    });
  });

  it("adds a second high hand to a legacy game with money paid in after its last award, leaving that pot as it is (R10REV0-MONEY-01)", async () => {
    // $10, one prize: Ann and Bea paid, Ann awarded the $20, then Cy's payment confirmed late (never refused for the pot).
    const { tournament, td, entry } = await setUp({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 1 });
    const ann = await entry("Ann", { enteringHighHands: true });
    await entry("Bea", { enteringHighHands: true });
    const cy = await entry("Cy", { enteringHighHands: true, paymentConfirmed: false });
    await td.put(`/api/registrations/${ann.id}`).send({ highHandWinner: true });
    const late = await td.patch(`/api/registrations/${cy.id}/confirm-payment`).send({});
    const poolBefore = await prizePool(td, tournament.id);
    const legacy = { id: "legacy", name: "High hand", entryFee: "10.00", winners: 1 };

    const repriced = await putHighHands(td, tournament.id, { highHands: [{ ...legacy, entryFee: "5.00" }, { name: "Second half", entryFee: "5.00" }] });
    const added = await putHighHands(td, tournament.id, { highHands: [legacy, { name: "Second half", entryFee: "5.00" }] });

    expect(late.body).toMatchObject({ highHandUnawardedCents: 1_000 });
    // A pot whose money changes is still held to its awards: $20 awarded is more than 3 × $5.
    expect(repriced.status).toBe(409);
    expect(repriced.body).toMatchObject({ code: "HIGH_HAND_OVER_POOL", details: { awardedCents: 2_000, potCents: 1_500 } });
    expect(added.status).toBe(200);
    const [adopted] = added.body.tournament.highHands as HighHandDto[];
    const { highHandId: _legacyId, ...legacyPot } = poolBefore.breakdown.highHands[0];
    expect(legacyPot).toMatchObject({ entrants: 3, net: 3_000, winners: 1 });
    expect(added.body.prizePool.breakdown.highHands[0]).toEqual({ ...legacyPot, highHandId: adopted.id });
    expect((await testDb().select().from(highHandAwards)).map(({ highHandId, registrationId, amountCents }) => ({ highHandId, registrationId, amountCents }))).toEqual([
      { highHandId: adopted.id, registrationId: ann.id, amountCents: 2_000 },
    ]);
  });

  it("keeps the legacy high hand's players in both halves when its $10 is sold as two at $5, owing what they did (R10REV1-MONEY-02)", async () => {
    const { tournament, td, ann, bea, cy, dee } = await legacyGame();
    const owed = async () => ((await td.get(`/api/tournaments/${tournament.id}/pending-registrations`)).body as PendingRegistrationDto[]).map((row) => row.amountOwed);
    const paid = async () => ((await td.get(`/api/tournaments/${tournament.id}/confirmed-registrations`)).body as Array<{ amountPaid: number }>).map((row) => row.amountPaid);
    const [owedBefore, paidBefore] = [await owed(), await paid()];
    const firstHalf = { ...LEGACY_AS_SET, name: "First half", entryFee: "5.00" };

    const onlyFirst = await putHighHands(td, tournament.id, { highHands: [firstHalf, { name: "Second half", entryFee: "5.00" }] });
    const both = await putHighHands(td, tournament.id, { highHands: [firstHalf, { name: "Second half", entryFee: "5.00", legacyEntrants: true }] });

    // Left in the first half only, their entries are re-priced: the question says where they will be, and where not.
    expect(onlyFirst.status).toBe(409);
    expect(onlyFirst.body).toEqual({
      error:
        "This re-prices what is already recorded: 4 High hand entries from $10 to $5 (those players will be in the First half high hand only, not the Second half high hand). The prize pool and what players owe change with it.",
      code: "ENTRIES_REPRICED",
      details: { changes: [{ highHandId: "legacy", name: "High hand", count: 4, fromCents: 1_000, toCents: 500, nowIn: ["First half"], notIn: ["Second half"] }] },
    });
    // In both, nothing is re-priced, so nothing is asked.
    expect(both.status).toBe(200);
    const [first, second] = both.body.tournament.highHands as HighHandDto[];
    for (const highHand of [first, second]) {
      const entrants = await testDb().select().from(registrationHighHands).where(eq(registrationHighHands.highHandId, highHand.id));
      expect(entrants.map((row) => row.registrationId).sort()).toEqual([ann.id, bea.id, cy.id, dee.id].sort());
    }
    expect([await owed(), await paid()]).toEqual([owedBefore, paidBefore]);
    // Ann's prize stays with the high hand she won: 3 paid × $5 less 10%, two prizes.
    expect(both.body.prizePool.breakdown.highHands).toEqual([
      expect.objectContaining({ highHandId: first.id, entrants: 3, gross: 1_500, rake: 150, net: 1_350, winners: 2 }),
      expect.objectContaining({ highHandId: second.id, entrants: 3, gross: 1_500, rake: 0, net: 1_500, winners: 1 }),
    ]);
    expect((await testDb().select().from(highHandAwards)).map(({ highHandId, registrationId }) => ({ highHandId, registrationId }))).toEqual([{ highHandId: first.id, registrationId: ann.id }]);
    const [audit] = await auditRows("tournament.high_hands", tournament.id);
    expect(audit.data).toMatchObject({ adoptedLegacy: { entrants: 4, awards: 1, alsoIn: [second.id] } });
  });

  it("refuses a new high hand taking in the legacy players when no legacy high hand is being listed", async () => {
    const { tournament, td, first, second } = await listedGame();
    const listed = [{ ...TWO_HALVES[0], id: first.id }, { ...TWO_HALVES[1], id: second.id }];

    const stale = await putHighHands(td, tournament.id, { highHands: [...listed, { name: "Late", entryFee: "2.00", legacyEntrants: true }] });
    const onSaved = await putHighHands(td, tournament.id, { highHands: [{ ...listed[0], legacyEntrants: true }, listed[1]] });

    expect([stale.status, stale.body.code, stale.body.details]).toEqual([400, "HIGH_HAND_NOT_AVAILABLE", { highHandId: "legacy" }]);
    expect([onSaved.status, onSaved.body.code]).toEqual([400, "VALIDATION"]);
    expect(onSaved.body.details).toEqual([expect.objectContaining({ path: ["highHands", 0, "legacyEntrants"] })]);
    expect((await testDb().select().from(tournamentHighHands)).map((row) => row.name).sort()).toEqual(["First half", "Second half"]);
  });

  it("refuses a list that leaves the legacy high hand out while anyone is in it", async () => {
    const { tournament, td } = await legacyGame();

    const response = await putHighHands(td, tournament.id, { highHands: [{ name: "First half", entryFee: "5.00" }] });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "HIGH_HAND_ENTRIES", details: { highHandId: "legacy", entrants: 4 } });
    expect(await testDb().select().from(tournamentHighHands)).toEqual([]);
  });

  it("turns the legacy high hand off with an empty list once nobody is in it, and refuses while anyone is", async () => {
    const { tournament, td } = await setUp({ enableHighHand: true, highHandAmount: "10.00" });
    const ann = await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer({ name: "Ann" })).id, enteringHighHands: true });

    const refused = await putHighHands(td, tournament.id, { highHands: [] });
    await testDb().update(tournamentRegistrations).set({ enteringHighHands: false }).where(eq(tournamentRegistrations.id, ann.id));
    const off = await putHighHands(td, tournament.id, { highHands: [] });

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: "1 player has entered the high hand: take them out of it before turning it off",
      code: "HIGH_HAND_ENTRIES",
      details: { highHandId: "legacy", entrants: 1 },
    });
    expect(off.status).toBe(200);
    expect(off.body.tournament).toMatchObject({ enableHighHand: false, highHands: null });
    expect(off.body.prizePool.breakdown.highHands).toEqual([]);
  });

  it("stays legacy once the tournament is completed: a change is refused, and every figure reads as before", async () => {
    const { tournament, td } = await legacyGame();
    await testDb().update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, tournament.id));
    const before = await prizePool(td, tournament.id);

    const response = await putHighHands(td, tournament.id, { highHands: [LEGACY_AS_SET, { name: "Second half", entryFee: "5.00" }] });

    expect([response.status, response.body.code]).toEqual([409, "TOURNAMENT_CLOSED"]);
    expect(await prizePool(td, tournament.id)).toEqual(before);
    expect(before.breakdown.highHands).toEqual([expect.objectContaining({ highHandId: "legacy", name: "High hand" })]);
    expect(await testDb().select().from(tournamentHighHands)).toEqual([]);
  });
});

describe("the tournament form's highHands (POST and PUT /api/tournaments)", () => {
  const form = (clubId: string, extra: Record<string, unknown> = {}) => ({
    name: "Two Halves",
    clubId,
    startDateTime: "2026-12-01T07:00:00.000Z",
    buyInAmount: "50.00",
    maxPlayers: 40,
    ...extra,
  });

  it("creates a tournament listing its high hands from the start", async () => {
    const staff = await clubWithStaff();

    const response = await staff.manager.agent.post("/api/tournaments").send(form(staff.club.id, { highHands: TWO_HALVES }));

    expect(response.status).toBe(201);
    expect((response.body.highHands as HighHandDto[]).map((highHand) => highHand.name)).toEqual(["First half", "Second half"]);
    expect(response.body).toMatchObject({ enableHighHand: true, highHandAmount: "10.00" });
  });

  it("refuses the list sent with a legacy high-hand field, on that field (400 VALIDATION)", async () => {
    const staff = await clubWithStaff();
    const tournament = await createTournament({ clubId: staff.club.id });

    const created = await staff.manager.agent.post("/api/tournaments").send(form(staff.club.id, { highHands: TWO_HALVES, highHandAmount: "10.00" }));
    const updated = await staff.manager.agent.put(`/api/tournaments/${tournament.id}`).send({ highHands: TWO_HALVES, enableHighHand: true });

    expect([created.status, created.body.code, created.body.details[0].path]).toEqual([400, "VALIDATION", ["highHandAmount"]]);
    expect([updated.status, updated.body.code, updated.body.details[0].path]).toEqual([400, "VALIDATION", ["enableHighHand"]]);
  });

  it("applies the list on PUT, and asks once for the form's prices and the high hands' fees together", async () => {
    const { tournament, td, first, second } = await listedGame();

    const asked = await td.put(`/api/tournaments/${tournament.id}`).send({
      buyInAmount: "60.00",
      highHands: [{ ...TWO_HALVES[0], id: first.id, entryFee: "6.00" }, { ...TWO_HALVES[1], id: second.id }],
    });

    expect(asked.status).toBe(409);
    expect(asked.body.code).toBe("ENTRIES_REPRICED");
    expect(asked.body.details.changes).toEqual([
      { field: "buyInAmount", count: 3, fromCents: 5_000, toCents: 6_000 },
      { highHandId: first.id, name: "First half", count: 3, fromCents: 500, toCents: 600 },
    ]);
    expect((await tournamentRow(tournament.id)).buyInAmount).toBe("50.00");
  });

  it("answers a page loaded before round 10 that changes a legacy high-hand field 409 HIGH_HAND_LISTED, and accepts them resent unchanged", async () => {
    const { tournament, td } = await listedGame();

    const changed = await td.put(`/api/tournaments/${tournament.id}`).send({ enableHighHand: true, highHandAmount: "12.00" });
    const rates = await td.put(`/api/tournaments/${tournament.id}/prize-pool/rates`).send({ highHandRakeType: "percentage", highHandRakeAmount: "5.00" });
    const resent = await td.put(`/api/tournaments/${tournament.id}`).send({ name: "Renamed", enableHighHand: true, highHandAmount: "10.00", highHandRakeType: "none" });

    expect([changed.status, changed.body.code]).toEqual([409, "HIGH_HAND_LISTED"]);
    expect([rates.status, rates.body.code]).toEqual([409, "HIGH_HAND_LISTED"]);
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ name: "Renamed", highHandAmount: "10.00" });
  });
});

describe("awarding each high hand on its own", () => {
  const award = (td: Agent, tournamentId: string, highHandId: string, body: Record<string, unknown>) => td.post(awardsPath(tournamentId, highHandId)).send(body);

  it("pays each pot out to its own winners, the last taking what is left, and says so in the public feed", async () => {
    const { tournament, td, first, second, ann, bea, cy } = await listedGame();

    const firstPrize = await award(td, tournament.id, first.id, { registrationId: ann.id });
    const secondPrize = await award(td, tournament.id, first.id, { registrationId: bea.id });
    const tooMany = await award(td, tournament.id, first.id, { registrationId: cy.id });
    const otherPot = await award(td, tournament.id, second.id, { registrationId: bea.id });

    // First half: 3 × $5, no AP, two prizes. Second half: 2 × $5 less 10%, one prize.
    expect(firstPrize.status).toBe(201);
    const body = firstPrize.body as HighHandAwardResultDto;
    expect(body).toMatchObject({
      highHandId: first.id,
      pot: { name: "First half", entrants: 3, net: 1_500, winners: 2 },
      award: { registrationId: ann.id, amountCents: 750, playerName: "Ann", splitWithRegistrationId: null },
      splitFrom: null,
      nextAwardCents: 750,
      registration: { id: ann.id, highHandWinner: true, highHandAmount: "7.50", highHandWins: [{ highHandId: first.id, amountCents: 750 }] },
    });
    expect(findForbiddenKeys(body)).toEqual([]);
    expect(secondPrize.body).toMatchObject({ award: { amountCents: 750 }, nextAwardCents: null });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body).toEqual({ error: "Every First half high hand prize has been awarded (2 winners): for a tie, split it with its winner", code: "HIGH_HAND_AWARDED" });
    expect(otherPot.body).toMatchObject({ pot: { net: 900, rake: 100 }, award: { amountCents: 900 } });
    expect(await registrationRow(bea.id)).toMatchObject({ highHandWinner: true, highHandAmount: "16.50" });
    const publicFeed = await feed(await anon(), tournament.id);
    expect(publicFeed.filter((entry) => entry.type === "high_hand").map((entry) => entry.description)).toEqual([
      "Bea won the Second half high hand ($9)",
      "Bea won the First half high hand ($7.50)",
      "Ann won the First half high hand ($7.50)",
    ]);
    expect((await activityRows(tournament.id, "high_hand"))[0].data).toEqual({ highHandId: first.id, highHandName: "First half", amountCents: 750 });
    const [audit] = await auditRows("high_hand.award", tournament.id);
    expect(audit.data).toEqual({
      highHandId: first.id,
      highHandName: "First half",
      registrationId: ann.id,
      playerName: "Ann",
      change: "awarded",
      amountCents: { before: null, after: 750 },
      splitWithRegistrationId: null,
      reason: null,
      potNetCents: 1_500,
    });
    // Who awarded it stays on the server.
    expect((await testDb().select().from(highHandAwards).where(eq(highHandAwards.registrationId, ann.id)))[0].awardedBy).toBe(
      (await auditRows("high_hand.award", tournament.id))[0].actorUserId,
    );
  });

  it("refuses an entry that is not in the high hand, one that already won it, another tournament's and an unknown high hand", async () => {
    const { tournament, td, staff, second, ann, cy } = await listedGame();
    const elsewhere = await createRegistration({ tournamentId: (await createTournament({ clubId: staff.club.id })).id, playerId: (await createPlayer()).id });
    await award(td, tournament.id, second.id, { registrationId: ann.id });

    const notIn = await award(td, tournament.id, second.id, { registrationId: cy.id });
    const again = await award(td, tournament.id, second.id, { registrationId: ann.id });
    const foreign = await award(td, tournament.id, second.id, { registrationId: elsewhere.id });
    const unknown = await award(td, tournament.id, "legacy", { registrationId: ann.id });

    expect(notIn.status).toBe(400);
    expect(notIn.body).toEqual({ error: "Cy is not in the Second half high hand", code: "HIGH_HAND_NOT_ENTERED", details: { highHandId: second.id, registrationId: cy.id } });
    expect([again.status, again.body.code]).toEqual([409, "HIGH_HAND_ALREADY_WON"]);
    expect([foreign.status, foreign.body.code]).toEqual([400, "INVALID_TARGET"]);
    expect([unknown.status, unknown.body.code]).toEqual([404, "NOT_FOUND"]);
  });

  it("splits a tie with an earlier winner of the same high hand: half each, one more prize, audited", async () => {
    const { tournament, td, second, ann, bea, cy } = await listedGame();
    await award(td, tournament.id, second.id, { registrationId: ann.id });

    const notAWinner = await award(td, tournament.id, second.id, { registrationId: bea.id, splitWith: cy.id });
    const tie = await award(td, tournament.id, second.id, { registrationId: bea.id, splitWith: ann.id });

    expect([notAWinner.status, notAWinner.body.code]).toEqual([400, "INVALID_TARGET"]);
    expect(tie.status).toBe(201);
    expect(tie.body).toMatchObject({
      pot: { winners: 2, net: 900 },
      award: { registrationId: bea.id, amountCents: 450, splitWithRegistrationId: ann.id },
      splitFrom: { registrationId: ann.id, amountCents: 450 },
    });
    expect((await testDb().select().from(tournamentHighHands).where(eq(tournamentHighHands.id, second.id)))[0].winners).toBe(2);
    expect(await registrationRow(ann.id)).toMatchObject({ highHandAmount: "4.50" });
    expect((await activityRows(tournament.id, "high_hand")).at(-1)?.description).toBe("Bea won the Second half high hand, split with Ann ($4.50; Ann keeps $4.50)");
    const [split] = await auditRows("high_hand.split", tournament.id);
    expect(split.data).toEqual({
      registrationId: bea.id,
      splitWithRegistrationId: ann.id,
      shareCents: 450,
      keepCents: 450,
      highHandPayouts: { before: 1, after: 2 },
      highHandId: second.id,
    });
  });

  it("corrects a prize to add money paid in late, within the pot, and takes an award back", async () => {
    const { tournament, td, second, ann, bea } = await listedGame();
    // Bea is unpaid: only Ann's $5 is in the pot, less 10%.
    await testDb().update(tournamentRegistrations).set({ paymentConfirmed: false }).where(eq(tournamentRegistrations.id, bea.id));
    await award(td, tournament.id, second.id, { registrationId: ann.id });

    const paid = await td.patch(`/api/registrations/${bea.id}/confirm-payment`).send({});
    const over = await td.patch(awardsPath(tournament.id, second.id, ann.id)).send({ amount: "9.50" });
    const corrected = await td.patch(awardsPath(tournament.id, second.id, ann.id)).send({ amount: "9.00", reason: "Bea paid late" });
    const notWon = await td.patch(awardsPath(tournament.id, second.id, bea.id)).send({ amount: "1.00" });
    const takenBack = await td.delete(awardsPath(tournament.id, second.id, ann.id));
    const again = await td.delete(awardsPath(tournament.id, second.id, ann.id));

    expect(paid.body).toMatchObject({ highHandUnawardedCents: 450, highHandsUnawarded: [{ highHandId: second.id, name: "Second half", cents: 450 }] });
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({ code: "HIGH_HAND_OVER_POOL", details: { highHandId: second.id, awardedCents: 950, potCents: 900 } });
    expect(corrected.status).toBe(200);
    expect(corrected.body).toMatchObject({ award: { amountCents: 900 }, unawardedCents: 0 });
    expect([notWon.status, notWon.body.code]).toEqual([404, "NOT_FOUND"]);
    expect(takenBack.status).toBe(200);
    expect(takenBack.body as HighHandAwardsDto).toMatchObject({ highHandId: second.id, awards: [], nextAwardCents: 900 });
    expect(await registrationRow(ann.id)).toMatchObject({ highHandWinner: false, highHandAmount: null });
    expect([again.status, again.body.code]).toEqual([404, "NOT_FOUND"]);
    expect((await activityRows(tournament.id, "high_hand")).map((entry) => entry.description)).toEqual([
      "Ann won the Second half high hand ($4.50)",
      "Ann's Second half high hand prize is now $9 - Bea paid late",
      "Ann's Second half high hand win was taken back",
    ]);
    expect((await auditRows("high_hand.award", tournament.id)).map((row) => (row.data as { change: string }).change)).toEqual(["awarded", "corrected", "taken_back"]);
  });

  it("is allowed after the game, as high hands are settled at the end of the night", async () => {
    const { tournament, td, second, ann } = await listedGame();
    await testDb().update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, tournament.id));

    const response = await award(td, tournament.id, second.id, { registrationId: ann.id });

    expect(response.status).toBe(201);
  });

  it("awards a legacy tournament's high hand (\"legacy\") exactly as PUT /api/registrations/:id does", async () => {
    const { tournament, td, entry } = await setUp({ enableHighHand: true, highHandAmount: "10.00" });
    const ann = await entry("Ann", { enteringHighHands: true });
    const bea = await entry("Bea", { enteringHighHands: true });

    const won = await award(td, tournament.id, "legacy", { registrationId: ann.id });
    const notIn = await award(td, tournament.id, "legacy", { registrationId: (await entry("Cy")).id });
    const tie = await award(td, tournament.id, "legacy", { registrationId: bea.id, splitWith: ann.id });
    const back = await td.delete(awardsPath(tournament.id, "legacy", bea.id));

    expect(won.status).toBe(201);
    expect(won.body).toMatchObject({ highHandId: "legacy", pot: { highHandId: "legacy", net: 2_000 }, award: { amountCents: 2_000 }, registration: { highHandWinner: true, highHandAmount: "20.00", highHandWins: [] } });
    expect([notIn.status, notIn.body.code]).toEqual([400, "HIGH_HAND_NOT_ENTERED"]);
    expect(tie.body).toMatchObject({ award: { amountCents: 1_000 }, splitFrom: { registrationId: ann.id, amountCents: 1_000 } });
    expect(await tournamentRow(tournament.id)).toMatchObject({ highHandPayouts: 2 });
    expect(back.body).toMatchObject({ awards: [{ registrationId: ann.id, amountCents: 1_000 }] });
    expect(await registrationRow(bea.id)).toMatchObject({ highHandWinner: false, highHandAmount: null });
    // The legacy feed lines, word for word, and the take-back said too, for everyone (R10REV1-AUDIT-03).
    expect((await activityRows(tournament.id, "high_hand")).map((row) => row.description)).toEqual([
      "Ann won high hand ($20)",
      "Bea won high hand, split with Ann ($10; Ann keeps $10)",
      "Bea's high hand win was taken back",
    ]);
    expect((await feed(await anon(), tournament.id)).map((entry) => entry.description)).toContain("Bea's high hand win was taken back");
    expect((await auditRows("high_hand.award", tournament.id)).map((row) => row.data)).toEqual([
      {
        highHandId: "legacy",
        highHandName: "High hand",
        registrationId: bea.id,
        playerName: "Bea",
        change: "taken_back",
        amountCents: { before: 1_000, after: null },
        splitWithRegistrationId: null,
        reason: null,
        potNetCents: 2_000,
      },
    ]);
    expect(await testDb().select().from(highHandAwards)).toEqual([]);
  });

  it("logs and audits a legacy prize corrected from its award screen, by the PUT's rules (R10REV1-AUDIT-03)", async () => {
    const { tournament, td, entry } = await setUp({ enableHighHand: true, highHandAmount: "10.00" });
    const ann = await entry("Ann", { enteringHighHands: true });
    const bea = await entry("Bea", { enteringHighHands: true, paymentConfirmed: false });
    await award(td, tournament.id, "legacy", { registrationId: ann.id });
    await td.patch(`/api/registrations/${bea.id}/confirm-payment`).send({});

    const over = await td.patch(awardsPath(tournament.id, "legacy", ann.id)).send({ amount: "25.00" });
    const same = await td.patch(awardsPath(tournament.id, "legacy", ann.id)).send({ amount: "10.00" });
    const corrected = await td.patch(awardsPath(tournament.id, "legacy", ann.id)).send({ amount: "20.00", reason: "Bea paid late" });

    expect([over.status, over.body.code]).toEqual([409, "HIGH_HAND_OVER_POOL"]);
    expect(same.status).toBe(200);
    expect(corrected.body).toMatchObject({ award: { amountCents: 2_000 }, unawardedCents: 0 });
    expect(await registrationRow(ann.id)).toMatchObject({ highHandWinner: true, highHandAmount: "20.00" });
    expect((await activityRows(tournament.id, "high_hand")).map((row) => row.description)).toEqual([
      "Ann won high hand ($10)",
      "Ann's high hand prize is now $20 - Bea paid late",
    ]);
    expect((await auditRows("high_hand.award", tournament.id)).map((row) => row.data)).toEqual([
      expect.objectContaining({ highHandId: "legacy", change: "corrected", amountCents: { before: 1_000, after: 2_000 }, reason: "Bea paid late", potNetCents: 2_000 }),
    ]);
  });
});

describe("each pot on the public page, the TV and the finalize record", () => {
  it("lists each pot by name on the public prizes, with its awards and never its AP", async () => {
    const { tournament, td, first, second, ann } = await listedGame();
    await td.post(awardsPath(tournament.id, second.id)).send({ registrationId: ann.id });

    const prizes = (await (await anon()).get(`/api/public/tournaments/${tournament.id}/prizes`)).body as PublicPrizesDto;

    expect(prizes.highHands).toEqual([
      { id: first.id, name: "First half", entryFeeCents: 500, note: "Before the break", potCents: 1_500, winners: 2, awards: [] },
      { id: second.id, name: "Second half", entryFeeCents: 500, note: null, potCents: 900, winners: 1, awards: [{ registrationId: ann.id, amountCents: 900 }] },
    ]);
    expect(prizes.highHandPotCents).toBe(2_400);
    expect(findTakingsKeys(prizes)).toEqual([]);
    expect(findForbiddenKeys(prizes)).toEqual([]);
  });

  it("shows the pots on the TV only once the TD switches them on, by name and amount only", async () => {
    const { tournament, td } = await listedGame();
    await td.put(`/api/tournaments/${tournament.id}/clock`).send({ structure: presetStructure("central_stars_one_life_line"), displaySettings: { showPrizePool: "never" }, baseHash: null });

    const off = await (await anon()).get(`/api/public/tournaments/${tournament.id}/display`);
    const switched = await td.patch(`/api/tournaments/${tournament.id}/clock/display`).send({ showHighHands: true });
    const on = await (await anon()).get(`/api/public/tournaments/${tournament.id}/display`);

    expect(off.body.money.highHands).toBeNull();
    expect(switched.status).toBe(200);
    expect(on.body.money).toMatchObject({ show: false, netCents: null });
    expect(on.body.money.highHands).toEqual([
      { id: expect.any(String), name: "First half", potCents: 1_500 },
      { id: expect.any(String), name: "Second half", potCents: 900 },
    ]);
    expect(findTakingsKeys(on.body)).toEqual([]);
  });

  it("records each pot and its awards in the finalize snapshot, for the club's staff only", async () => {
    const { tournament, td, staff, first, second, ann, bea, cy } = await listedGame();
    await td.post(awardsPath(tournament.id, second.id)).send({ registrationId: ann.id });
    await td.put(`/api/registrations/${cy.id}`).send({ isEliminated: true });
    await td.put(`/api/registrations/${bea.id}`).send({ isEliminated: true });
    const preview = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});

    const finalized = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize`).send({ expectedPlanHash: preview.body.planHash });

    expect(finalized.status).toBe(200);
    expect(finalized.body.snapshot.highHands).toEqual([
      { highHandId: first.id, name: "First half", feeCents: 500, entrants: 3, grossCents: 1_500, rakeCents: 0, netCents: 1_500, winners: 2, awards: [] },
      {
        highHandId: second.id,
        name: "Second half",
        feeCents: 500,
        entrants: 2,
        grossCents: 1_000,
        rakeCents: 100,
        netCents: 900,
        winners: 1,
        awards: [{ registrationId: ann.id, playerName: "Ann", amountCents: 900, splitWithRegistrationId: null }],
      },
    ]);
    expect((await (await anon()).get(`/api/tournaments/${tournament.id}`)).body.prizePoolSnapshot).toBeNull();
  });
});
