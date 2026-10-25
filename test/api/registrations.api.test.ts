/**
 * The registration API: the public list and QR sign-up (narrow body, business rules under the
 * tournament row lock: SEC-06, security-09, data-integrity-10), the staff's updates (SEC-01, money-25),
 * atomic count changes (MONEY-21, money-12), payment confirmation and the payment-desk lists (money-18).
 */
import { eq } from "drizzle-orm";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import { HIGH_HAND_PRIZES_MAX } from "@shared/domain/prize-pool";
import { activityLog, auditLog, pendingActions, tournamentClocks, tournamentRegistrations, tournaments, type Player, type Tournament } from "@shared/schema";
import {
  createClub,
  createPlayer,
  createRegistration,
  createTournament,
  createUser,
  FACTORY_PASSWORD,
  type NewRegistration,
  type NewTournament,
} from "../factories";
import { createClock, MINUTE_MS } from "../factories/clock";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { issueSignUpToken, SIGN_UP_TOKEN_TTL_MS } from "../../server/services/sign-up-tokens";
import { anon, asJson, getApp, loginAs, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { CLUB_ROLES, signInClubRole, signInDeactivatedManager, STAFF_ROLES } from "../helpers/club-staff";
import { signUpTokenFor } from "../helpers/sign-up";

beforeEach(resetDb);

/** A tournament in a club owned by a signed-in user, who can manage it. */
async function ownedTournament(overrides: Partial<NewTournament> = {}) {
  const owner = await createUser();
  const club = await createClub({ ownerId: owner.id });
  const tournament = await createTournament({ clubId: club.id, ...overrides });
  const { agent } = await loginAs({ email: owner.email });
  return { club, tournament, agent };
}

/** `name` registered for `tournamentId` with the given registration columns. */
async function registered(tournamentId: string, name: string, overrides: Partial<NewRegistration> = {}) {
  const player = await createPlayer({ name });
  const registration = await createRegistration({ tournamentId, playerId: player.id, ...overrides });
  return { player, registration };
}

const registrationRow = async (id: string) =>
  (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];

const registrationsOf = (tournamentId: string) =>
  testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournamentId));

const activityFor = async (tournamentId: string) =>
  (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)))
    .sort((a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp)) || a.id.localeCompare(b.id))
    .map(({ eventType, description, playerId, eventData }) => ({ eventType, description, playerId, eventData }));

const logEntry = (eventType: string, description: string, player: Player, eventData: string | null = null) => ({
  eventType,
  description,
  playerId: player.id,
  eventData,
});

const publicPlayer = (player: Player) => ({ id: player.id, name: player.name, imageUrl: player.imageUrl });

/**
 * A registration as the club's staff get it (ManagedRegistration): the row with the player reduced to
 * PublicPlayer. Everyone else gets `asPublic` of it, without whether it has paid (P2REV0-SEC-04).
 */
const withPlayer = (registration: object, player: Player) => ({ ...(asJson(registration) as object), player: publicPlayer(player) });
const asPublic = ({ paymentConfirmed: _paid, ...rest }: Record<string, unknown>) => rest;

/** The QR page's sign-up of a player whose details the visitor typed in: it carries their sign-up token, unless `body` sets one. */
const vouched = (body: Record<string, unknown>) =>
  "signUpToken" in body || typeof body.playerId !== "string" ? body : { ...body, signUpToken: signUpTokenFor(body.playerId) };

const signUp = async (tournament: Pick<Tournament, "id">, body: Record<string, unknown>) =>
  (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send(vouched(body));

describe("POST /api/tournaments/:id/registrations", () => {
  it("registers a player anonymously with the column defaults, logs it, and answers without contact details", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const player = await createPlayer({ name: "Alice", phone: "021 555 0101", email: "alice@example.test" });

    const response = await signUp(tournament, { playerId: player.id });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      tournamentId: tournament.id,
      playerId: player.id,
      registrationTime: expect.any(String),
      buyIns: 1,
      rebuys: 0,
      addons: 0,
      finalPosition: null,
      prizeAmount: null,
      pointsAwarded: null,
      isEliminated: false,
      eliminationTime: null,
      eliminatedBy: null,
      knockouts: 0,
      enteringHighHands: false,
      highHandWinner: false,
      highHandAmount: null,
      earlyBird: false,
      player: publicPlayer(player),
    });
    expect(findForbiddenKeys(response.body)).toEqual([]);
    expect(await activityFor(tournament.id)).toEqual([logEntry("registration", "Alice registered for the tournament", player)]);
  });

  it("records a high-hand entry when the tournament offers one, and refuses one it does not (400 HIGH_HAND_NOT_AVAILABLE)", async () => {
    const offered = await createTournament({ clubId: (await createClub()).id, enableHighHand: true, highHandAmount: "20.00" });
    const notOffered = await createTournament({ clubId: offered.clubId, enableHighHand: false });
    const player = await createPlayer();

    const yes = await signUp(offered, { playerId: player.id, enteringHighHands: true });
    const no = await signUp(notOffered, { playerId: player.id, enteringHighHands: true });

    expect(yes.status).toBe(201);
    expect(yes.body.enteringHighHands).toBe(true);
    expect(no.status).toBe(400);
    expect(no.body).toEqual({ error: "High hands entry is not available for this tournament", code: "HIGH_HAND_NOT_AVAILABLE" });
    expect(await registrationsOf(notOffered.id)).toEqual([]);
  });

  it("refuses a high-hand entry for a high hand switched on with no price, which no screen offers (P3REV3-CQ-03)", async () => {
    const club = await createClub();
    const unpriced = await createTournament({ clubId: club.id, enableHighHand: true, highHandAmount: null });
    const free = await createTournament({ clubId: club.id, enableHighHand: true, highHandAmount: "0.00" });
    const player = await createPlayer();

    for (const tournament of [unpriced, free]) {
      const response = await signUp(tournament, { playerId: player.id, enteringHighHands: true });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "HIGH_HAND_NOT_AVAILABLE" });
    }
  });

  it("never stores payment, money, counts or results sent by an anonymous sign-up (SEC-06 / security-09)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const player = await createPlayer();

    const response = await signUp(tournament, {
      playerId: player.id,
      paymentConfirmed: true,
      buyIns: 0,
      rebuys: 5,
      prizeAmount: "500",
      pointsAwarded: 999,
      finalPosition: 1,
      highHandWinner: true,
      tournamentId: UNKNOWN_ID,
    });

    expect(response.status).toBe(201);
    expect(await registrationRow(response.body.id)).toMatchObject({
      tournamentId: tournament.id,
      paymentConfirmed: false,
      buyIns: 1,
      rebuys: 0,
      prizeAmount: null,
      pointsAwarded: null,
      finalPosition: null,
      highHandWinner: false,
    });
  });

  it("lets the club's staff set the opening counts and payment", async () => {
    const { tournament, agent } = await ownedTournament({ rebuyAmount: "50.00", addonAmount: "50.00" });
    const player = await createPlayer();

    const response = await agent
      .post(`/api/tournaments/${tournament.id}/registrations`)
      .send({ playerId: player.id, buyIns: 2, rebuys: 1, addons: 1, paymentConfirmed: true });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ buyIns: 2, rebuys: 1, addons: 1, paymentConfirmed: true });
  });

  it("does not give staff powers to a signed-in user who does not manage the club", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, maxPlayers: 1 });
    await registered(tournament.id, "Alice");
    const { agent } = await signIn();

    const full = await agent.post(`/api/tournaments/${tournament.id}/registrations`).send(vouched({ playerId: (await createPlayer()).id }));

    expect(full.status).toBe(409);
    expect(full.body.code).toBe("TOURNAMENT_FULL");
  });

  it("answers 404 for an unknown tournament or player", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const player = await createPlayer();

    const noTournament = await signUp({ id: UNKNOWN_ID }, { playerId: player.id });
    const noPlayer = await signUp(tournament, { playerId: UNKNOWN_ID });

    expect(noTournament.status).toBe(404);
    expect(noTournament.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
    expect(noPlayer.status).toBe(404);
    expect(noPlayer.body).toEqual({ error: "Player not found", code: "PLAYER_NOT_FOUND" });
  });

  it("answers 409 PRIZE_POOL_LOCKED once the prize pool is locked, for staff too", async () => {
    const { tournament, agent } = await ownedTournament({ prizePoolLocked: true });

    const anonymous = await signUp(tournament, { playerId: (await createPlayer()).id });
    const staff = await agent.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: (await createPlayer()).id });

    for (const response of [anonymous, staff]) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "Prize pool is locked. No new registrations allowed.", code: "PRIZE_POOL_LOCKED" });
    }
    expect(await registrationsOf(tournament.id)).toEqual([]);
  });

  it("answers 409 ALREADY_REGISTERED when the player is already registered", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const { player } = await registered(tournament.id, "Alice");

    const response = await signUp(tournament, { playerId: player.id });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Player is already registered for this tournament", code: "ALREADY_REGISTERED" });
    expect(await registrationsOf(tournament.id)).toHaveLength(1);
  });

  it("refuses a sign-up once maxPlayers is reached (409 TOURNAMENT_FULL), but lets staff seat an extra player", async () => {
    const { tournament, agent } = await ownedTournament({ maxPlayers: 2 });
    await registered(tournament.id, "Alice");
    await registered(tournament.id, "Bob", { paymentConfirmed: true });

    const anonymous = await signUp(tournament, { playerId: (await createPlayer()).id });
    const staff = await agent.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: (await createPlayer()).id });

    expect(anonymous.status).toBe(409);
    expect(anonymous.body.code).toBe("TOURNAMENT_FULL");
    expect(staff.status).toBe(201);
    expect(await registrationsOf(tournament.id)).toHaveLength(3);
  });

  it.each(["completed", "cancelled"])("refuses any registration for a %s tournament (409 TOURNAMENT_CLOSED)", async (status) => {
    const { tournament, agent } = await ownedTournament({ status });

    const anonymous = await signUp(tournament, { playerId: (await createPlayer()).id });
    const staff = await agent.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: (await createPlayer()).id });

    for (const response of [anonymous, staff]) {
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("TOURNAMENT_CLOSED");
    }
    expect(await registrationsOf(tournament.id)).toEqual([]);
  });

  it("keeps self-registration open once the tournament is in progress, as it always has been (TN-03)", async () => {
    // enableLateRegistration defaults to false on every tournament and no screen can change it, so it
    // is not enforced until the Phase 4 clock knows when late registration ends.
    const { tournament: started, agent } = await ownedTournament({ status: "in_progress", enableLateRegistration: false });
    const scheduled = await createTournament({ clubId: started.clubId, status: "scheduled" });

    const lateArrival = await signUp(started, { playerId: (await createPlayer()).id });
    const byStaff = await agent.post(`/api/tournaments/${started.id}/registrations`).send({ playerId: (await createPlayer()).id });
    const early = await signUp(scheduled, { playerId: (await createPlayer()).id });

    expect([lateArrival.status, byStaff.status, early.status]).toEqual([201, 201, 201]);
  });

  it("answers 400 with the zod issues when playerId is missing", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });

    const response = await signUp(tournament, {});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid registration data", code: "VALIDATION", details: [{ path: ["playerId"] }] });
  });

  it("refuses staff opening re-buys beyond maxRebuys (409 MAX_REBUYS_REACHED)", async () => {
    const { tournament, agent } = await ownedTournament({ maxRebuys: 1, rebuyAmount: "50.00" });

    const response = await agent.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: (await createPlayer()).id, rebuys: 2 });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("MAX_REBUYS_REACHED");
  });

  it("registers a player once when their sign-up arrives several times at once (data-integrity-10)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const player = await createPlayer();
    const app = await anon();

    const responses = await Promise.all(
      [1, 2, 3].map(() => app.post(`/api/tournaments/${tournament.id}/registrations`).send(vouched({ playerId: player.id }))),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await registrationsOf(tournament.id)).toHaveLength(1);
  });

  it("never seats more than maxPlayers when the last seats are taken at once", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, maxPlayers: 2 });
    const entrants = await Promise.all([1, 2, 3, 4].map(() => createPlayer()));
    const app = await anon();

    const responses = await Promise.all(
      entrants.map((player) => app.post(`/api/tournaments/${tournament.id}/registrations`).send(vouched({ playerId: player.id }))),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([201, 201, 409, 409]);
    expect(await registrationsOf(tournament.id)).toHaveLength(2);
  });
});

describe("GET /api/tournaments/:id/registrations", () => {
  it("returns each registration in sign-up order with the player's public fields only (SEC-09)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const linked = await createUser();
    const bob = await registered(tournament.id, "Bob", { rebuys: 2, registrationTime: new Date("2026-03-01T18:10:00Z") });
    const alice = await registered(tournament.id, "Alice", { paymentConfirmed: true, registrationTime: new Date("2026-03-01T18:00:00Z") });
    const withPii = await createPlayer({ name: "Carol", phone: "021 555 0101", email: "carol@example.test", userId: linked.id });
    const carol = await createRegistration({ tournamentId: tournament.id, playerId: withPii.id, registrationTime: new Date("2026-03-01T18:20:00Z") });
    await registered((await createTournament({ clubId: tournament.clubId })).id, "Elsewhere");

    const response = await (await anon()).get(`/api/tournaments/${tournament.id}/registrations`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      asPublic(withPlayer(alice.registration, alice.player)),
      asPublic(withPlayer(bob.registration, bob.player)),
      asPublic(withPlayer(carol, withPii)),
    ]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("says whether each entry has paid only to someone who runs the club: payment is staff bookkeeping (P2REV0-SEC-04)", async () => {
    const { club, tournament, agent: owner } = await ownedTournament();
    const paid = await registered(tournament.id, "Paid", { paymentConfirmed: true, registrationTime: new Date("2026-03-01T18:00:00Z") });
    const unpaid = await registered(tournament.id, "Unpaid", { registrationTime: new Date("2026-03-01T18:10:00Z") });
    const stranger = await signIn();
    const manager = await signInClubRole("manager", club.id);
    const paidFlags = (body: Array<Record<string, unknown>>) => body.map((row) => row.paymentConfirmed);

    const anonymous = await (await anon()).get(`/api/tournaments/${tournament.id}/registrations`);
    const byStranger = await stranger.agent.get(`/api/tournaments/${tournament.id}/registrations`);

    for (const response of [anonymous, byStranger]) {
      expect(response.status).toBe(200);
      for (const row of response.body as object[]) expect(row).not.toHaveProperty("paymentConfirmed");
    }
    expect(paidFlags((await owner.get(`/api/tournaments/${tournament.id}/registrations`)).body)).toEqual([true, false]);
    expect((await manager.agent.get(`/api/tournaments/${tournament.id}/registrations`)).body).toEqual([
      withPlayer(paid.registration, paid.player),
      withPlayer(unpaid.registration, unpaid.player),
    ]);
  });

  it("never tells an anonymous QR sign-up whether the entry it made has paid", async () => {
    const { tournament } = await ownedTournament({ status: "registration" });
    const player = await createPlayer({ name: "Walk-in" });

    const response = await signUp(tournament, { playerId: player.id });

    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty("paymentConfirmed");
  });

  it("returns an empty list for an unknown tournament", async () => {
    const response = await (await anon()).get(`/api/tournaments/${UNKNOWN_ID}/registrations`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("PUT /api/registrations/:id", () => {
  describe("who may change a registration (SEC-01)", () => {
    it("refuses anonymous visitors and deactivated accounts, and leaves the registration alone", async () => {
      const { club, tournament } = await ownedTournament();
      const { registration } = await registered(tournament.id, "Alice");
      const deactivated = await signInDeactivatedManager(club.id);

      const anonymous = await (await anon()).put(`/api/registrations/${registration.id}`).send({ isEliminated: true });
      const disabled = await deactivated.agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true });

      expect([anonymous.status, disabled.status]).toEqual([401, 401]);
      expect(await registrationRow(registration.id)).toEqual(registration);
    });

    it.each(CLUB_ROLES)("as the club's %s", async (role) => {
      const { club, tournament } = await ownedTournament();
      const { registration } = await registered(tournament.id, "Alice");
      const { agent } = await signInClubRole(role, club.id);

      const response = await agent.put(`/api/registrations/${registration.id}`).send({ knockouts: 2 });

      expect(response.status).toBe(STAFF_ROLES.includes(role) ? 200 : 403);
      expect((await registrationRow(registration.id)).knockouts).toBe(STAFF_ROLES.includes(role) ? 2 : 0);
    });

    it("answers 404 for an unknown registration", async () => {
      const { agent } = await signIn({ role: "admin" });

      const response = await agent.put(`/api/registrations/${UNKNOWN_ID}`).send({ rebuys: 1 });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Registration not found", code: "NOT_FOUND" });
    });
  });

  it("eliminates a player at the server's time (a sent time is ignored) and logs it", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player, registration } = await registered(tournament.id, "Alice");
    const before = Date.now();

    const response = await agent
      .put(`/api/registrations/${registration.id}`)
      .send({ isEliminated: true, eliminationTime: "2000-01-01T00:00:00.000Z" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...withPlayer(registration, player),
      isEliminated: true,
      eliminationTime: expect.any(String),
    });
    expect(Date.parse(response.body.eliminationTime)).toBeGreaterThanOrEqual(before - 1000);
    expect(await activityFor(tournament.id)).toEqual([logEntry("elimination", "Alice was eliminated", player)]);
  });

  it("credits the knockout to the eliminator and names them in the log", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player: alice, registration } = await registered(tournament.id, "Alice");
    const { player: bob, registration: bobRegistration } = await registered(tournament.id, "Bob", { knockouts: 1 });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true, eliminatedBy: bob.id });

    expect(response.status).toBe(200);
    expect(response.body.eliminatedBy).toBe(bob.id);
    expect((await registrationRow(bobRegistration.id)).knockouts).toBe(2);
    expect(await activityFor(tournament.id)).toEqual([
      logEntry("elimination", "Alice was eliminated by Bob", alice, JSON.stringify({ eliminatedBy: bob.id })),
    ]);
  });

  it("refuses an eliminator who is not another active player of this tournament (400 INVALID_TARGET)", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player: alice, registration } = await registered(tournament.id, "Alice");
    const { player: out } = await registered(tournament.id, "Out", { isEliminated: true });
    const { player: elsewhere } = await registered((await createTournament({ clubId: tournament.clubId })).id, "Elsewhere");
    const unregistered = await createPlayer();

    for (const eliminatedBy of [alice.id, out.id, elsewhere.id, unregistered.id, UNKNOWN_ID]) {
      const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true, eliminatedBy });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_TARGET");
    }
    expect(await registrationRow(registration.id)).toEqual(registration);
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("refuses eliminatedBy without an elimination", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");
    const { player: bob } = await registered(tournament.id, "Bob");

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ eliminatedBy: bob.id });

    expect(response.status).toBe(400);
    expect(await registrationRow(registration.id)).toEqual(registration);
  });

  it("answers 409 ALREADY_ELIMINATED for a player who is already out, without logging", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice", { isEliminated: true, eliminationTime: new Date("2026-03-01T20:15:00Z") });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ALREADY_ELIMINATED");
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("restores a player, clearing eliminatedBy and taking the knockout back off the eliminator (money-25)", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player: bob, registration: bobRegistration } = await registered(tournament.id, "Bob", { knockouts: 1 });
    const { player: alice, registration } = await registered(tournament.id, "Alice", {
      isEliminated: true,
      eliminationTime: new Date("2026-03-01T20:15:00Z"),
      eliminatedBy: bob.id,
    });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: false, eliminationTime: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ isEliminated: false, eliminationTime: null, eliminatedBy: null });
    expect((await registrationRow(bobRegistration.id)).knockouts).toBe(0);
    expect(await activityFor(tournament.id)).toEqual([logEntry("player_restored", "Alice was restored to active", alice)]);
  });

  it("eliminate, restore, eliminate again leaves the eliminator with one knockout, never below zero", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player: bob, registration: bobRegistration } = await registered(tournament.id, "Bob");
    const { registration } = await registered(tournament.id, "Alice");
    const { registration: carol } = await registered(tournament.id, "Carol", { isEliminated: true, eliminatedBy: bob.id });

    await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true, eliminatedBy: bob.id });
    await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: false });
    await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true, eliminatedBy: bob.id });
    expect((await registrationRow(bobRegistration.id)).knockouts).toBe(1);

    await agent.put(`/api/registrations/${bobRegistration.id}`).send({ knockouts: 0 });
    await agent.put(`/api/registrations/${carol.id}`).send({ isEliminated: false });
    expect((await registrationRow(bobRegistration.id)).knockouts).toBe(0);
  });

  it("answers 409 NOT_ELIMINATED when restoring a player who is still in", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: false });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("NOT_ELIMINATED");
  });

  it("logs re-buys and add-ons by how many were added, with plurals", async () => {
    const { tournament, agent } = await ownedTournament({ rebuyAmount: "50.00", addonAmount: "50.00" });
    const { player: alice, registration: aliceRegistration } = await registered(tournament.id, "Alice");
    const { player: bob, registration: bobRegistration } = await registered(tournament.id, "Bob", { rebuys: 1, addons: 1 });

    await agent.put(`/api/registrations/${aliceRegistration.id}`).send({ rebuys: 1, addons: 1 });
    await agent.put(`/api/registrations/${bobRegistration.id}`).send({ rebuys: 3, addons: 3 });

    const logs = await activityFor(tournament.id);
    expect(logs).toHaveLength(4);
    expect(logs).toEqual(
      expect.arrayContaining([
        logEntry("rebuy", "Alice made 1 re-buy", alice),
        logEntry("addon", "Alice purchased 1 add-on", alice),
        logEntry("rebuy", "Bob made 2 re-buys", bob),
        logEntry("addon", "Bob purchased 2 add-ons", bob),
      ]),
    );
    expect(await registrationRow(bobRegistration.id)).toMatchObject({ rebuys: 3, addons: 3 });
  });

  it("stores a lower count, or a knockout count as sent, without logging", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice", { rebuys: 2, addons: 1, knockouts: 1 });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ rebuys: 1, addons: 0, knockouts: 2 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ rebuys: 1, addons: 0, knockouts: 2 });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("refuses re-buys beyond maxRebuys (409 MAX_REBUYS_REACHED)", async () => {
    const { tournament, agent } = await ownedTournament({ maxRebuys: 2, rebuyAmount: "50.00" });
    const { registration } = await registered(tournament.id, "Alice", { rebuys: 1 });

    const allowed = await agent.put(`/api/registrations/${registration.id}`).send({ rebuys: 2 });
    const refused = await agent.put(`/api/registrations/${registration.id}`).send({ rebuys: 3 });

    expect(allowed.status).toBe(200);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: "This tournament allows at most 2 re-buys per player", code: "MAX_REBUYS_REACHED" });
    expect((await registrationRow(registration.id)).rebuys).toBe(2);
  });

  it("logs a high-hand win with the award the server works out, and only the first time", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "20.00", highHandPayouts: 1 });
    const { player, registration } = await registered(tournament.id, "Alice", { enteringHighHands: true });
    await registered(tournament.id, "Bob", { enteringHighHands: true });

    // The client's figure is never taken: the pot is 2 × $20.
    const response = await agent.put(`/api/registrations/${registration.id}`).send({ highHandWinner: true, highHandAmount: 150 });
    const again = await agent.put(`/api/registrations/${registration.id}`).send({ highHandWinner: true });

    expect(response.body).toMatchObject({ highHandWinner: true, highHandAmount: "40.00" });
    expect(again.status).toBe(200);
    expect(await activityFor(tournament.id)).toEqual([
      logEntry("high_hand", "Alice won high hand ($40)", player, JSON.stringify({ amount: "40.00" })),
    ]);
  });

  it("logs a high-hand win without an amount when the pot is empty, and refuses a malformed amount", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true });
    const { player, registration } = await registered(tournament.id, "Alice");

    const malformed = await agent.put(`/api/registrations/${registration.id}`).send({ highHandWinner: true, highHandAmount: "lots" });
    await agent.put(`/api/registrations/${registration.id}`).send({ highHandWinner: true });

    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ error: "Invalid registration data", details: [{ path: ["highHandAmount"] }] });
    expect(await activityFor(tournament.id)).toEqual([logEntry("high_hand", "Alice won high hand", player)]);
    expect((await registrationRow(registration.id)).highHandAmount).toBe("0.00");
  });

  describe("high-hand awards add up to the high-hand pot (MONEY-36)", () => {
    it("splits the pot over the winners, the last taking the odd cents, and refuses one winner too many", async () => {
      const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "3.33", highHandPayouts: 2 });
      const entrants = await Promise.all(["Ann", "Bea", "Cy"].map((name) => registered(tournament.id, name, { enteringHighHands: true })));
      const award = (index: number) => agent.put(`/api/registrations/${entrants[index].registration.id}`).send({ highHandWinner: true });

      const first = await award(0);
      const second = await award(1);
      const third = await award(2);

      expect([first.body.highHandAmount, second.body.highHandAmount]).toEqual(["4.99", "5.00"]);
      expect([third.status, third.body.code]).toEqual([409, "HIGH_HAND_AWARDED"]);
      expect((await registrationRow(entrants[2].registration.id)).highHandWinner).toBe(false);
    });

    it("gives the last winner what is left when the pot grew between awards", async () => {
      const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 2 });
      const ann = await registered(tournament.id, "Ann", { enteringHighHands: true });
      const bea = await registered(tournament.id, "Bea", { enteringHighHands: true });

      const first = await agent.put(`/api/registrations/${ann.registration.id}`).send({ highHandWinner: true });
      await registered(tournament.id, "Cy", { enteringHighHands: true });
      const second = await agent.put(`/api/registrations/${bea.registration.id}`).send({ highHandWinner: true });

      expect([first.body.highHandAmount, second.body.highHandAmount]).toEqual(["10.00", "20.00"]);
    });

    it("clears the amount of an award taken back, and holds a hand-set amount to the pot like any change to it (P2REV4-CQ2-01)", async () => {
      const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 2 });
      const ann = await registered(tournament.id, "Ann", { enteringHighHands: true });
      const bea = await registered(tournament.id, "Bea", { enteringHighHands: true });
      const annPath = `/api/registrations/${ann.registration.id}`;
      expect((await agent.put(annPath).send({ highHandWinner: true })).body.highHandAmount).toBe("10.00");

      // One prize still to come: a hand-set amount may be anything up to the pot.
      const tooMuch = await agent.put(annPath).send({ highHandAmount: "20.01" });
      const fine = await agent.put(annPath).send({ highHandAmount: "12.00" });
      expect([tooMuch.status, tooMuch.body]).toEqual([
        409,
        { error: "The high-hand awards already made ($20.01) would be more than the $20 pot: take an award back first", code: "HIGH_HAND_OVER_POOL" },
      ]);
      expect(fine.body.highHandAmount).toBe("12.00");

      // Every prize awarded: the awards must add up to the pot, so no money is left that nobody can win.
      expect((await agent.put(`/api/registrations/${bea.registration.id}`).send({ highHandWinner: true })).body.highHandAmount).toBe("8.00");
      const leavesMoney = await agent.put(annPath).send({ highHandAmount: "11.00" });
      expect([leavesMoney.status, leavesMoney.body]).toEqual([
        409,
        {
          error: "Every high-hand prize has been awarded, so the awards ($19) must add up to the $20 pot: take an award back first",
          code: "HIGH_HAND_AWARDED",
        },
      ]);
      expect((await registrationRow(ann.registration.id)).highHandAmount).toBe("12.00");

      const takenBack = await agent.put(annPath).send({ highHandWinner: false });
      expect(takenBack.body).toMatchObject({ highHandWinner: false, highHandAmount: null });
    });
  });

  it("never writes finalize's results, another tournament or another player, and refuses an empty update", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");
    const other = await createTournament({ clubId: tournament.clubId });

    const sneaky = await agent.put(`/api/registrations/${registration.id}`).send({
      finalPosition: 1,
      prizeAmount: "500",
      pointsAwarded: 999,
      tournamentId: other.id,
      playerId: UNKNOWN_ID,
      knockouts: 1,
    });
    const empty = await agent.put(`/api/registrations/${registration.id}`).send({ finalPosition: 1 });

    expect(sneaky.status).toBe(200);
    expect(await registrationRow(registration.id)).toEqual({ ...registration, knockouts: 1 });
    expect(empty.status).toBe(400);
  });

  describe("while the prize pool is locked", () => {
    const lockedError = { error: "Prize pool is locked. No rebuys, addons, or high hand entries allowed.", code: "PRIZE_POOL_LOCKED" };

    it.each([
      ["a re-buy", { rebuys: 1 }],
      ["an add-on", { addons: 1 }],
      ["another buy-in", { buyIns: 2 }],
      ["a high-hand entry", { enteringHighHands: true }],
    ])("answers 409 to %s and leaves the registration alone", async (_label, change) => {
      const { tournament, agent } = await ownedTournament({ prizePoolLocked: true, enableHighHand: true });
      const { registration } = await registered(tournament.id, "Alice");

      const response = await agent.put(`/api/registrations/${registration.id}`).send(change);

      expect(response.status).toBe(409);
      expect(response.body).toEqual(lockedError);
      expect(await registrationRow(registration.id)).toEqual(registration);
      expect(await activityFor(tournament.id)).toEqual([]);
    });

    it("still allows eliminations, knockouts and lowering a count", async () => {
      const { tournament, agent } = await ownedTournament({ prizePoolLocked: true });
      const { player, registration } = await registered(tournament.id, "Alice", { rebuys: 2 });
      const { registration: bobRegistration } = await registered(tournament.id, "Bob");

      const eliminated = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true, rebuys: 1 });
      const knockout = await agent.put(`/api/registrations/${bobRegistration.id}`).send({ knockouts: 1 });

      expect(eliminated.status).toBe(200);
      expect(eliminated.body).toMatchObject({ isEliminated: true, rebuys: 1 });
      expect(knockout.body.knockouts).toBe(1);
      expect(await activityFor(tournament.id)).toEqual([logEntry("elimination", "Alice was eliminated", player)]);
    });
  });

  it.each(["completed", "cancelled"])(
    "on a %s tournament, takes a payment fix sent with the row's stored elimination, which is not a change (P2REV4-CQ2-08)",
    async (status) => {
      const { tournament, agent } = await ownedTournament({ status });
      const { player: winner, registration: first } = await registered(tournament.id, "Wendy", { finalPosition: 1 });
      const { registration: busted } = await registered(tournament.id, "Bert", {
        finalPosition: 2,
        isEliminated: true,
        eliminationTime: new Date("2026-03-01T21:00:00Z"),
        eliminatedBy: winner.id,
      });

      const paidOut = await agent.put(`/api/registrations/${busted.id}`).send({ isEliminated: true, eliminatedBy: winner.id, paymentConfirmed: true });
      const paidWinner = await agent.put(`/api/registrations/${first.id}`).send({ isEliminated: false, paymentConfirmed: true });

      expect([paidOut.status, paidWinner.status]).toEqual([200, 200]);
      expect(await registrationRow(busted.id)).toEqual({ ...busted, paymentConfirmed: true });
      expect(await registrationRow(first.id)).toEqual({ ...first, paymentConfirmed: true });
      expect(await activityFor(tournament.id)).toEqual([]);
    },
  );

  it("ignores a resent unchanged elimination beside other changes, but still answers a repeated Eliminate or a new eliminator (P2REV4-CQ2-08)", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player: bob } = await registered(tournament.id, "Bob");
    const { player: carol } = await registered(tournament.id, "Carol");
    const { registration } = await registered(tournament.id, "Alice", {
      isEliminated: true,
      eliminationTime: new Date("2026-03-01T20:15:00Z"),
      eliminatedBy: bob.id,
    });
    const path = `/api/registrations/${registration.id}`;

    const resent = await agent.put(path).send({ isEliminated: true, eliminatedBy: bob.id, paymentConfirmed: true });
    const repeated = await agent.put(path).send({ isEliminated: true, eliminatedBy: bob.id });
    const otherEliminator = await agent.put(path).send({ isEliminated: true, eliminatedBy: carol.id, paymentConfirmed: false });

    expect(resent.status).toBe(200);
    expect([repeated.status, repeated.body.code]).toEqual([409, "ALREADY_ELIMINATED"]);
    expect([otherEliminator.status, otherEliminator.body.code]).toEqual([409, "ALREADY_ELIMINATED"]);
    expect(await registrationRow(registration.id)).toEqual({ ...registration, paymentConfirmed: true });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it.each(["completed", "cancelled"])("on a %s tournament, changes only payment and the high-hand fields (409 TOURNAMENT_CLOSED)", async (status) => {
    const { tournament, agent } = await ownedTournament({ status, enableHighHand: true });
    const { registration } = await registered(tournament.id, "Alice", { finalPosition: 1 });

    const payment = await agent.put(`/api/registrations/${registration.id}`).send({ paymentConfirmed: true, highHandWinner: true, highHandAmount: "50" });
    const results = await Promise.all(
      [{ rebuys: 1 }, { knockouts: 3 }, { isEliminated: true }, { buyIns: 2 }].map((change) =>
        agent.put(`/api/registrations/${registration.id}`).send(change),
      ),
    );

    expect(payment.status).toBe(200);
    for (const response of results) {
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("TOURNAMENT_CLOSED");
    }
    expect(await registrationRow(registration.id)).toEqual({
      ...registration,
      paymentConfirmed: true,
      highHandWinner: true,
      // Worked out by the server from the (empty) high-hand pot, whatever the request said.
      highHandAmount: "0.00",
    });
  });
});

describe("POST /api/registrations/:id/counts", () => {
  it.each(CLUB_ROLES)("as the club's %s", async (role) => {
    const { club, tournament } = await ownedTournament({ rebuyAmount: "50.00" });
    const { registration } = await registered(tournament.id, "Alice");
    const { agent } = await signInClubRole(role, club.id);

    const response = await agent.post(`/api/registrations/${registration.id}/counts`).send({ rebuys: 1 });

    expect(response.status).toBe(STAFF_ROLES.includes(role) ? 200 : 403);
  });

  it("refuses anonymous visitors (401) and answers 404 for an unknown registration", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");

    const anonymous = await (await anon()).post(`/api/registrations/${registration.id}/counts`).send({ rebuys: 1 });
    const unknown = await agent.post(`/api/registrations/${UNKNOWN_ID}/counts`).send({ rebuys: 1 });

    expect(anonymous.status).toBe(401);
    expect(unknown.status).toBe(404);
    expect(await registrationRow(registration.id)).toEqual(registration);
  });

  it("adds and removes counts, logs each increase, and returns the registration", async () => {
    const { tournament, agent } = await ownedTournament({ rebuyAmount: "50.00", addonAmount: "25.00" });
    const { player, registration } = await registered(tournament.id, "Alice", { knockouts: 2 });

    const added = await agent.post(`/api/registrations/${registration.id}/counts`).send({ rebuys: 2, addons: 1, knockouts: -1 });
    const removed = await agent.post(`/api/registrations/${registration.id}/counts`).send({ rebuys: -1 });

    expect(added.status).toBe(200);
    expect(added.body).toEqual({ ...withPlayer(registration, player), rebuys: 2, addons: 1, knockouts: 1 });
    expect(removed.body).toMatchObject({ rebuys: 1, addons: 1, knockouts: 1 });
    const logs = await activityFor(tournament.id);
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([logEntry("rebuy", "Alice made 2 re-buys", player), logEntry("addon", "Alice purchased 1 add-on", player)]),
    );
  });

  it("loses no increment when several arrive at once (MONEY-21 / data-integrity-11)", async () => {
    const { tournament, agent } = await ownedTournament({ rebuyAmount: "50.00" });
    const { registration } = await registered(tournament.id, "Alice");

    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => agent.post(`/api/registrations/${registration.id}/counts`).send({ rebuys: 1 })));

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await registrationRow(registration.id)).rebuys).toBe(5);
    expect(await activityFor(tournament.id)).toHaveLength(5);
  });

  it("refuses an increase on a locked pool (MONEY-21), past maxRebuys, below zero, or once the tournament is over", async () => {
    const { club, tournament: locked, agent } = await ownedTournament({ prizePoolLocked: true, rebuyAmount: "50.00" });
    const capped = await createTournament({ clubId: club.id, maxRebuys: 1, rebuyAmount: "50.00" });
    const done = await createTournament({ clubId: club.id, status: "completed" });
    const { registration: onLocked } = await registered(locked.id, "Locked", { rebuys: 1 });
    const { registration: onCapped } = await registered(capped.id, "Capped", { rebuys: 1 });
    const { registration: onDone } = await registered(done.id, "Done");
    const counts = (id: string, body: object) => agent.post(`/api/registrations/${id}/counts`).send(body);

    const cases = [
      [await counts(onLocked.id, { rebuys: 1 }), "PRIZE_POOL_LOCKED"],
      [await counts(onLocked.id, { addons: 1 }), "PRIZE_POOL_LOCKED"],
      [await counts(onCapped.id, { rebuys: 1 }), "MAX_REBUYS_REACHED"],
      [await counts(onCapped.id, { addons: -1 }), "COUNT_BELOW_ZERO"],
      [await counts(onDone.id, { knockouts: 1 }), "TOURNAMENT_CLOSED"],
    ] as const;

    for (const [response, code] of cases) {
      expect(response.status).toBe(409);
      expect(response.body.code).toBe(code);
    }
    expect((await counts(onLocked.id, { rebuys: -1 })).status).toBe(200);
    expect(await registrationRow(onCapped.id)).toEqual(onCapped);
  });

  it("rejects an empty, fractional or oversized change", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");

    for (const body of [{}, { rebuys: 0 }, { rebuys: 1.5 }, { rebuys: 21 }, { rebuys: "1" }]) {
      const response = await agent.post(`/api/registrations/${registration.id}/counts`).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid registration data");
    }
  });
});

describe("PATCH /api/registrations/:id/confirm-payment", () => {
  it("confirms the payment and logs it", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player, registration } = await registered(tournament.id, "Alice");

    const response = await agent.patch(`/api/registrations/${registration.id}/confirm-payment`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...withPlayer(registration, player), paymentConfirmed: true });
    expect(await activityFor(tournament.id)).toEqual([logEntry("payment_confirmed", "Payment confirmed for Alice", player)]);
  });

  it("is idempotent: confirming again changes nothing and logs nothing (money-18)", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");

    const responses = await Promise.all([1, 2, 3].map(() => agent.patch(`/api/registrations/${registration.id}/confirm-payment`)));

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(responses.every((r) => r.body.paymentConfirmed === true)).toBe(true);
    expect((await activityFor(tournament.id)).map((entry) => entry.eventType)).toEqual(["payment_confirmed"]);
  });

  it("works after the tournament is over, for late reconciliation", async () => {
    const { tournament, agent } = await ownedTournament({ status: "completed" });
    const { registration } = await registered(tournament.id, "Alice");

    expect((await agent.patch(`/api/registrations/${registration.id}/confirm-payment`)).status).toBe(200);
  });

  it.each(CLUB_ROLES)("as the club's %s", async (role) => {
    const { club, tournament } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");
    const { agent } = await signInClubRole(role, club.id);

    const response = await agent.patch(`/api/registrations/${registration.id}/confirm-payment`);

    expect(response.status).toBe(STAFF_ROLES.includes(role) ? 200 : 403);
    expect((await registrationRow(registration.id)).paymentConfirmed).toBe(STAFF_ROLES.includes(role));
  });

  it("answers 404 for an unknown registration", async () => {
    const { agent } = await ownedTournament();

    const response = await agent.patch(`/api/registrations/${UNKNOWN_ID}/confirm-payment`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Registration not found", code: "NOT_FOUND" });
  });
});

describe("the removed PATCH routes (SEC-01, MONEY-21)", () => {
  it("answer the JSON 404 and change nothing, for staff and anonymous visitors alike", async () => {
    const { tournament, agent } = await ownedTournament({ prizePoolLocked: true, rebuyAmount: "50.00" });
    const { registration } = await registered(tournament.id, "Alice");
    const app = await getApp();

    const responses = [
      await agent.patch(`/api/registrations/${registration.id}`).send({ rebuys: 1 }),
      await agent.patch(`/api/tournaments/${tournament.id}/registrations/${registration.id}`).send({ rebuys: 4 }),
      await request(app).patch(`/api/registrations/${registration.id}`).send({ pointsAwarded: 999 }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "No such API endpoint", code: "NOT_FOUND" });
    }
    expect(await registrationRow(registration.id)).toEqual(registration);
  });
});

describe("pending and confirmed registrations (the payment desk)", () => {
  async function highHandTournament() {
    const { club, tournament, agent } = await ownedTournament({
      buyInAmount: "50.00",
      rebuyAmount: "50.00",
      addonAmount: "25.00",
      enableHighHand: true,
      highHandAmount: "20.00",
    });
    const at = (minute: number) => ({ registrationTime: new Date(Date.UTC(2026, 2, 1, 18, minute)) });
    const unpaidMulti = await registered(tournament.id, "Unpaid Multi", { buyIns: 2, rebuys: 1, addons: 1, ...at(1) });
    const unpaid = await registered(tournament.id, "Unpaid", { enteringHighHands: true, ...at(2) });
    const paid = await registered(tournament.id, "Paid", { paymentConfirmed: true, enteringHighHands: true, rebuys: 2, ...at(3) });
    const paidPlain = await registered(tournament.id, "Paid Plain", { paymentConfirmed: true, ...at(4) });
    return { club, tournament, agent, unpaid, unpaidMulti, paid, paidPlain };
  }

  /** A row as its home club's staff see it: the player's contact details included (ClubPlayer). */
  const staffRow = (entry: { registration: object; player: Player }) => {
    const { userId: _userId, ...player } = asJson(entry.player) as Record<string, unknown>;
    return { ...(asJson(entry.registration) as object), player: { ...player, canEdit: true } };
  };

  it("lists unpaid registrations in sign-up order with amountOwed counting every buy-in, re-buy, add-on and the high hand (money-18)", async () => {
    const { tournament, agent, unpaid, unpaidMulti } = await highHandTournament();

    const response = await agent.get(`/api/tournaments/${tournament.id}/pending-registrations`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { ...staffRow(unpaidMulti), amountOwed: 175 },
      { ...staffRow(unpaid), amountOwed: 70 },
    ]);
  });

  it("lists paid registrations with amountPaid worked out the same way", async () => {
    const { tournament, agent, paid, paidPlain } = await highHandTournament();

    const response = await agent.get(`/api/tournaments/${tournament.id}/confirmed-registrations`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { ...staffRow(paid), amountPaid: 170 },
      { ...staffRow(paidPlain), amountPaid: 50 },
    ]);
  });

  it("charges a ticked high-hand entry exactly as the high-hand pot counts it, even once high hands are switched off (P2REV4-CQ-08)", async () => {
    const { tournament, agent } = await ownedTournament({ buyInAmount: "30.00", enableHighHand: false, highHandAmount: "20.00" });
    const { registration } = await registered(tournament.id, "Alice", { enteringHighHands: true });

    const owed = async () =>
      (await agent.get(`/api/tournaments/${tournament.id}/pending-registrations`)).body.map((row: { amountOwed: number }) => row.amountOwed);
    const pot = async () => (await (await anon()).get(`/api/tournaments/${tournament.id}/prize-pool`)).body.breakdown.highHand.gross;

    expect([await owed(), await pot()]).toEqual([[50], 2_000]);
    // Unticking the entry takes it out of both.
    expect((await agent.put(`/api/registrations/${registration.id}`).send({ enteringHighHands: false })).status).toBe(200);
    expect([await owed(), await pot()]).toEqual([[30], 0]);
  });

  it.each(["pending-registrations", "confirmed-registrations"])("%s is for the club's staff only (SEC-09)", async (list) => {
    const { club, tournament } = await highHandTournament();
    const path = `/api/tournaments/${tournament.id}/${list}`;

    expect((await (await anon()).get(path)).status).toBe(401);
    for (const role of CLUB_ROLES) {
      const { agent } = await signInClubRole(role, club.id);
      expect((await agent.get(path)).status).toBe(STAFF_ROLES.includes(role) ? 200 : 403);
    }
    const { agent: admin } = await signIn({ role: "admin" });
    expect((await admin.get(`/api/tournaments/${UNKNOWN_ID}/${list}`)).status).toBe(404);
  });
});

describe("who an anonymous sign-up may register (P2REV0-02)", () => {
  it("is refused for another club's player, whose id is on public lists, as if they did not exist", async () => {
    const elsewhere = await createTournament({ clubId: (await createClub()).id });
    const { player: theirs } = await registered(elsewhere.id, "Their Regular");
    const ours = await createTournament({ clubId: (await createClub()).id, maxPlayers: 2 });

    const harvested = await signUp(ours, { playerId: theirs.id, signUpToken: undefined });
    const forged = await signUp(ours, { playerId: theirs.id, signUpToken: "9999999999999.not-a-signature" });
    const borrowed = await signUp(ours, { playerId: theirs.id, signUpToken: signUpTokenFor((await createPlayer()).id) });

    for (const response of [harvested, forged, borrowed]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Player not found", code: "PLAYER_NOT_FOUND" });
    }
    expect(await registrationsOf(ours.id)).toEqual([]);
  });

  it("is refused with a token that has expired: the visitor's proof lasts two hours (P2REV4-CQ2-02)", async () => {
    const elsewhere = await createTournament({ clubId: (await createClub()).id });
    const { player: theirs } = await registered(elsewhere.id, "Their Regular");
    const ours = await createTournament({ clubId: (await createClub()).id });
    const env = loadEnv(process.env);

    const expired = await signUp(ours, { playerId: theirs.id, signUpToken: issueSignUpToken(env, theirs.id, Date.now() - SIGN_UP_TOKEN_TTL_MS - 1) });
    expect(expired.status).toBe(404);
    expect(expired.body).toEqual({ error: "Player not found", code: "PLAYER_NOT_FOUND" });
    expect(await registrationsOf(ours.id)).toEqual([]);

    const fresh = await signUp(ours, { playerId: theirs.id, signUpToken: issueSignUpToken(env, theirs.id, Date.now() - SIGN_UP_TOKEN_TTL_MS + 60_000) });
    expect(fresh.status).toBe(201);
  });

  it("is accepted for one of the club's own players (whom its search finds), or for the player the visitor just typed in", async () => {
    const club = await createClub();
    const lastWeek = await createTournament({ clubId: club.id });
    const { player: regular } = await registered(lastWeek.id, "Regular");
    const tonight = await createTournament({ clubId: club.id });

    const returning = await signUp(tonight, { playerId: regular.id, signUpToken: undefined });
    const created = await (await anon()).post("/api/players").send({ name: "Walk-in", phone: "021 555 0123" });
    const newcomer = await signUp(tonight, { playerId: created.body.id, signUpToken: created.body.signUpToken });

    expect([returning.status, newcomer.status]).toEqual([201, 201]);
  });

  it("does not hold the club's staff to it: they may seat anyone", async () => {
    const elsewhere = await createTournament({ clubId: (await createClub()).id });
    const { player: visitor } = await registered(elsewhere.id, "Visitor");
    const { tournament, agent } = await ownedTournament();

    expect((await agent.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: visitor.id })).status).toBe(201);
  });
});

describe("DELETE /api/registrations/:id (P2REV0-02)", () => {
  it("takes a sign-up nothing has happened to out of the tournament, with its requests, logging and auditing it", async () => {
    const { tournament, agent } = await ownedTournament({ status: "in_progress", maxPlayers: 2, rebuyAmount: "20.00" });
    const { player, registration } = await registered(tournament.id, "Fake Entry");
    const { player: other } = await registered(tournament.id, "Real Player");
    expect((await signUp(tournament, { playerId: (await createPlayer()).id })).body.code).toBe("TOURNAMENT_FULL");
    await (await anon()).post(`/api/tournaments/${tournament.id}/pending-actions`).send({ playerId: player.id, actionType: "rebuy" });

    const response = await agent.delete(`/api/registrations/${registration.id}`);

    expect(response.status).toBe(204);
    expect((await registrationsOf(tournament.id)).map((r) => r.playerId)).toEqual([other.id]);
    expect(await testDb().select().from(pendingActions).where(eq(pendingActions.tournamentId, tournament.id))).toEqual([]);
    expect((await activityFor(tournament.id)).at(-1)).toEqual(logEntry("registration_removed", "Fake Entry's entry was removed", player));
    const [audit] = await testDb().select().from(auditLog).where(eq(auditLog.action, "registration.remove"));
    expect(audit).toMatchObject({ targetType: "registration", targetId: registration.id, data: { requestsRemoved: 1, playerName: "Fake Entry" } });
    expect((audit.data as { registration: { id: string } }).registration.id).toBe(registration.id);
    // The seat is free again for a real QR sign-up.
    expect((await signUp(tournament, { playerId: (await createPlayer()).id })).status).toBe(201);
  });

  it("refuses an entry that already has results, counts or knockouts (409 REGISTRATION_IN_PLAY), and a closed tournament", async () => {
    const { tournament, agent } = await ownedTournament({ status: "in_progress" });
    const { player: knocker } = await registered(tournament.id, "Knocker");
    const cases = [
      (await registered(tournament.id, "Rebought", { rebuys: 1 })).registration,
      (await registered(tournament.id, "Out", { isEliminated: true, eliminatedBy: knocker.id })).registration,
    ];
    const knockerRegistration = (await registrationsOf(tournament.id)).find((r) => r.playerId === knocker.id)!;
    for (const registration of [...cases, knockerRegistration]) {
      const response = await agent.delete(`/api/registrations/${registration.id}`);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("REGISTRATION_IN_PLAY");
    }
    const finished = await ownedTournament({ status: "completed" });
    const { registration: done } = await registered(finished.tournament.id, "Done");
    expect((await finished.agent.delete(`/api/registrations/${done.id}`)).body.code).toBe("TOURNAMENT_CLOSED");
    expect(await registrationsOf(tournament.id)).toHaveLength(3);
  });
});

describe("high-hand awards keep fitting the pot when it changes (MONEY-P2REV-05)", () => {
  async function awarded(payouts = 1) {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: payouts });
    const entrants = [];
    for (const name of ["Ann", "Bea", "Cy"]) entrants.push(await registered(tournament.id, name, { enteringHighHands: true }));
    const award = await agent.put(`/api/registrations/${entrants[0].registration.id}`).send({ highHandWinner: true });
    expect(award.body.highHandAmount).toBe(payouts === 1 ? "30.00" : "15.00");
    return { tournament, agent, entrants };
  }

  it("refuses unticking an entry when that would leave the pot smaller than the awards (HIGH_HAND_OVER_POOL)", async () => {
    const { agent, entrants } = await awarded();

    const response = await agent.put(`/api/registrations/${entrants[1].registration.id}`).send({ enteringHighHands: false });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "The high-hand awards already made ($30) would be more than the $20 pot: take an award back first",
      code: "HIGH_HAND_OVER_POOL",
    });
    expect((await registrationRow(entrants[1].registration.id)).enteringHighHands).toBe(true);
  });

  it("refuses a new entrant, or a new fee, once every prize is awarded, so no money is left that nobody can win (HIGH_HAND_AWARDED)", async () => {
    const { tournament, agent } = await awarded();

    const late = await signUp(tournament, { playerId: (await createPlayer()).id, enteringHighHands: true });
    const fee = await agent.put(`/api/tournaments/${tournament.id}`).send({ highHandAmount: "15.00" });

    expect([late.body.code, fee.body.code]).toEqual(["HIGH_HAND_AWARDED", "HIGH_HAND_AWARDED"]);
    expect(await registrationsOf(tournament.id)).toHaveLength(3);
  });

  it("lets the pot grow while prizes are still to come, the next award taking the growth", async () => {
    const { tournament, agent, entrants } = await awarded(2);

    expect((await signUp(tournament, { playerId: (await createPlayer()).id, enteringHighHands: true })).status).toBe(201);
    const second = await agent.put(`/api/registrations/${entrants[1].registration.id}`).send({ highHandWinner: true });

    expect(second.body.highHandAmount).toBe("25.00");
  });

  it("lets an award be taken back, and the pot then change", async () => {
    const { agent, entrants } = await awarded();

    expect((await agent.put(`/api/registrations/${entrants[0].registration.id}`).send({ highHandWinner: false })).status).toBe(200);
    expect((await agent.put(`/api/registrations/${entrants[1].registration.id}`).send({ enteringHighHands: false })).status).toBe(200);
  });
});

describe("a manual AP total never ends up above what came in (P2REV1-04, spec D16)", () => {
  /** $20 entries and a manual AP total of $50. */
  const apTournament = () => ownedTournament({ buyInAmount: "20.00", rebuyAmount: "20.00", rakeOverride: "50.00" });

  it("refuses removing an entry that would take the gross below it, and keeps the entry", async () => {
    const { tournament, agent } = await apTournament();
    for (const name of ["Ann", "Bea"]) await registered(tournament.id, name);
    const cy = await registered(tournament.id, "Cy"); // $60 in

    const response = await agent.delete(`/api/registrations/${cy.registration.id}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "The manual Rake total ($50) would be more than the $40 taken in: lower the Rake first",
      code: "AP_EXCEEDS_GROSS",
      details: { grossCents: 4_000 },
    });
    expect(await registrationRow(cy.registration.id)).toEqual(cy.registration);
  });

  it("refuses lowering buy-ins, re-buys or add-ons with PUT past it, but not a change that keeps the gross above it", async () => {
    const { tournament, agent } = await apTournament();
    const ann = await registered(tournament.id, "Ann", { buyIns: 3, rebuys: 1 }); // $80 in

    const fine = await agent.put(`/api/registrations/${ann.registration.id}`).send({ rebuys: 0 }); // $60
    const tooFar = await agent.put(`/api/registrations/${ann.registration.id}`).send({ buyIns: 2 }); // $40

    expect(fine.status).toBe(200);
    expect(tooFar.status).toBe(400);
    expect(tooFar.body.code).toBe("AP_EXCEEDS_GROSS");
    expect(await registrationRow(ann.registration.id)).toMatchObject({ buyIns: 3, rebuys: 0 });
  });

  it("refuses a negative /counts change past it, leaving the count as it was", async () => {
    const { tournament, agent } = await apTournament();
    const ann = await registered(tournament.id, "Ann", { buyIns: 2, rebuys: 1 }); // $60 in

    const response = await agent.post(`/api/registrations/${ann.registration.id}/counts`).send({ rebuys: -1 }); // $40

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("AP_EXCEEDS_GROSS");
    expect((await registrationRow(ann.registration.id)).rebuys).toBe(1);
    expect((await agent.post(`/api/registrations/${ann.registration.id}/counts`).send({ knockouts: 1 })).status).toBe(200);
  });
});

describe("a tied high hand is split (TN2-04)", () => {
  it("shares the winner's prize half each, adds a prize, and logs the split", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 1 });
    const ann = await registered(tournament.id, "Ann", { enteringHighHands: true });
    const bea = await registered(tournament.id, "Bea", { enteringHighHands: true });
    await registered(tournament.id, "Cy", { enteringHighHands: true });
    await agent.put(`/api/registrations/${ann.registration.id}`).send({ highHandWinner: true });

    const tooMany = await agent.put(`/api/registrations/${bea.registration.id}`).send({ highHandWinner: true });
    const split = await agent
      .put(`/api/registrations/${bea.registration.id}`)
      .send({ highHandWinner: true, highHandSplitWith: ann.registration.id });

    expect(tooMany.body.code).toBe("HIGH_HAND_AWARDED");
    expect(split.status).toBe(200);
    expect(split.body).toMatchObject({ highHandWinner: true, highHandAmount: "15.00" });
    expect((await registrationRow(ann.registration.id)).highHandAmount).toBe("15.00");
    expect((await testDb().select().from(tournaments).where(eq(tournaments.id, tournament.id)))[0].highHandPayouts).toBe(2);
    expect((await activityFor(tournament.id)).at(-1)).toMatchObject({
      eventType: "high_hand",
      description: "Bea won high hand, split with Ann ($15; Ann keeps $15)",
    });
  });

  it("audits a tie, which changes the tournament's prize count, and keeps that count one the API accepts back (CQ-P2-04)", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 4 });
    const entries = [];
    for (const name of ["Ann", "Bea", "Cy", "Dee", "Eve"]) entries.push(await registered(tournament.id, name, { enteringHighHands: true }));
    for (const entry of entries.slice(0, 4)) {
      expect((await agent.put(`/api/registrations/${entry.registration.id}`).send({ highHandWinner: true })).status).toBe(200);
    }
    await testDb().update(tournaments).set({ status: "completed" }).where(eq(tournaments.id, tournament.id));

    // A tie found while settling up, after the game: still recorded, now as a fifth prize.
    const split = await agent
      .put(`/api/registrations/${entries[4].registration.id}`)
      .send({ highHandWinner: true, highHandSplitWith: entries[0].registration.id });

    expect(split.status).toBe(200);
    expect((await testDb().select().from(tournaments).where(eq(tournaments.id, tournament.id)))[0].highHandPayouts).toBe(5);
    expect(await testDb().select().from(auditLog).where(eq(auditLog.action, "high_hand.split"))).toEqual([
      expect.objectContaining({
        targetType: "tournament",
        targetId: tournament.id,
        data: {
          registrationId: entries[4].registration.id,
          splitWithRegistrationId: entries[0].registration.id,
          shareCents: 625,
          keepCents: 625,
          highHandPayouts: { before: 4, after: 5 },
        },
      }),
    ]);
    // The edit form resending the stored count is not refused.
    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ highHandPayouts: 5, name: "Renamed" })).status).toBe(200);
  });

  it(`refuses a tie past ${HIGH_HAND_PRIZES_MAX} high-hand prizes`, async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: HIGH_HAND_PRIZES_MAX });
    const ann = await registered(tournament.id, "Ann", { enteringHighHands: true, highHandWinner: true, highHandAmount: "5.00" });
    const bea = await registered(tournament.id, "Bea", { enteringHighHands: true });

    const split = await agent.put(`/api/registrations/${bea.registration.id}`).send({ highHandWinner: true, highHandSplitWith: ann.registration.id });

    expect(split.status).toBe(409);
    expect(split.body.code).toBe("HIGH_HAND_AWARDED");
    expect((await registrationRow(ann.registration.id)).highHandAmount).toBe("5.00");
  });

  it("refuses a split with someone who did not win, or without awarding", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "10.00" });
    const ann = await registered(tournament.id, "Ann", { enteringHighHands: true });
    const bea = await registered(tournament.id, "Bea", { enteringHighHands: true });

    const notAWinner = await agent.put(`/api/registrations/${bea.registration.id}`).send({ highHandWinner: true, highHandSplitWith: ann.registration.id });
    const notAwarding = await agent.put(`/api/registrations/${bea.registration.id}`).send({ highHandSplitWith: ann.registration.id });

    expect(notAWinner.body.code).toBe("INVALID_TARGET");
    expect(notAwarding.status).toBe(400);
    expect((await registrationRow(bea.registration.id)).highHandWinner).toBe(false);
  });
});

describe("a finished tournament's standings (TN2-05)", () => {
  it("points the TD to Correct Results when an elimination is changed after finalize", async () => {
    const { tournament, agent } = await ownedTournament({ status: "completed" });
    const { registration } = await registered(tournament.id, "Alice", { finalPosition: 2, isEliminated: true });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: false });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      "This tournament has finished: only payment and high-hand details can change. To change the finishing order, use Correct Results",
    );
  });
});

describe("the public-write budget (anonymous sign-ups and requests)", () => {
  async function limitedApp(limits?: { publicWrite: number }) {
    const env = loadEnv(process.env);
    return createApp({ env, sessionStore: new session.MemoryStore(), rateLimits: { enabled: true, limits } });
  }

  it("counts each tournament's sign-ups and requests together, new players apart, then answers 429", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, status: "in_progress", addonAmount: "20.00" });
    const other = await createTournament({ clubId: tournament.clubId, status: "registration" });
    const { player } = await registered(tournament.id, "Alice");
    const app = await limitedApp({ publicWrite: 2 });

    const tonight = [
      (await request(app).post(`/api/tournaments/${tournament.id}/registrations`).send(vouched({ playerId: (await createPlayer()).id }))).status,
      (await request(app).post(`/api/tournaments/${tournament.id}/pending-actions`).send({ playerId: player.id, actionType: "addon" })).status,
      (await request(app).post(`/api/tournaments/${tournament.id}/registrations`).send(vouched({ playerId: (await createPlayer()).id }))).status,
    ];
    const newPlayers = [
      (await request(app).post("/api/players").send({ name: "Walk-in", phone: "021 555 0199" })).status,
      (await request(app).post("/api/players").send({ name: "Walk-in Two", phone: "021 555 0198" })).status,
      (await request(app).post("/api/players").send({ name: "One Too Many", phone: "021 555 0197" })).status,
    ];
    const elsewhere = await request(app).post(`/api/tournaments/${other.id}/registrations`).send(vouched({ playerId: (await createPlayer()).id }));

    expect(tonight).toEqual([201, 201, 429]);
    expect(newPlayers).toEqual([201, 201, 429]);
    expect(elsewhere.status).toBe(201);
  });

  it("gives a signed-in account a bucket of its own: the TD's desk never shares the room's, and no account skips the limit (SEC-P2-02)", async () => {
    const owner = await createUser();
    const tournament = await createTournament({ clubId: (await createClub({ ownerId: owner.id })).id });
    const app = await limitedApp({ publicWrite: 2 });
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post(`/api/tournaments/${tournament.id}/registrations`).send(vouched({ playerId: (await createPlayer()).id }))).status).toBe(201);
    }
    const staff = request.agent(app);
    expect((await staff.post("/api/auth/login").send({ email: owner.email, password: FACTORY_PASSWORD })).status).toBe(200);

    const desk = [];
    for (let i = 0; i < 3; i++) desk.push((await staff.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: (await createPlayer()).id })).status);

    expect(desk).toEqual([201, 201, 429]);
  });

  it("lets a full room on one venue address through with the production limits: 50 new players, their sign-ups and 50 add-on requests (TN-01)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, status: "registration", maxPlayers: 60, addonAmount: "20.00" });
    const app = await limitedApp();
    const venue = { "X-Forwarded-For": "203.0.113.50" };

    const statuses: number[] = [];
    for (let i = 0; i < 50; i++) {
      const created = await request(app).post("/api/players").set(venue).send({ name: `Player ${i}`, phone: `021 600 ${String(i).padStart(4, "0")}` });
      statuses.push(created.status);
      statuses.push(
        (await request(app).post(`/api/tournaments/${tournament.id}/registrations`).set(venue).send({ playerId: created.body.id, signUpToken: created.body.signUpToken }))
          .status,
      );
    }
    const signedUp = await registrationsOf(tournament.id);
    for (const registration of signedUp) {
      statuses.push(
        (await request(app).post(`/api/tournaments/${tournament.id}/pending-actions`).set(venue).send({ playerId: registration.playerId, actionType: "addon" })).status,
      );
    }

    expect(signedUp).toHaveLength(50);
    expect(statuses.filter((status) => status !== 201)).toEqual([]);
  }, 60_000);
});

describe("the format's house rules (TDN3-HOUSE-RULES)", () => {
  /** Central Stars' One Life Line: one $25 re-buy OR one $25 add-on per player. */
  const oneLifeLine = { rebuyAmount: "25.00", addonAmount: "25.00", maxRebuys: 1, maxAddons: 1, rebuyOrAddon: true, status: "in_progress" } as const;
  const ONE_OR_THE_OTHER = "this tournament allows one re-buy OR one add-on per player";

  it("refuses a second add-on, and an add-on after the re-buy, at the desk, wherever the count is changed", async () => {
    const { tournament, agent } = await ownedTournament(oneLifeLine);
    const { registration: alice } = await registered(tournament.id, "Alice");
    const { registration: bob } = await registered(tournament.id, "Bob", { rebuys: 1 });
    const counts = (id: string, body: object) => agent.post(`/api/registrations/${id}/counts`).send(body);

    const firstAddon = await counts(alice.id, { addons: 1 });
    const secondAddon = await counts(alice.id, { addons: 1 });
    const rebuyAfterAddon = await counts(alice.id, { rebuys: 1 });
    const addonAfterRebuy = await agent.put(`/api/registrations/${bob.id}`).send({ addons: 1 });
    const both = await agent.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: (await createPlayer()).id, rebuys: 1, addons: 1 });
    const correction = await agent.put(`/api/registrations/${bob.id}`).send({ rebuys: 0 });

    expect(firstAddon.status).toBe(200);
    expect(secondAddon.status).toBe(409);
    expect(secondAddon.body).toEqual({ error: "This tournament allows at most 1 add-on per player", code: "MAX_ADDONS_REACHED" });
    expect(rebuyAfterAddon.status).toBe(409);
    expect(rebuyAfterAddon.body).toEqual({ error: `Already took an add-on: ${ONE_OR_THE_OTHER}`, code: "REBUY_OR_ADDON" });
    expect(addonAfterRebuy.status).toBe(409);
    expect(addonAfterRebuy.body).toEqual({ error: `Already took a re-buy: ${ONE_OR_THE_OTHER}`, code: "REBUY_OR_ADDON" });
    expect(both.status).toBe(409);
    expect(both.body.code).toBe("REBUY_OR_ADDON");
    expect(correction.status).toBe(200);
    expect(await registrationRow(alice.id)).toMatchObject({ rebuys: 0, addons: 1 });
    expect((await activityFor(tournament.id)).map((entry) => entry.description)).toEqual(["Alice purchased 1 add-on"]);
  });

  it("changes nothing for a tournament whose format sets no such rule", async () => {
    const { tournament, agent } = await ownedTournament({ rebuyAmount: "25.00", addonAmount: "25.00", status: "in_progress" });
    const { registration } = await registered(tournament.id, "Alice", { rebuys: 3, addons: 2 });

    const response = await agent.post(`/api/registrations/${registration.id}/counts`).send({ rebuys: 1, addons: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ rebuys: 4, addons: 3 });
  });

  it("says when a re-buy or add-on is sold after the re-buy period on the clock, and still sells it", async () => {
    // The test clock: 20 + 20-minute levels and a 15-minute break, so re-buys close 55 minutes in.
    const { tournament, agent } = await ownedTournament({ ...oneLifeLine, maxAddons: null, rebuyOrAddon: null, maxRebuys: null, rebuyPeriodMinutes: 55 });
    const { registration: alice } = await registered(tournament.id, "Alice");
    const { registration: bob } = await registered(tournament.id, "Bob");
    await createClock({ tournamentId: tournament.id, state: { status: "paused", currentLevelIndex: 1, pausedRemainingMs: 5 * MINUTE_MS, startedAt: Date.now() - 60 * MINUTE_MS } });

    const inTime = await agent.post(`/api/registrations/${alice.id}/counts`).send({ rebuys: 1 });
    await testDb().update(tournamentClocks).set({ currentLevelIndex: 3, pausedRemainingMs: 10 * MINUTE_MS }).where(eq(tournamentClocks.tournamentId, tournament.id));
    const late = await agent.post(`/api/registrations/${bob.id}/counts`).send({ rebuys: 1, addons: 1 });

    expect([inTime.status, late.status]).toEqual([200, 200]);
    const after = "after the re-buy period, which ended at 0:55 on the clock";
    const data = JSON.stringify({ afterRebuyPeriod: true, rebuyPeriodMinutes: 55 });
    // Bob's two entries share a timestamp, so they are compared in name order.
    const entries = (await activityFor(tournament.id)).map(({ description, eventData }) => [description, eventData]);
    expect(entries.sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual([
      ["Alice made 1 re-buy", null],
      [`Bob made 1 re-buy ${after}`, data],
      [`Bob purchased 1 add-on ${after}`, data],
    ]);
  });

  it("is stored and shown with the tournament", async () => {
    const { tournament, agent } = await ownedTournament({ rebuyAmount: "25.00", addonAmount: "25.00" });

    const updated = await agent.put(`/api/tournaments/${tournament.id}`).send({ maxAddons: 1, rebuyOrAddon: true });
    const shown = await (await anon()).get(`/api/tournaments/${tournament.id}`);

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ maxAddons: 1, rebuyOrAddon: true });
    expect(shown.body).toMatchObject({ maxAddons: 1, rebuyOrAddon: true });
    expect((await testDb().select().from(tournaments).where(eq(tournaments.id, tournament.id)))[0]).toMatchObject({ maxAddons: 1, rebuyOrAddon: true });
  });
});
