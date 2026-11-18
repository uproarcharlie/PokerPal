/**
 * Players enter the high hands they want (round 10, the owner: "players will only want to sign up to
 * one of the high hands … so they pay 5 instead of 10"). At the QR sign-up and the desk a player ticks
 * which of the tournament's high hands they are in (`highHandIds`); what they owe and the transfer
 * card follow the choice (the high hands are paid at the door: round 8); and staff change it later
 * from the desk's Fix menu (PUT /api/registrations/:id highHandIds), under the pool lock and pot rules.
 * A tournament that keeps its one legacy high hand works as before, its high hand named "legacy".
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { HighHandDto } from "@shared/api/high-hands";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import { findForbiddenKeys, findTakingsKeys, type ActivityDto } from "@shared/api/public";
import type { PendingRegistrationDto } from "@shared/api/registrations";
import { activityLog, auditLog, registrationHighHands, tournamentRegistrations, tournaments, type Tournament } from "@shared/schema";
import { createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";
import { signUpTokenFor } from "../helpers/sign-up";

beforeEach(resetDb);

const BANK = { accountName: "Central Stars Poker Club", accountNumber: "12-3456-7890123-00", bankName: "ASB", instructions: null };

/**
 * A $50 game open for sign-ups at a club with bank details shown after sign-up, running two high hands
 * set through the API: "First half" ($5, no AP) and "Second half" ($5, 10% AP).
 */
async function game(overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff();
  await staff.owner.agent.put(`/api/clubs/${staff.club.id}/payments`).send({ bankDetails: BANK });
  const tournament = await createTournament({ clubId: staff.club.id, status: "registration", name: "Wed Night", buyInAmount: "50.00", showBankTransfer: true, ...overrides });
  const td = staff.manager.agent;
  const listed = await td.put(`/api/tournaments/${tournament.id}/high-hands`).send({
    highHands: [
      { name: "First half", entryFee: "5.00", note: "Before the break" },
      { name: "Second half", entryFee: "5.00", rakeType: "percentage", rakeAmount: "10.00" },
    ],
  });
  if (listed.status !== 200) throw new Error(`Setup: ${JSON.stringify(listed.body)}`);
  const [first, second] = listed.body.tournament.highHands as HighHandDto[];
  return { staff, tournament, td, first, second };
}

type World = Awaited<ReturnType<typeof game>>;

const qrSignUp = async (tournament: Pick<Tournament, "id">, name: string, body: Record<string, unknown> = {}) => {
  const player = await createPlayer({ name, phone: "021 555 0199" });
  return (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: player.id, signUpToken: signUpTokenFor(player.id), ...body });
};

const deskSignUp = async (world: World, name: string, body: Record<string, unknown> = {}) =>
  world.td.post(`/api/tournaments/${world.tournament.id}/registrations`).send({ playerId: (await createPlayer({ name })).id, ...body });

const poolOf = async (world: World) => ((await world.td.get(`/api/tournaments/${world.tournament.id}/prize-pool`)).body as PrizePoolDto).breakdown;

const potsOf = async (world: World) =>
  (await poolOf(world)).highHands.map(({ name, entrants, gross, rake, net }) => ({ name, entrants, gross, rake, net }));

const entrantRows = async (registrationId: string) =>
  (await testDb().select().from(registrationHighHands).where(eq(registrationHighHands.registrationId, registrationId))).map((row) => row.highHandId).sort();

const registrationRow = async (id: string) => (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];

const corrections = async (tournamentId: string) =>
  (await testDb().select().from(activityLog).where(and(eq(activityLog.tournamentId, tournamentId), eq(activityLog.eventType, "entry_corrected"))).orderBy(asc(activityLog.timestamp), asc(activityLog.id))).map(
    (entry) => entry.description,
  );

const correctionAudits = (registrationId: string) =>
  testDb().select().from(auditLog).where(and(eq(auditLog.action, "registration.correct"), eq(auditLog.targetId, registrationId))).orderBy(asc(auditLog.createdAt), asc(auditLog.id));

describe("choosing high hands at the QR sign-up", () => {
  it("lets a player enter only the second high hand: the transfer is the buy-in, and the $5 is paid at the door", async () => {
    const world = await game();

    const response = await qrSignUp(world.tournament, "Tama Rangi", { highHandIds: [world.second.id] });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ highHandIds: [world.second.id], highHandWins: [], enteringHighHands: true });
    expect(response.body.paymentInstructions).toMatchObject({
      amountDueCents: 5_000,
      highHandAtDoorCents: 500,
      highHandsAtDoor: [{ highHandId: world.second.id, name: "Second half", feeCents: 500 }],
      reference: "Tama Rangi",
    });
    // The high hand's AP is the club's: never in the sign-up's answer.
    expect(findTakingsKeys(response.body)).toEqual([]);
    expect(await entrantRows(response.body.id)).toEqual([world.second.id]);
    const pending = (await world.td.get(`/api/tournaments/${world.tournament.id}/pending-registrations`)).body as PendingRegistrationDto[];
    expect(pending).toEqual([expect.objectContaining({ id: response.body.id, amountOwed: 55, highHandIds: [world.second.id] })]);
  });

  it("charges both high hands for both ($10 at the door), and nothing for none", async () => {
    const world = await game();

    const both = await qrSignUp(world.tournament, "Ana Both", { highHandIds: [world.second.id, world.first.id, world.second.id] });
    const none = await qrSignUp(world.tournament, "Nia None", { highHandIds: [] });

    expect(both.body.highHandIds).toEqual([world.first.id, world.second.id]);
    expect(both.body.paymentInstructions).toMatchObject({ amountDueCents: 5_000, highHandAtDoorCents: 1_000, highHandsAtDoor: [{ name: "First half" }, { name: "Second half" }] });
    expect(none.body).toMatchObject({ highHandIds: [], enteringHighHands: false });
    expect(none.body.paymentInstructions).toMatchObject({ highHandAtDoorCents: 0, highHandsAtDoor: [] });
    const owed = ((await world.td.get(`/api/tournaments/${world.tournament.id}/pending-registrations`)).body as PendingRegistrationDto[]).map((row) => row.amountOwed);
    expect(owed).toEqual([60, 50]);
  });

  it("reads the high-hand tick of a page loaded before round 10 as every high hand, or none", async () => {
    const world = await game();

    const ticked = await qrSignUp(world.tournament, "Old Page", { enteringHighHands: true });
    const unticked = await qrSignUp(world.tournament, "Old Page Too", { enteringHighHands: false });

    expect(ticked.body).toMatchObject({ highHandIds: [world.first.id, world.second.id], enteringHighHands: true });
    expect(unticked.body).toMatchObject({ highHandIds: [], enteringHighHands: false });
  });

  it("refuses a high hand the tournament does not run, saying which, and records nothing", async () => {
    const world = await game();

    const response = await qrSignUp(world.tournament, "Stray Id", { highHandIds: [world.first.id, "legacy"] });

    expect([response.status, response.body.code, response.body.details]).toEqual([400, "HIGH_HAND_NOT_AVAILABLE", { highHandId: "legacy" }]);
    expect(await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, world.tournament.id))).toEqual([]);
  });

  it("puts a desk sign-up registered as paid in the pots it chose, and only those", async () => {
    const world = await game();

    const response = await deskSignUp(world, "Paid Pat", { paymentConfirmed: true, paidBy: "cash", highHandIds: [world.first.id] });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ highHandIds: [world.first.id], paymentConfirmed: true });
    expect(await potsOf(world)).toEqual([
      { name: "First half", entrants: 1, gross: 500, rake: 0, net: 500 },
      { name: "Second half", entrants: 0, gross: 0, rake: 0, net: 0 },
    ]);
  });

  it("keeps a tournament's legacy high hand as it was: \"legacy\" is its tick, and its pot the one figure it always was", async () => {
    const staff = await clubWithStaff();
    await staff.owner.agent.put(`/api/clubs/${staff.club.id}/payments`).send({ bankDetails: BANK });
    const legacy = await createTournament({ clubId: staff.club.id, status: "registration", buyInAmount: "50.00", enableHighHand: true, highHandAmount: "10.00", showBankTransfer: true });

    const chosen = await qrSignUp(legacy, "Legacy Lou", { highHandIds: ["legacy"] });
    const listedId = await qrSignUp(legacy, "Wrong Id", { highHandIds: ["a-listed-one"] });

    expect(chosen.status).toBe(201);
    // A legacy tournament's entries carry no listed high hands: the column says it, as before.
    expect(chosen.body).toMatchObject({ enteringHighHands: true, highHandIds: [], highHandWins: [] });
    expect(chosen.body.paymentInstructions).toMatchObject({ highHandAtDoorCents: 1_000, highHandsAtDoor: [{ highHandId: "legacy", name: "High hand", feeCents: 1_000 }] });
    expect([listedId.status, listedId.body.details]).toEqual([400, { highHandId: "a-listed-one" }]);
    expect(await testDb().select().from(registrationHighHands)).toEqual([]);
  });
});

describe("changing a player's high hands from the desk's Fix menu (PUT /api/registrations/:id highHandIds)", () => {
  async function paidInBoth() {
    const world = await game({ status: "in_progress" });
    const ann = (await deskSignUp(world, "Ann", { paymentConfirmed: true, highHandIds: [world.first.id, world.second.id] })).body as { id: string };
    return { ...world, ann };
  }

  it("moves a paid player to the second only: the pots, what they paid, a staff-only feed line and an audit row", async () => {
    const world = await paidInBoth();

    const response = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.second.id] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ highHandIds: [world.second.id], enteringHighHands: true });
    expect(await entrantRows(world.ann.id)).toEqual([world.second.id]);
    expect((await potsOf(world)).map(({ entrants }) => entrants)).toEqual([0, 1]);
    const paid = (await world.td.get(`/api/tournaments/${world.tournament.id}/confirmed-registrations`)).body as Array<{ amountPaid: number }>;
    expect(paid.map((row) => row.amountPaid)).toEqual([55]);
    expect(await corrections(world.tournament.id)).toEqual(["Ann is now in the Second half high hand"]);
    const feed = async (agent: typeof world.td | Awaited<ReturnType<typeof anon>>) =>
      ((await agent.get(`/api/tournaments/${world.tournament.id}/activity`)).body as ActivityDto[]).map((entry) => entry.description);
    expect(await feed(world.td)).toContain("Ann is now in the Second half high hand");
    expect(await feed(await anon())).not.toContain("Ann is now in the Second half high hand");
    expect(await correctionAudits(world.ann.id)).toEqual([
      expect.objectContaining({
        actorUserId: world.staff.manager.user.id,
        data: {
          tournamentId: world.tournament.id,
          playerName: "Ann",
          change: "high_hand",
          before: { paymentConfirmed: true, paidBy: null, enteringHighHands: true, highHandIds: [world.first.id, world.second.id] },
          after: { paymentConfirmed: true, paidBy: null, enteringHighHands: true, highHandIds: [world.second.id] },
        },
      }),
    ]);
  });

  it("takes a player out of every high hand, says so, and leaves the same choice resent as no change", async () => {
    const world = await paidInBoth();

    const none = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [] });
    const again = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [] });
    const both = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.first.id, world.second.id] });

    expect(none.body).toMatchObject({ highHandIds: [], enteringHighHands: false });
    expect(again.status).toBe(200);
    expect(both.body.highHandIds).toEqual([world.first.id, world.second.id]);
    expect(await corrections(world.tournament.id)).toEqual(["Ann is no longer in any high hand", "Ann is now in the First half and Second half high hands"]);
  });

  it("reads the high-hand tick alone as every high hand, or none", async () => {
    const world = await paidInBoth();
    await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.first.id] });

    const all = await world.td.put(`/api/registrations/${world.ann.id}`).send({ enteringHighHands: true });
    const none = await world.td.put(`/api/registrations/${world.ann.id}`).send({ enteringHighHands: false });

    expect(all.body.highHandIds).toEqual([world.first.id, world.second.id]);
    expect(none.body.highHandIds).toEqual([]);
  });

  it("refuses joining a high hand while the prize pool is locked, never leaving one", async () => {
    const world = await paidInBoth();
    await world.td.put(`/api/tournaments/${world.tournament.id}`).send({ prizePoolLocked: true });

    const leaves = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.first.id] });
    const joins = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.first.id, world.second.id] });

    expect(leaves.status).toBe(200);
    expect([joins.status, joins.body.code]).toEqual([409, "PRIZE_POOL_LOCKED"]);
    expect(await entrantRows(world.ann.id)).toEqual([world.first.id]);
  });

  it("refuses taking a winner out of the high hand they won until the award is taken back", async () => {
    const world = await paidInBoth();
    await world.td.post(`/api/tournaments/${world.tournament.id}/high-hands/${world.first.id}/awards`).send({ registrationId: world.ann.id });

    const refused = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.second.id] });
    await world.td.delete(`/api/tournaments/${world.tournament.id}/high-hands/${world.first.id}/awards/${world.ann.id}`);
    const allowed = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.second.id] });

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: "Ann won the First half high hand: take that award back before taking them out of it",
      code: "HIGH_HAND_WINNER",
      details: { highHandId: world.first.id },
    });
    expect(allowed.body.highHandIds).toEqual([world.second.id]);
  });

  it("refuses a change that leaves a pot's awards bigger than the pot, naming the pot", async () => {
    const world = await paidInBoth();
    const bea = (await deskSignUp(world, "Bea", { paymentConfirmed: true, highHandIds: [world.first.id] })).body as { id: string };
    // One prize: Ann wins the whole $10 First half pot.
    await world.td.post(`/api/tournaments/${world.tournament.id}/high-hands/${world.first.id}/awards`).send({ registrationId: world.ann.id });

    const response = await world.td.put(`/api/registrations/${bea.id}`).send({ highHandIds: [] });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "HIGH_HAND_OVER_POOL",
      error: "First half high hand: the awards already made ($10) would be more than the $5 pot: take an award back first",
      details: { highHandId: world.first.id, name: "First half", awardedCents: 1_000, potCents: 500 },
    });
    expect(await entrantRows(bea.id)).toEqual([world.first.id]);
  });

  it("is allowed after the game, as every high-hand detail is", async () => {
    const world = await paidInBoth();
    await testDb().update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, world.tournament.id));

    const response = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: [world.first.id] });

    expect(response.status).toBe(200);
    expect(response.body.highHandIds).toEqual([world.first.id]);
  });

  it("answers a page loaded before round 10 that awards with the legacy fields 409 HIGH_HAND_LISTED, and ignores them resent unchanged", async () => {
    const world = await paidInBoth();

    const awards = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandWinner: true });
    const amount = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandAmount: "10.00" });
    const split = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandWinner: true, highHandSplitWith: world.ann.id });
    const resent = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandWinner: false, highHandAmount: null, knockouts: 1 });

    for (const refused of [awards, amount, split]) expect([refused.status, refused.body.code]).toEqual([409, "HIGH_HAND_LISTED"]);
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ knockouts: 1, highHandWinner: false, highHandIds: [world.first.id, world.second.id] });
    expect(await registrationRow(world.ann.id)).toMatchObject({ highHandWinner: false, highHandAmount: null });
  });

  it("refuses a high hand the tournament does not run (400 HIGH_HAND_NOT_AVAILABLE), changing nothing", async () => {
    const world = await paidInBoth();

    const response = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandIds: ["legacy"] });

    expect([response.status, response.body.code, response.body.details]).toEqual([400, "HIGH_HAND_NOT_AVAILABLE", { highHandId: "legacy" }]);
    expect(await entrantRows(world.ann.id)).toEqual([world.first.id, world.second.id].sort());
  });

  it("takes a legacy tournament's ['legacy'] as its tick, with the round 9 feed line and audit row as before", async () => {
    const staff = await clubWithStaff();
    const legacy = await createTournament({ clubId: staff.club.id, status: "in_progress", enableHighHand: true, highHandAmount: "10.00" });
    const ann = await createRegistration({ tournamentId: legacy.id, playerId: (await createPlayer({ name: "Ann" })).id, paymentConfirmed: true });

    const joined = await staff.manager.agent.put(`/api/registrations/${ann.id}`).send({ highHandIds: ["legacy"] });
    const left = await staff.manager.agent.put(`/api/registrations/${ann.id}`).send({ highHandIds: [] });

    expect(joined.body).toMatchObject({ enteringHighHands: true, highHandIds: [] });
    expect(left.body).toMatchObject({ enteringHighHands: false });
    expect(await corrections(legacy.id)).toEqual(["Ann is now in the high hand", "Ann is no longer in the high hand"]);
    const [audit] = await correctionAudits(ann.id);
    expect(audit.data).toEqual({
      tournamentId: legacy.id,
      playerName: "Ann",
      change: "high_hand",
      before: { paymentConfirmed: true, paidBy: null, enteringHighHands: false },
      after: { paymentConfirmed: true, paidBy: null, enteringHighHands: true },
    });
  });

  it("applies one Fix tick to the entry as the server holds it, so a quick second tick from a list not yet reloaded never undoes the first (R10REV1-PHONE-01)", async () => {
    const world = await game({ status: "in_progress" });
    const tama = (await deskSignUp(world, "Tama", { paymentConfirmed: true })).body as { id: string };
    const tick = (body: Record<string, unknown>) => world.td.put(`/api/registrations/${tama.id}`).send(body);

    const first = await tick({ joinHighHandIds: [world.first.id] });
    // The desk's list still shows Tama in no high hand: the second tick names only its own.
    const second = await tick({ joinHighHandIds: [world.second.id] });
    const again = await tick({ joinHighHandIds: [world.second.id] });
    const left = await tick({ leaveHighHandIds: [world.first.id] });

    expect(first.body).toMatchObject({ highHandIds: [world.first.id], enteringHighHands: true });
    expect(second.body.highHandIds).toEqual([world.first.id, world.second.id]);
    expect(again.status).toBe(200);
    expect(left.body).toMatchObject({ highHandIds: [world.second.id], enteringHighHands: true });
    expect(await entrantRows(tama.id)).toEqual([world.second.id]);
    expect((await potsOf(world)).map(({ entrants }) => entrants)).toEqual([0, 1]);
    expect(await corrections(world.tournament.id)).toEqual([
      "Tama is now in the First half high hand",
      "Tama is now in the First half and Second half high hands",
      "Tama is now in the Second half high hand",
    ]);
    expect((await correctionAudits(tama.id)).map((row) => (row.data as { after: { highHandIds: string[] } }).after.highHandIds)).toEqual([
      [world.first.id],
      [world.first.id, world.second.id],
      [world.second.id],
    ]);
  });

  it("holds a Fix tick to the rules of the whole choice, and refuses one sent with the whole choice", async () => {
    const world = await paidInBoth();
    await world.td.post(`/api/tournaments/${world.tournament.id}/high-hands/${world.first.id}/awards`).send({ registrationId: world.ann.id });
    const tick = (body: Record<string, unknown>) => world.td.put(`/api/registrations/${world.ann.id}`).send(body);

    const won = await tick({ leaveHighHandIds: [world.first.id] });
    const unknown = await tick({ joinHighHandIds: ["legacy"] });
    const mixed = await tick({ joinHighHandIds: [world.second.id], highHandIds: [world.first.id] });
    const flag = await tick({ leaveHighHandIds: [world.second.id], enteringHighHands: true });
    const both = await tick({ joinHighHandIds: [world.second.id], leaveHighHandIds: [world.second.id] });
    await tick({ leaveHighHandIds: [world.second.id] });
    await world.td.put(`/api/tournaments/${world.tournament.id}`).send({ prizePoolLocked: true });
    const locked = await tick({ joinHighHandIds: [world.second.id] });

    expect([won.status, won.body.code, won.body.details]).toEqual([409, "HIGH_HAND_WINNER", { highHandId: world.first.id }]);
    expect([unknown.status, unknown.body.code, unknown.body.details]).toEqual([400, "HIGH_HAND_NOT_AVAILABLE", { highHandId: "legacy" }]);
    for (const refused of [mixed, flag, both]) expect([refused.status, refused.body.code]).toEqual([400, "VALIDATION"]);
    expect(mixed.body.details).toEqual([expect.objectContaining({ path: ["highHandIds"] })]);
    expect(both.body.details).toEqual([expect.objectContaining({ path: ["leaveHighHandIds"] })]);
    expect([locked.status, locked.body.code]).toEqual([409, "PRIZE_POOL_LOCKED"]);
    expect(await entrantRows(world.ann.id)).toEqual([world.first.id]);
  });

  it("takes a Fix tick of a legacy tournament's \"legacy\" as its flag", async () => {
    const staff = await clubWithStaff();
    const legacy = await createTournament({ clubId: staff.club.id, status: "in_progress", enableHighHand: true, highHandAmount: "10.00" });
    const ann = await createRegistration({ tournamentId: legacy.id, playerId: (await createPlayer({ name: "Ann" })).id, paymentConfirmed: true });
    const tick = (body: Record<string, unknown>) => staff.manager.agent.put(`/api/registrations/${ann.id}`).send(body);

    const joined = await tick({ joinHighHandIds: ["legacy"] });
    const again = await tick({ joinHighHandIds: ["legacy"] });
    const left = await tick({ leaveHighHandIds: ["legacy"] });

    expect(joined.body).toMatchObject({ enteringHighHands: true, highHandIds: [] });
    expect(again.status).toBe(200);
    expect(left.body).toMatchObject({ enteringHighHands: false });
    expect(await corrections(legacy.id)).toEqual(["Ann is now in the high hand", "Ann is no longer in the high hand"]);
  });

  it("lists each entry's high hands for everyone, with no contact detail or AP", async () => {
    const world = await paidInBoth();

    const [publicList, staffList] = await Promise.all([
      (await anon()).get(`/api/tournaments/${world.tournament.id}/registrations`),
      world.td.get(`/api/tournaments/${world.tournament.id}/registrations`),
    ]);

    for (const { body } of [publicList, staffList]) {
      expect(body[0]).toMatchObject({ highHandIds: [world.first.id, world.second.id], highHandWins: [] });
      expect(findForbiddenKeys(body)).toEqual([]);
      expect(JSON.stringify(body)).not.toMatch(/rakeType|rakeAmount/);
    }
    expect(findTakingsKeys(publicList.body)).toEqual([]);
  });
});
