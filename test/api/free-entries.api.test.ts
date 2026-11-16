/**
 * Free entries (round 7, item 6; the owner: "need the ability to give people a free roll into
 * tournaments"). Staff give a player a free entry from the desk, the phone or the Register player
 * sheet: it is ACCEPTED like a paid entry (payment_confirmed true, so Max players, the waiting list,
 * seating and finalize treat it as paid), with a reason, and nobody paid its buy-in. Staff can take it
 * back (a normal unpaid entry) or mark it paid. Every change is a staff-only activity entry and an
 * audit row. Nothing public can claim one, and no public response says who has one.
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { FinalizeResultDto } from "@shared/api/finalize";
import type { PublicPrizesDto } from "@shared/api/live-display";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import type { ActivityDto } from "@shared/api/public";
import type { ConfirmedRegistrationDto, FreeEntryChangedDto, ManagedRegistration, PendingRegistrationDto, RegistrationCreatedDto } from "@shared/api/registrations";
import { activityLog, auditLog, tournamentRegistrations } from "@shared/schema";
import { createPlayer, createRegistration, createTournament, createTournamentScenario, type NewTournament } from "../factories";
import { createTable } from "../factories/seating";
import { anon, resetDb, signIn, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";
import { signUpTokenFor } from "../helpers/sign-up";

beforeEach(resetDb);

/** The free-entry columns: none of them may reach anyone but the club's staff. */
const FREE_ENTRY_KEYS = ["freeEntry", "freeEntryFunded", "freeEntryReason", "freeEntryNote", "freeEntryBy", "freeEntryAt"];

/** A $100 game at a club, with Ann paid and Bob signed up but not paid yet. */
async function game(overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", buyInAmount: "100.00", maxPlayers: 10, ...overrides });
  const entry = async (name: string, paid: boolean, minute: number) =>
    createRegistration({
      tournamentId: tournament.id,
      playerId: (await createPlayer({ name })).id,
      paymentConfirmed: paid,
      registrationTime: new Date(Date.UTC(2026, 10, 16, 7, minute)),
    });
  const ann = await entry("Ann", true, 0);
  const bob = await entry("Bob", false, 1);
  return { staff, tournament, ann, bob, td: staff.manager.agent, owner: staff.owner.agent };
}

const row = async (id: string) => (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];

async function activityOf(tournamentId: string) {
  const rows = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp), asc(activityLog.id));
  return rows.map(({ eventType, description, eventData }) => ({ eventType, description, data: eventData ? (JSON.parse(eventData) as Record<string, unknown>) : null }));
}

const auditOf = (registrationId: string) =>
  testDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "registration.free_entry"), eq(auditLog.targetId, registrationId)))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

const giveFree = (agent: Awaited<ReturnType<typeof game>>["td"], registrationId: string, body: Record<string, unknown> = { action: "give", reason: "season_prize" }) =>
  agent.post(`/api/registrations/${registrationId}/free-entry`).send(body);

describe("giving a free entry", () => {
  it("accepts an unpaid sign-up without their buy-in: stored as accepted, with why, who and when, and answered for the staff", async () => {
    const world = await game();

    const response = await giveFree(world.td, world.bob.id, { action: "give", reason: "season_prize", note: "  Winter League winner  ", funded: true });

    expect(response.status).toBe(200);
    const body = response.body as FreeEntryChangedDto;
    expect(body).toMatchObject({
      id: world.bob.id,
      paymentConfirmed: true,
      freeEntry: true,
      freeEntryFunded: true,
      freeEntryReason: "season_prize",
      freeEntryNote: "Winter League winner",
      waitingListPosition: null,
      seating: null,
      highHandUnawardedCents: 0,
    });
    // Who gave it stays on the server.
    expect(body).not.toHaveProperty("freeEntryBy");
    expect(await row(world.bob.id)).toMatchObject({
      paymentConfirmed: true,
      freeEntry: true,
      freeEntryFunded: true,
      freeEntryReason: "season_prize",
      freeEntryNote: "Winter League winner",
      freeEntryBy: world.staff.manager.user.id,
    });
    expect((await row(world.bob.id)).freeEntryAt).toBeInstanceOf(Date);
  });

  it("is logged for the staff only, and audited with what it was before", async () => {
    const world = await game();

    await giveFree(world.td, world.bob.id, { action: "give", reason: "promo" });

    expect((await activityOf(world.tournament.id)).at(-1)).toEqual({
      eventType: "payment_confirmed",
      description: "Free entry for Bob (Promo: their buy-in is not in the prize pool)",
      data: { freeEntry: "given", funded: false },
    });
    const [audit] = await auditOf(world.bob.id);
    expect(audit).toMatchObject({
      actorUserId: world.staff.manager.user.id,
      targetType: "registration",
      data: {
        tournamentId: world.tournament.id,
        playerName: "Bob",
        change: "given",
        reason: "promo",
        note: null,
        funded: false,
        before: { freeEntry: false, funded: false, paymentConfirmed: false },
      },
    });
    const staffFeed = (await world.td.get(`/api/tournaments/${world.tournament.id}/activity`)).body as ActivityDto[];
    const publicFeed = (await (await anon()).get(`/api/tournaments/${world.tournament.id}/activity`)).body as ActivityDto[];
    expect(staffFeed.some((entry) => entry.description.startsWith("Free entry for Bob"))).toBe(true);
    expect(publicFeed.some((entry) => entry.description.includes("Free entry"))).toBe(false);
  });

  it("changes the reason or funding of a free entry, and changes nothing for the same free entry given again", async () => {
    const world = await game();
    await giveFree(world.td, world.bob.id, { action: "give", reason: "promo" });

    const again = await giveFree(world.td, world.bob.id, { action: "give", reason: "promo" });
    const changed = await giveFree(world.td, world.bob.id, { action: "give", reason: "staff", funded: true });

    expect(again.status).toBe(200);
    expect(changed.body).toMatchObject({ freeEntry: true, freeEntryReason: "staff", freeEntryFunded: true });
    expect((await auditOf(world.bob.id)).map((entry) => (entry.data as { change: string }).change)).toEqual(["given", "changed"]);
  });

  it("makes a paid entry free, taking its buy-in out of the pool", async () => {
    const world = await game();

    const response = await giveFree(world.td, world.ann.id, { action: "give", reason: "staff" });

    expect(response.status).toBe(200);
    expect(await row(world.ann.id)).toMatchObject({ paymentConfirmed: true, freeEntry: true });
    const [audit] = await auditOf(world.ann.id);
    expect(audit.data).toMatchObject({ change: "given", before: { freeEntry: false, paymentConfirmed: true } });
  });

  it("is refused past Max players, like any acceptance, for owners too (409 TOURNAMENT_FULL)", async () => {
    const world = await game({ maxPlayers: 1 });

    const response = await giveFree(world.owner, world.bob.id);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "1 of 1 players accepted: raise Max players to accept more", code: "TOURNAMENT_FULL" });
    expect(await row(world.bob.id)).toMatchObject({ paymentConfirmed: false, freeEntry: false });
  });

  it("is refused while a manual AP total would be more than the paid entries took in (400 AP_EXCEEDS_GROSS)", async () => {
    const world = await game({ rakeOverride: "100.00" });

    // Ann's $100 is all that came in: making her free leaves nothing for the $100 AP.
    const response = await giveFree(world.td, world.ann.id, { action: "give", reason: "staff" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("AP_EXCEEDS_GROSS");
    expect(await row(world.ann.id)).toMatchObject({ freeEntry: false });
  });

  it("seats the player as a payment would, under “once they've paid”", async () => {
    const world = await game({ autoSeat: "once_paid" });
    await createTable({ tournamentId: world.tournament.id, tableNumber: 1, seatCount: 9 });

    const response = await giveFree(world.td, world.bob.id);

    expect((response.body as FreeEntryChangedDto).seating).toMatchObject({ status: "seated", seat: { tableNumber: 1 } });
  });

  it("needs a reason the app knows, and staff of the club", async () => {
    const world = await game();

    const noReason = await giveFree(world.td, world.bob.id, { action: "give" });
    const unknown = await giveFree(world.td, world.bob.id, { action: "give", reason: "birthday" });
    const stranger = await giveFree(world.staff.stranger.agent, world.bob.id);

    expect(noReason.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(stranger.status).toBe(403);
    expect(await row(world.bob.id)).toMatchObject({ paymentConfirmed: false, freeEntry: false });
  });
});

describe("taking a free entry back, or marking it paid", () => {
  it("turns it back into a normal unpaid entry", async () => {
    const world = await game();
    await giveFree(world.td, world.bob.id, { action: "give", reason: "promo", note: "Flyer", funded: true });

    const response = await giveFree(world.td, world.bob.id, { action: "take_back" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ paymentConfirmed: false, freeEntry: false, freeEntryFunded: false, freeEntryReason: null, freeEntryNote: null });
    expect(await row(world.bob.id)).toMatchObject({ paymentConfirmed: false, freeEntry: false, freeEntryReason: null, freeEntryBy: null, freeEntryAt: null });
    expect((await activityOf(world.tournament.id)).at(-1)).toMatchObject({ eventType: "payment_confirmed", data: { freeEntry: "taken_back" } });
    expect((await auditOf(world.bob.id)).at(-1)?.data).toMatchObject({
      change: "taken_back",
      reason: "promo",
      note: "Flyer",
      funded: true,
      before: { freeEntry: true, funded: true, paymentConfirmed: true },
    });
  });

  it("marks it paid: still accepted, no longer free", async () => {
    const world = await game();
    await giveFree(world.td, world.bob.id);

    const response = await giveFree(world.td, world.bob.id, { action: "mark_paid" });

    expect(response.status).toBe(200);
    expect(await row(world.bob.id)).toMatchObject({ paymentConfirmed: true, freeEntry: false });
    expect((await activityOf(world.tournament.id)).at(-1)).toMatchObject({ description: "Payment confirmed for Bob: no longer a free entry", data: { freeEntry: "marked_paid" } });
  });

  it("is refused when the high-hand money its entry put in is already awarded (409 HIGH_HAND_OVER_POOL)", async () => {
    const world = await game({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 1 });
    await testDb().update(tournamentRegistrations).set({ enteringHighHands: true }).where(eq(tournamentRegistrations.tournamentId, world.tournament.id));
    expect((await giveFree(world.td, world.bob.id)).status).toBe(200);
    // Ann wins the whole pot: her $10 and Bob's, which his free entry put in (only the buy-in is free).
    const award = await world.td.put(`/api/registrations/${world.ann.id}`).send({ highHandWinner: true });
    expect(award.body.highHandAmount).toBe("20.00");

    const response = await giveFree(world.td, world.bob.id, { action: "take_back" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "The high-hand awards already made ($20) would be more than the $10 pot: take an award back first",
      code: "HIGH_HAND_OVER_POOL",
    });
    expect(await row(world.bob.id)).toMatchObject({ paymentConfirmed: true, freeEntry: true });
    expect(await auditOf(world.bob.id)).toHaveLength(1);
  });

  it("says when the entry has no free entry (409 NOT_FREE_ENTRY)", async () => {
    const world = await game();

    for (const action of ["take_back", "mark_paid"]) {
      const response = await giveFree(world.td, world.ann.id, { action });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "Ann does not have a free entry", code: "NOT_FREE_ENTRY" });
    }
  });

  it("is never undone by an edit that unticks the payment: that is the free entry's own Undo (409 FREE_ENTRY)", async () => {
    const world = await game();
    await giveFree(world.td, world.bob.id);

    const response = await world.td.put(`/api/registrations/${world.bob.id}`).send({ paymentConfirmed: false });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FREE_ENTRY");
    expect(await row(world.bob.id)).toMatchObject({ paymentConfirmed: true, freeEntry: true });
  });
});

describe("registering a player with a free entry", () => {
  it("lets the club's staff register a player straight in free", async () => {
    const world = await game();
    const cat = await createPlayer({ name: "Cat" });

    const response = await world.td.post(`/api/tournaments/${world.tournament.id}/registrations`).send({ playerId: cat.id, freeEntry: { reason: "other", note: "Birthday" } });

    expect(response.status).toBe(201);
    expect(response.body as RegistrationCreatedDto).toMatchObject({ paymentConfirmed: true, freeEntry: true, freeEntryReason: "other", freeEntryNote: "Birthday" });
    const created = (response.body as RegistrationCreatedDto).id;
    expect((await auditOf(created))[0]?.data).toMatchObject({ change: "given", before: { freeEntry: false, paymentConfirmed: false } });
    expect((await activityOf(world.tournament.id)).slice(-2).map((entry) => entry.eventType)).toEqual(["registration", "payment_confirmed"]);
  });

  it("refuses a free entry sent as unpaid: a free entry is accepted", async () => {
    const world = await game();
    const cat = await createPlayer({ name: "Cat" });

    const response = await world.td.post(`/api/tournaments/${world.tournament.id}/registrations`).send({ playerId: cat.id, paymentConfirmed: false, freeEntry: { reason: "promo" } });

    expect(response.status).toBe(400);
  });

  it("ignores a free entry a QR sign-up sends: nobody but staff can claim one", async () => {
    const world = await game();
    const cat = await createPlayer({ name: "Cat" });

    const response = await (await anon())
      .post(`/api/tournaments/${world.tournament.id}/registrations`)
      .send({ playerId: cat.id, signUpToken: signUpTokenFor(cat.id), freeEntry: { reason: "season_prize", funded: true }, paymentConfirmed: true });

    expect(response.status).toBe(201);
    expect(await row((response.body as RegistrationCreatedDto).id)).toMatchObject({ paymentConfirmed: false, freeEntry: false, freeEntryReason: null });
    expect(keysOf(response.body).filter((key) => FREE_ENTRY_KEYS.includes(key))).toEqual([]);
  });
});

describe("who is told about a free entry", () => {
  it("tells the club's staff, on every registration list and the desk", async () => {
    const world = await game();
    await giveFree(world.td, world.bob.id, { action: "give", reason: "season_prize", funded: true });

    const list = (await world.td.get(`/api/tournaments/${world.tournament.id}/registrations`)).body as ManagedRegistration[];
    const confirmed = (await world.td.get(`/api/tournaments/${world.tournament.id}/confirmed-registrations`)).body as ConfirmedRegistrationDto[];
    const pending = (await world.td.get(`/api/tournaments/${world.tournament.id}/pending-registrations`)).body as PendingRegistrationDto[];

    expect(list.find((entry) => entry.id === world.bob.id)).toMatchObject({ freeEntry: true, freeEntryFunded: true, freeEntryReason: "season_prize" });
    expect(list.find((entry) => entry.id === world.ann.id)).toMatchObject({ freeEntry: false, freeEntryFunded: false, freeEntryReason: null, freeEntryNote: null });
    // Accepted, so on the confirmed list: he paid nothing for his buy-in.
    expect(confirmed.find((entry) => entry.id === world.bob.id)).toMatchObject({ freeEntry: true, amountPaid: 0 });
    expect(pending).toEqual([]);
  });

  it("tells nobody else: the public lists, the prizes, the TV and the seats carry no free-entry key", async () => {
    const world = await game();
    await giveFree(world.td, world.bob.id, { action: "give", reason: "promo", note: "Flyer", funded: true });
    const visitor = await anon();
    const id = world.tournament.id;

    for (const path of [
      `/api/tournaments/${id}/registrations`,
      `/api/tournaments/${id}`,
      `/api/public/tournaments/${id}/prizes`,
      `/api/public/tournaments/${id}/display`,
      `/api/public/tournaments/${id}/seating`,
      `/api/public/tournaments/${id}/players?q=Bob`,
      `/api/tournaments/${id}/activity`,
    ]) {
      const response = await visitor.get(path);
      // Answered, so the check below reads a real body (a 404's would pass it by saying nothing).
      expect(response.status, path).toBe(200);
      expect(keysOf(response.body).filter((key) => FREE_ENTRY_KEYS.includes(key)), path).toEqual([]);
      expect(JSON.stringify(response.body), path).not.toContain("Flyer");
      expect(JSON.stringify(response.body), path).not.toMatch(/free entry/i);
    }
  });
});

describe("what a free entry brings to the prize pool", () => {
  it("brings nothing for its buy-in unless the club pays it in (in full, no AP taken); its re-buys are paid as normal", async () => {
    // $100 buy-ins and re-buys, $10 AP on each paid buy-in: Ann has paid, Bob comes in free.
    const world = await game({ rakeType: "fixed", rakeAmount: "10.00", rebuyAmount: "100.00" });
    const pool = async () => ((await world.td.get(`/api/tournaments/${world.tournament.id}/prize-pool`)).body as PrizePoolDto).breakdown;

    await giveFree(world.td, world.bob.id, { action: "give", reason: "promo" });
    const unfunded = await pool();
    expect(unfunded).toMatchObject({
      counts: { registrations: 2, buyIns: 2, freeEntries: 1, fundedFreeEntries: 0, freeBuyIns: 1, fundedBuyIns: 0 },
      gross: { buyIn: 10000, total: 10000 },
      rake: { applied: 1000 },
      freeEntries: { entries: 1, funded: 0, addedCents: 0 },
      netAfterAp: 9000,
    });

    // His re-buy is money he pays: in the gross, and on the desk's "paid" figure.
    expect((await world.td.post(`/api/registrations/${world.bob.id}/counts`).send({ rebuys: 1 })).status).toBe(200);
    await giveFree(world.td, world.bob.id, { action: "give", reason: "promo", funded: true });
    const funded = await pool();
    expect(funded).toMatchObject({
      gross: { buyIn: 10000, rebuy: 10000, total: 20000 },
      rake: { applied: 1000 },
      freeEntries: { entries: 1, funded: 1, addedCents: 10000 },
      netAfterAp: 29000,
    });
    const confirmed = (await world.td.get(`/api/tournaments/${world.tournament.id}/confirmed-registrations`)).body as ConfirmedRegistrationDto[];
    expect(confirmed.find((entry) => entry.id === world.bob.id)).toMatchObject({ freeEntry: true, freeEntryFunded: true, amountPaid: 100 });

    // The public page and the TV get the pool the payouts make, never what the club paid in or why.
    const visitor = await anon();
    const prizes = (await visitor.get(`/api/public/tournaments/${world.tournament.id}/prizes`)).body as PublicPrizesDto;
    expect(prizes.poolCents).toBe(funded.net);
    for (const path of [`/api/public/tournaments/${world.tournament.id}/prizes`, `/api/public/tournaments/${world.tournament.id}/display`]) {
      const body = (await visitor.get(path)).body as unknown;
      expect(keysOf(body).filter((key) => key === "freeEntries" || FREE_ENTRY_KEYS.includes(key)), path).toEqual([]);
    }
  });

  it("leaves the pool as it was once the free entry is taken back, or paid for", async () => {
    const world = await game();
    const pool = async () => ((await world.td.get(`/api/tournaments/${world.tournament.id}/prize-pool`)).body as PrizePoolDto).breakdown;

    await giveFree(world.td, world.bob.id, { action: "give", reason: "staff", funded: true });
    expect((await pool()).netAfterAp).toBe(20000);
    await giveFree(world.td, world.bob.id, { action: "mark_paid" });
    expect(await pool()).toMatchObject({ netAfterAp: 20000, gross: { total: 20000 }, freeEntries: { entries: 0, addedCents: 0 } });
    await giveFree(world.td, world.bob.id, { action: "give", reason: "staff" });
    await giveFree(world.td, world.bob.id, { action: "take_back" });
    expect(await pool()).toMatchObject({ netAfterAp: 10000, counts: { registrations: 1, freeEntries: 0 } });
  });
});

describe("a free entry at the end of the night", () => {
  /** Three players at $100 with season points: Ann and Bob paid and busted, Cat (unpaid) still in. */
  async function finalNight(rake?: { type: "fixed"; amount: string }) {
    const owner = await signIn();
    const scenario = await createTournamentScenario({
      players: 3,
      buyIn: "100.00",
      paid: [0, 1],
      eliminations: [0, 1],
      owner: owner.user,
      rake,
      points: { allocations: [{ position: 1, points: 100 }, { position: 2, points: 50 }, { position: 3, points: 25 }] },
      tournament: { status: "in_progress" },
    });
    const standings = async () =>
      (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, scenario.tournament.id)))
        .map((entry) => ({ player: scenario.players.findIndex((player) => player.id === entry.playerId), position: entry.finalPosition, prize: entry.prizeAmount, points: entry.pointsAwarded }))
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    return { scenario, agent: owner.agent, cat: scenario.registrations[2], standings };
  }

  it("is ranked, paid its prize and given its points like any entry, from a pool without its buy-in", async () => {
    const { scenario, agent, cat, standings } = await finalNight();
    expect((await giveFree(agent, cat.id, { action: "give", reason: "season_prize" })).status).toBe(200);

    const response = await agent.post(`/api/tournaments/${scenario.tournament.id}/finalize`);

    expect(response.status).toBe(200);
    // Ann's and Bob's $100 only: $200 at 50/30/20.
    expect(await standings()).toEqual([
      { player: 2, position: 1, prize: "100.00", points: 100 },
      { player: 1, position: 2, prize: "60.00", points: 50 },
      { player: 0, position: 3, prize: "40.00", points: 25 },
    ]);
    expect((response.body as FinalizeResultDto).snapshot.pool).toMatchObject({ grossCents: 20000, netCents: 20000, freeEntries: { entries: 1, funded: 0, addedCents: 0 } });
  });

  it("pays the funded buy-in into the prizes in full, with no AP taken from it, and keeps that off the public page", async () => {
    const { scenario, agent, cat, standings } = await finalNight({ type: "fixed", amount: "10.00" });
    await giveFree(agent, cat.id, { action: "give", reason: "promo", funded: true });

    const response = await agent.post(`/api/tournaments/${scenario.tournament.id}/finalize`);

    expect(response.status).toBe(200);
    // $200 paid less $20 AP, plus the club's $100 for Cat: $280 at 50/30/20.
    expect((await standings()).map(({ prize }) => prize)).toEqual(["140.00", "84.00", "56.00"]);
    expect((response.body as FinalizeResultDto).snapshot.pool).toMatchObject({
      grossCents: 20000,
      rakeCalculatedCents: 2000,
      netCents: 28000,
      freeEntries: { entries: 1, funded: 1, addedCents: 10000 },
    });
    const visitor = await anon();
    for (const path of [`/api/tournaments/${scenario.tournament.id}`, `/api/public/tournaments/${scenario.tournament.id}/prizes`, `/api/tournaments/${scenario.tournament.id}/registrations`]) {
      const answer = await visitor.get(path);
      expect(answer.status, path).toBe(200);
      expect(keysOf(answer.body).filter((key) => key === "freeEntries" || FREE_ENTRY_KEYS.includes(key)), path).toEqual([]);
    }
  });
});
