/**
 * Correcting an entry already confirmed as paid (round 9, item 1; the owner: "I need to be able to edit
 * players who are confirmed as paid just in case of a mistake"). From the desk's Fix menu, staff mark a
 * paid entry as not paid (PUT /api/registrations/:id { paymentConfirmed: false }: out of the paid-only
 * prize pool, seat kept, nobody on the waiting list accepted; refused once the game is over), change how
 * it paid (confirm-payment's paidBy), tick or untick its high hand, and edit the player's details with
 * the tournament named. Every correction is a staff-only feed entry and an audit row.
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import type { ActivityDto } from "@shared/api/public";
import type { ManagedRegistration, PendingRegistrationDto } from "@shared/api/registrations";
import type { SeatingDto } from "@shared/api/seating";
import { activityLog, auditLog, players, tournamentRegistrations } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, type NewRegistration, type NewTournament } from "../factories";
import { createSeat, createTable } from "../factories/seating";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

/**
 * A $50 game for three, in progress at a club: Ann, Bea and Cy have paid (Bea in cash) and sit at
 * Table 1; Wes signed up after the field filled, so he is #1 on the waiting list.
 */
async function game(overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", buyInAmount: "50.00", maxPlayers: 3, ...overrides });
  const entry = async (name: string, minute: number, extra: Partial<NewRegistration> = {}) =>
    createRegistration({
      tournamentId: tournament.id,
      playerId: (await createPlayer({ name, phone: `021 555 01${minute}0` })).id,
      registrationTime: new Date(Date.UTC(2026, 10, 18, 6, minute)),
      ...extra,
    });
  const ann = await entry("Ann", 0, { paymentConfirmed: true, paidBy: "cash" });
  const bea = await entry("Bea", 1, { paymentConfirmed: true, paidBy: "cash" });
  const cy = await entry("Cy", 2, { paymentConfirmed: true });
  const wes = await entry("Wes", 3);
  const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
  await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: ann.id, seatNumber: 1 });
  await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: bea.id, seatNumber: 2 });
  await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: cy.id, seatNumber: 3 });
  return { staff, tournament, ann, bea, cy, wes, td: staff.manager.agent };
}

const row = async (id: string) => (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];

const corrections = async (tournamentId: string) =>
  (await testDb().select().from(activityLog).where(and(eq(activityLog.tournamentId, tournamentId), eq(activityLog.eventType, "entry_corrected"))).orderBy(asc(activityLog.timestamp), asc(activityLog.id))).map(
    ({ description, eventData }) => ({ description, data: eventData ? (JSON.parse(eventData) as Record<string, unknown>) : null }),
  );

const auditRows = (action: "registration.correct" | "player.update", targetId: string) =>
  testDb().select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId))).orderBy(asc(auditLog.createdAt), asc(auditLog.id));

type Agent = Awaited<ReturnType<typeof game>>["td"];

const poolOf = async (agent: Agent, tournamentId: string) => ((await agent.get(`/api/tournaments/${tournamentId}/prize-pool`)).body as PrizePoolDto).breakdown;

const feedOf = async (agent: Agent | Awaited<ReturnType<typeof anon>>, tournamentId: string) =>
  ((await agent.get(`/api/tournaments/${tournamentId}/activity`)).body as ActivityDto[]).map((entry) => entry.description);

describe("marking a paid entry as not paid", () => {
  it("puts it back to not paid yet: out of the paid-only pool, in its seat, with the waiting list as it was", async () => {
    const world = await game();
    const before = await poolOf(world.td, world.tournament.id);

    const response = await world.td.put(`/api/registrations/${world.bea.id}`).send({ paymentConfirmed: false });

    expect(response.status).toBe(200);
    expect(response.body as ManagedRegistration).toMatchObject({ id: world.bea.id, paymentConfirmed: false, paidBy: null, waitingListPosition: null });
    expect(await row(world.bea.id)).toMatchObject({ paymentConfirmed: false, paidBy: null });
    // Only paid players are in the pool: $150 in before, $100 now.
    const after = await poolOf(world.td, world.tournament.id);
    expect([before.gross.total, after.gross.total]).toEqual([15_000, 10_000]);
    expect(after.netAfterAp).toBe(before.netAfterAp - 5_000);
    // Back on the desk's list to pay, still in the field; Wes is still #1 and nobody accepted him.
    const pending = (await world.td.get(`/api/tournaments/${world.tournament.id}/pending-registrations`)).body as PendingRegistrationDto[];
    expect(pending.map(({ id, amountOwed, waitingListPosition }) => ({ id, amountOwed, waitingListPosition }))).toEqual([
      { id: world.bea.id, amountOwed: 50, waitingListPosition: null },
      { id: world.wes.id, amountOwed: 50, waitingListPosition: 1 },
    ]);
    expect(await row(world.wes.id)).toMatchObject({ paymentConfirmed: false });
    const seating = (await world.td.get(`/api/tournaments/${world.tournament.id}/seating`)).body as SeatingDto;
    expect(seating.seatByRegistrationId[world.bea.id]).toEqual({ tableNumber: 1, seatNumber: 2 });
    expect(seating.seatByRegistrationId[world.wes.id]).toBeUndefined();
  });

  it("is a staff-only feed entry and an audit row with the entry as it was and is", async () => {
    const world = await game();

    await world.td.put(`/api/registrations/${world.bea.id}`).send({ paymentConfirmed: false });

    expect(await corrections(world.tournament.id)).toEqual([{ description: "Bea's payment was taken back: not paid yet", data: { correction: "not_paid" } }]);
    expect(await feedOf(world.td, world.tournament.id)).toContain("Bea's payment was taken back: not paid yet");
    expect(await feedOf(await anon(), world.tournament.id)).not.toContain("Bea's payment was taken back: not paid yet");
    expect(await auditRows("registration.correct", world.bea.id)).toEqual([
      expect.objectContaining({
        actorUserId: world.staff.manager.user.id,
        targetType: "registration",
        data: {
          tournamentId: world.tournament.id,
          playerName: "Bea",
          change: "not_paid",
          before: { paymentConfirmed: true, paidBy: "cash", enteringHighHands: false },
          after: { paymentConfirmed: false, paidBy: null, enteringHighHands: false },
        },
      }),
    ]);
  });

  it.each([
    ["completed", "This tournament has finished, so a payment can no longer be taken back"],
    ["cancelled", "This tournament was cancelled, so a payment can no longer be taken back"],
  ])("is refused once the tournament is %s, saying why, and changes nothing", async (status, error) => {
    const world = await game({ status });

    const response = await world.td.put(`/api/registrations/${world.bea.id}`).send({ paymentConfirmed: false });

    expect([response.status, response.body]).toEqual([409, { error, code: "TOURNAMENT_CLOSED" }]);
    expect(await row(world.bea.id)).toMatchObject({ paymentConfirmed: true, paidBy: "cash" });
    expect(await corrections(world.tournament.id)).toEqual([]);
    expect(await auditRows("registration.correct", world.bea.id)).toEqual([]);
  });

  it("is for the club's staff only", async () => {
    const world = await game();

    const response = await world.staff.stranger.agent.put(`/api/registrations/${world.bea.id}`).send({ paymentConfirmed: false });

    expect(response.status).toBe(403);
    expect(await row(world.bea.id)).toMatchObject({ paymentConfirmed: true });
  });
});

describe("changing how a paid entry paid", () => {
  it("records the change as a correction, and the same answer again as nothing", async () => {
    const world = await game();

    const changed = await world.td.patch(`/api/registrations/${world.bea.id}/confirm-payment`).send({ paidBy: "transfer" });
    const again = await world.td.patch(`/api/registrations/${world.bea.id}/confirm-payment`).send({ paidBy: "transfer" });
    const recorded = await world.td.patch(`/api/registrations/${world.cy.id}/confirm-payment`).send({ paidBy: "cash" });

    expect([changed.status, again.status, recorded.status]).toEqual([200, 200, 200]);
    expect(changed.body).toMatchObject({ paymentConfirmed: true, paidBy: "transfer", seating: null });
    expect(await corrections(world.tournament.id)).toEqual([
      { description: "How Bea paid changed from cash to bank transfer", data: { correction: "paid_by" } },
      { description: "Cy's payment recorded as cash", data: { correction: "paid_by" } },
    ]);
    expect((await auditRows("registration.correct", world.bea.id)).map((entry) => entry.data)).toEqual([
      expect.objectContaining({ change: "paid_by", before: expect.objectContaining({ paidBy: "cash" }), after: expect.objectContaining({ paidBy: "transfer" }) }),
    ]);
    // The pool is the same: how it was paid is the club's bookkeeping.
    expect((await poolOf(world.td, world.tournament.id)).gross.total).toBe(15_000);
  });

  it("works after the game too, for the club's records", async () => {
    const world = await game({ status: "completed" });

    const response = await world.td.patch(`/api/registrations/${world.ann.id}/confirm-payment`).send({ paidBy: "transfer" });

    expect(response.status).toBe(200);
    expect(await row(world.ann.id)).toMatchObject({ paymentConfirmed: true, paidBy: "transfer" });
    expect((await corrections(world.tournament.id)).map((entry) => entry.description)).toEqual(["How Ann paid changed from cash to bank transfer"]);
  });
});

describe("ticking or unticking a paid entry's high hand", () => {
  it("is a correction each way, and moves the pot", async () => {
    const world = await game({ enableHighHand: true, highHandAmount: "10.00" });

    const ticked = await world.td.put(`/api/registrations/${world.ann.id}`).send({ enteringHighHands: true });
    const potWith = (await poolOf(world.td, world.tournament.id)).highHand.gross;
    const unticked = await world.td.put(`/api/registrations/${world.ann.id}`).send({ enteringHighHands: false });

    expect([ticked.status, unticked.status]).toEqual([200, 200]);
    expect(potWith).toBe(1_000);
    expect((await poolOf(world.td, world.tournament.id)).highHand.gross).toBe(0);
    expect(await corrections(world.tournament.id)).toEqual([
      { description: "Ann is now in the high hand", data: { correction: "high_hand" } },
      { description: "Ann is no longer in the high hand", data: { correction: "high_hand" } },
    ]);
    expect((await auditRows("registration.correct", world.ann.id)).map((entry) => entry.data)).toEqual([
      expect.objectContaining({ change: "high_hand", before: expect.objectContaining({ enteringHighHands: false }), after: expect.objectContaining({ enteringHighHands: true }) }),
      expect.objectContaining({ change: "high_hand", before: expect.objectContaining({ enteringHighHands: true }), after: expect.objectContaining({ enteringHighHands: false }) }),
    ]);
  });

  it("still keeps a locked pool's rule: nobody joins the high hand once it is locked", async () => {
    const world = await game({ enableHighHand: true, highHandAmount: "10.00", prizePoolLocked: true });

    const response = await world.td.put(`/api/registrations/${world.ann.id}`).send({ enteringHighHands: true });

    expect([response.status, response.body.code]).toEqual([409, "PRIZE_POOL_LOCKED"]);
    expect(await corrections(world.tournament.id)).toEqual([]);
  });
});

describe("editing a player's details from a tournament's Fix menu", () => {
  it("says in the tournament's staff feed which details were corrected, never what they now say, and names it in the audit row", async () => {
    const world = await game();
    const bea = await row(world.bea.id);

    const response = await world.td.put(`/api/players/${bea.playerId}`).send({ name: "Bea Rangi", phone: "021 555 0199", tournamentId: world.tournament.id });
    const unchanged = await world.td.put(`/api/players/${bea.playerId}`).send({ name: "Bea Rangi", tournamentId: world.tournament.id });

    expect([response.status, unchanged.status]).toEqual([200, 200]);
    expect(response.body).toMatchObject({ id: bea.playerId, name: "Bea Rangi", phone: "021 555 0199" });
    expect(await corrections(world.tournament.id)).toEqual([
      { description: "Bea Rangi's details were corrected (name and mobile number)", data: { correction: "player", fields: ["name", "phone"] } },
    ]);
    expect(await feedOf(await anon(), world.tournament.id)).not.toContain("Bea Rangi's details were corrected (name and mobile number)");
    expect((await auditRows("player.update", bea.playerId)).map((entry) => entry.data)).toEqual([
      { before: { name: "Bea", phone: "021 555 0110" }, after: { name: "Bea Rangi", phone: "021 555 0199" }, tournamentId: world.tournament.id },
    ]);
  });

  it("refuses a tournament the player has no entry in, or another club's, and changes nothing", async () => {
    const world = await game();
    const bea = await row(world.bea.id);
    const otherGame = await createTournament({ clubId: world.staff.club.id });
    const elsewhere = await createTournament({ clubId: (await createClub()).id });
    await createRegistration({ tournamentId: elsewhere.id, playerId: bea.playerId });

    const notEntered = await world.td.put(`/api/players/${bea.playerId}`).send({ name: "Bea Rangi", tournamentId: otherGame.id });
    const notTheirs = await world.td.put(`/api/players/${bea.playerId}`).send({ name: "Bea Rangi", tournamentId: elsewhere.id });

    expect([notEntered.status, notEntered.body.code]).toEqual([400, "INVALID_TARGET"]);
    expect(notTheirs.status).toBe(403);
    expect((await testDb().select().from(players).where(eq(players.id, bea.playerId)))[0]?.name).toBe("Bea");
    expect(await corrections(otherGame.id)).toEqual([]);
    expect(await corrections(elsewhere.id)).toEqual([]);
  });

  it("is still a plain edit without a tournament, which needs a change to make", async () => {
    const world = await game();
    const bea = await row(world.bea.id);

    expect((await world.td.put(`/api/players/${bea.playerId}`).send({ name: "Bea R" })).status).toBe(200);
    expect((await world.td.put(`/api/players/${bea.playerId}`).send({ tournamentId: world.tournament.id })).status).toBe(400);
    expect(await corrections(world.tournament.id)).toEqual([]);
  });
});
