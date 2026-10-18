/**
 * Characterization of today's registration API (server/routes.ts): public
 * self-registration, the list with players, the three update routes (PUT with
 * the prize-pool lock and activity log, and the two PATCH twins without
 * either), confirm-payment, and the pending/confirmed payment lists.
 *
 * `it.fails` tests state the correct behaviour for a known hole, tagged with
 * its audit finding id. They pass while the hole is open; when it is fixed,
 * Vitest reports them as failing, so switch them to `it` and delete the
 * "today" test beside them.
 */
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { activityLog, tournamentRegistrations, type Player } from "@shared/schema";
import {
  createClub,
  createPlayer,
  createRegistration,
  createTournament,
  createUser,
  type NewRegistration,
  type NewTournament,
} from "../factories";
import { anon, asJson, getApp, loginAs, resetDb, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const ELIMINATED_AT = "2026-03-01T20:15:00.000Z";

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
    .sort((a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp)))
    .map(({ eventType, description, playerId, eventData }) => ({ eventType, description, playerId, eventData }));

const logEntry = (eventType: string, description: string, player: Player, eventData: string | null = null) => ({
  eventType,
  description,
  playerId: player.id,
  eventData,
});

describe("POST /api/tournaments/:tournamentId/registrations", () => {
  it("registers a player anonymously with the column defaults and logs it", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const player = await createPlayer({ name: "Alice" });

    const response = await (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: player.id });

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
      paymentConfirmed: false,
      highHandWinner: false,
      highHandAmount: null,
    });
    expect(await activityFor(tournament.id)).toEqual([
      logEntry("registration", "Alice registered for the tournament", player),
    ]);
  });

  it("records a high-hand entry when the tournament offers one", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, enableHighHand: true, highHandAmount: "20.00" });
    const player = await createPlayer();

    const response = await (await anon())
      .post(`/api/tournaments/${tournament.id}/registrations`)
      .send({ playerId: player.id, enteringHighHands: true });

    expect(response.status).toBe(201);
    expect(response.body.enteringHighHands).toBe(true);
  });

  it("stores the director's buy-in, re-buy and add-on counts as sent", async () => {
    const { tournament, agent } = await ownedTournament({ rebuyAmount: "50.00", addonAmount: "50.00" });
    const player = await createPlayer();

    const response = await agent
      .post(`/api/tournaments/${tournament.id}/registrations`)
      .send({ playerId: player.id, buyIns: 2, rebuys: 1, addons: 1, enteringHighHands: false });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ buyIns: 2, rebuys: 1, addons: 1, paymentConfirmed: false });
  });

  it("answers 404 for an unknown tournament", async () => {
    const player = await createPlayer();

    const response = await (await anon()).post(`/api/tournaments/${UNKNOWN_ID}/registrations`).send({ playerId: player.id });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found" });
  });

  it("answers 400 once the prize pool is locked", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, prizePoolLocked: true });
    const player = await createPlayer();

    const response = await (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: player.id });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Prize pool is locked. No new registrations allowed." });
    expect(await registrationsOf(tournament.id)).toEqual([]);
  });

  it("answers 400 to a high-hand entry the tournament does not offer", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, enableHighHand: false });
    const player = await createPlayer();

    const response = await (await anon())
      .post(`/api/tournaments/${tournament.id}/registrations`)
      .send({ playerId: player.id, enteringHighHands: true });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "High hands entry is not available for this tournament" });
  });

  it("answers 400 when the player is already registered", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const { player } = await registered(tournament.id, "Alice");

    const response = await (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: player.id });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Player is already registered for this tournament" });
    expect(await registrationsOf(tournament.id)).toHaveLength(1);
  });

  it("answers 400 with the zod issues when playerId is missing", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });

    const response = await (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid registration data", details: [{ path: ["playerId"] }] });
  });

  it("answers 500 when the player does not exist", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });

    const response = await (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: UNKNOWN_ID });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to create registration" });
  });

  describe("known bug SEC-06 / security-09: the public signup accepts any registration column", () => {
    const freeEntry = { paymentConfirmed: true, buyIns: 0, prizeAmount: "500", pointsAwarded: 999, finalPosition: 1, highHandWinner: true };

    it("today: an anonymous signup stores a confirmed, prize-winning registration", async () => {
      const tournament = await createTournament({ clubId: (await createClub()).id });
      const player = await createPlayer();

      const response = await (await anon())
        .post(`/api/tournaments/${tournament.id}/registrations`)
        .send({ playerId: player.id, ...freeEntry });

      expect(response.status).toBe(201);
      expect(await registrationRow(response.body.id)).toMatchObject({ ...freeEntry, prizeAmount: "500.00" });
    });

    it.fails("never stores payment, money or results sent by an anonymous signup", async () => {
      const tournament = await createTournament({ clubId: (await createClub()).id });
      const player = await createPlayer();

      const response = await (await anon())
        .post(`/api/tournaments/${tournament.id}/registrations`)
        .send({ playerId: player.id, ...freeEntry });

      // Registered with the defaults, or refused outright; a server error that stores nothing is no fix.
      expect([201, 400, 422]).toContain(response.status);
      const rows = await registrationsOf(tournament.id);
      expect(rows).toHaveLength(response.status === 201 ? 1 : 0);
      for (const row of rows) {
        expect(row).toMatchObject({
          paymentConfirmed: false,
          buyIns: 1,
          prizeAmount: null,
          pointsAwarded: null,
          finalPosition: null,
          highHandWinner: false,
        });
      }
    });
  });

  describe("known bug data-integrity-10 / SEC-06: maxPlayers and the tournament status are not enforced", () => {
    it("today: a third player registers for a two-seat tournament", async () => {
      const tournament = await createTournament({ clubId: (await createClub()).id, maxPlayers: 2 });
      await registered(tournament.id, "Alice");
      await registered(tournament.id, "Bob");

      const response = await (await anon())
        .post(`/api/tournaments/${tournament.id}/registrations`)
        .send({ playerId: (await createPlayer()).id });

      expect(response.status).toBe(201);
      expect(await registrationsOf(tournament.id)).toHaveLength(3);
    });

    it("today: a player registers for a completed tournament", async () => {
      const tournament = await createTournament({ clubId: (await createClub()).id, status: "completed" });

      const response = await (await anon())
        .post(`/api/tournaments/${tournament.id}/registrations`)
        .send({ playerId: (await createPlayer()).id });

      expect(response.status).toBe(201);
    });

    it.fails("refuses a registration once maxPlayers is reached", async () => {
      const tournament = await createTournament({ clubId: (await createClub()).id, maxPlayers: 2 });
      await registered(tournament.id, "Alice");
      await registered(tournament.id, "Bob");

      const response = await (await anon())
        .post(`/api/tournaments/${tournament.id}/registrations`)
        .send({ playerId: (await createPlayer()).id });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(await registrationsOf(tournament.id)).toHaveLength(2);
    });

    it.fails("refuses a registration for a completed tournament", async () => {
      const tournament = await createTournament({ clubId: (await createClub()).id, status: "completed" });

      const response = await (await anon())
        .post(`/api/tournaments/${tournament.id}/registrations`)
        .send({ playerId: (await createPlayer()).id });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(await registrationsOf(tournament.id)).toEqual([]);
    });
  });
});

describe("GET /api/tournaments/:tournamentId/registrations", () => {
  it("returns each registration with its full player row, to anonymous visitors", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const alice = await registered(tournament.id, "Alice", { paymentConfirmed: true });
    const bob = await registered(tournament.id, "Bob", { rebuys: 2 });
    await registered((await createTournament({ clubId: tournament.clubId })).id, "Elsewhere");

    const response = await (await anon()).get(`/api/tournaments/${tournament.id}/registrations`);

    expect(response.status).toBe(200);
    const listed = [...(response.body as Array<{ player: { name: string } }>)].sort((a, b) =>
      a.player.name.localeCompare(b.player.name),
    );
    expect(listed).toEqual([
      { ...(asJson(alice.registration) as object), player: asJson(alice.player) },
      { ...(asJson(bob.registration) as object), player: asJson(bob.player) },
    ]);
  });

  it("returns an empty list for an unknown tournament", async () => {
    const response = await (await anon()).get(`/api/tournaments/${UNKNOWN_ID}/registrations`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("PUT /api/registrations/:id", () => {
  it("eliminates a player and logs it", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player, registration } = await registered(tournament.id, "Alice");

    const response = await agent
      .put(`/api/registrations/${registration.id}`)
      .send({ isEliminated: true, eliminationTime: ELIMINATED_AT });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...(asJson(registration) as object), isEliminated: true, eliminationTime: ELIMINATED_AT });
    expect(await activityFor(tournament.id)).toEqual([logEntry("elimination", "Alice was eliminated", player)]);
  });

  it("names the player who made the knockout and records them in eventData, without crediting the knockout", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player: alice, registration } = await registered(tournament.id, "Alice");
    const { player: bob, registration: bobRegistration } = await registered(tournament.id, "Bob");

    const response = await agent
      .put(`/api/registrations/${registration.id}`)
      .send({ isEliminated: true, eliminationTime: ELIMINATED_AT, eliminatedBy: bob.id });

    expect(response.status).toBe(200);
    expect(response.body.eliminatedBy).toBe(bob.id);
    expect(await activityFor(tournament.id)).toEqual([
      logEntry("elimination", "Alice was eliminated by Bob", alice, JSON.stringify({ eliminatedBy: bob.id })),
    ]);
    expect((await registrationRow(bobRegistration.id)).knockouts).toBe(0);
  });

  it("does not log a second elimination of a player who is already out", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice", { isEliminated: true, eliminationTime: new Date(ELIMINATED_AT) });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: true });

    expect(response.status).toBe(200);
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("restores a player and logs it, leaving eliminatedBy and the eliminator's knockouts as they were (money-25)", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player: bob, registration: bobRegistration } = await registered(tournament.id, "Bob", { knockouts: 1 });
    const { player: alice, registration } = await registered(tournament.id, "Alice", {
      isEliminated: true,
      eliminationTime: new Date(ELIMINATED_AT),
      eliminatedBy: bob.id,
    });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ isEliminated: false, eliminationTime: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ isEliminated: false, eliminationTime: null, eliminatedBy: bob.id });
    expect((await registrationRow(bobRegistration.id)).knockouts).toBe(1);
    expect(await activityFor(tournament.id)).toEqual([logEntry("player_restored", "Alice was restored to active", alice)]);
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

  it("stores a lower re-buy or add-on count without logging", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice", { rebuys: 2, addons: 1 });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ rebuys: 1, addons: 0 });

    expect(response.body).toMatchObject({ rebuys: 1, addons: 0 });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("stores a knockout count as sent, without logging", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice", { knockouts: 1 });

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ knockouts: 2 });

    expect(response.status).toBe(200);
    expect(response.body.knockouts).toBe(2);
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("logs a high-hand win with the amount as sent, and only the first time", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true, highHandAmount: "20.00" });
    const { player, registration } = await registered(tournament.id, "Alice", { enteringHighHands: true });

    const response = await agent
      .put(`/api/registrations/${registration.id}`)
      .send({ highHandWinner: true, highHandAmount: "150" });
    await agent.put(`/api/registrations/${registration.id}`).send({ highHandWinner: true, highHandAmount: "175" });

    expect(response.body).toMatchObject({ highHandWinner: true, highHandAmount: "150.00" });
    expect(await activityFor(tournament.id)).toEqual([
      logEntry("high_hand", "Alice won high hand ($150)", player, JSON.stringify({ amount: "150" })),
    ]);
  });

  it("logs a high-hand win without an amount when none is known", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true });
    const { player, registration } = await registered(tournament.id, "Alice");

    await agent.put(`/api/registrations/${registration.id}`).send({ highHandWinner: true });

    expect(await activityFor(tournament.id)).toEqual([logEntry("high_hand", "Alice won high hand", player)]);
  });

  it("answers 400 to a numeric high-hand amount (decimals must be strings)", async () => {
    const { tournament, agent } = await ownedTournament({ enableHighHand: true });
    const { registration } = await registered(tournament.id, "Alice");

    const response = await agent.put(`/api/registrations/${registration.id}`).send({ highHandWinner: true, highHandAmount: 150 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid registration data", details: [{ path: ["highHandAmount"] }] });
  });

  it("answers 404 for an unknown registration", async () => {
    const { agent } = await ownedTournament();

    const response = await agent.put(`/api/registrations/${UNKNOWN_ID}`).send({ rebuys: 1 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Registration not found" });
  });

  describe("while the prize pool is locked", () => {
    const lockedError = { error: "Prize pool is locked. No rebuys, addons, or high hand entries allowed." };

    it.each([
      ["a re-buy", { rebuys: 1 }],
      ["an add-on", { addons: 1 }],
      ["a high-hand entry", { enteringHighHands: true }],
    ])("answers 400 to %s and leaves the registration alone", async (_label, change) => {
      const { tournament, agent } = await ownedTournament({ prizePoolLocked: true, enableHighHand: true });
      const { registration } = await registered(tournament.id, "Alice");

      const response = await agent.put(`/api/registrations/${registration.id}`).send(change);

      expect(response.status).toBe(400);
      expect(response.body).toEqual(lockedError);
      expect(await registrationRow(registration.id)).toEqual(registration);
      expect(await activityFor(tournament.id)).toEqual([]);
    });

    it("still allows eliminations, knockouts and lowering a count", async () => {
      const { tournament, agent } = await ownedTournament({ prizePoolLocked: true });
      const { player, registration } = await registered(tournament.id, "Alice", { rebuys: 2 });
      const { registration: bobRegistration } = await registered(tournament.id, "Bob");

      const eliminated = await agent
        .put(`/api/registrations/${registration.id}`)
        .send({ isEliminated: true, eliminationTime: ELIMINATED_AT, rebuys: 1 });
      const knockout = await agent.put(`/api/registrations/${bobRegistration.id}`).send({ knockouts: 1 });

      expect(eliminated.status).toBe(200);
      expect(eliminated.body).toMatchObject({ isEliminated: true, rebuys: 1 });
      expect(knockout.body.knockouts).toBe(1);
      expect(await activityFor(tournament.id)).toEqual([logEntry("elimination", "Alice was eliminated", player)]);
    });
  });
});

describe("PATCH /api/registrations/:id", () => {
  it("stores any registration column as sent, without logging", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");

    const response = await agent
      .patch(`/api/registrations/${registration.id}`)
      .send({ rebuys: 2, addons: 1, isEliminated: true, eliminationTime: ELIMINATED_AT });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...(asJson(registration) as object),
      rebuys: 2,
      addons: 1,
      isEliminated: true,
      eliminationTime: ELIMINATED_AT,
    });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("answers 404 for an unknown registration", async () => {
    const { agent } = await ownedTournament();

    const response = await agent.patch(`/api/registrations/${UNKNOWN_ID}`).send({ rebuys: 1 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Registration not found" });
  });

  describe("known bug MONEY-21 / money-12: PATCH skips the prize-pool lock", () => {
    it("today: the director's re-buy and add-on confirmations get past a locked pool", async () => {
      const { tournament, agent } = await ownedTournament({ prizePoolLocked: true, rebuyAmount: "50.00", addonAmount: "50.00" });
      const { registration } = await registered(tournament.id, "Alice");

      const rebuy = await agent.patch(`/api/registrations/${registration.id}`).send({ rebuys: 1 });
      const addon = await agent.patch(`/api/registrations/${registration.id}`).send({ addons: 1 });

      expect([rebuy.status, addon.status]).toEqual([200, 200]);
      expect(await registrationRow(registration.id)).toMatchObject({ rebuys: 1, addons: 1 });
    });

    it.fails("refuses a re-buy or add-on on a locked pool and leaves the counts alone", async () => {
      const { tournament, agent } = await ownedTournament({ prizePoolLocked: true, rebuyAmount: "50.00", addonAmount: "50.00" });
      const { registration } = await registered(tournament.id, "Alice");

      const rebuy = await agent.patch(`/api/registrations/${registration.id}`).send({ rebuys: 1 });
      const addon = await agent.patch(`/api/registrations/${registration.id}`).send({ addons: 1 });

      for (const response of [rebuy, addon]) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
      expect(await registrationRow(registration.id)).toMatchObject({ rebuys: 0, addons: 0 });
    });
  });
});

describe("PATCH /api/tournaments/:tournamentId/registrations/:id", () => {
  it("updates the registration by its id alone, whatever tournament the path names (SEC-01)", async () => {
    const { tournament, agent } = await ownedTournament({ prizePoolLocked: true });
    const other = await createTournament({ clubId: (await createClub()).id });
    const { registration } = await registered(tournament.id, "Alice");

    const response = await agent.patch(`/api/tournaments/${other.id}/registrations/${registration.id}`).send({ rebuys: 4 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tournamentId: tournament.id, rebuys: 4 });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("answers 404 for an unknown registration", async () => {
    const { tournament, agent } = await ownedTournament();

    const response = await agent.patch(`/api/tournaments/${tournament.id}/registrations/${UNKNOWN_ID}`).send({ rebuys: 1 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Registration not found" });
  });
});

describe("PATCH /api/registrations/:id/confirm-payment", () => {
  it("confirms the payment and logs it", async () => {
    const { tournament, agent } = await ownedTournament();
    const { player, registration } = await registered(tournament.id, "Alice");

    const response = await agent.patch(`/api/registrations/${registration.id}/confirm-payment`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...(asJson(registration) as object), paymentConfirmed: true });
    expect(await activityFor(tournament.id)).toEqual([logEntry("payment_confirmed", "Payment confirmed for Alice", player)]);
  });

  it("confirms an already-confirmed payment again and logs it again (money-18)", async () => {
    const { tournament, agent } = await ownedTournament();
    const { registration } = await registered(tournament.id, "Alice");

    const first = await agent.patch(`/api/registrations/${registration.id}/confirm-payment`);
    const second = await agent.patch(`/api/registrations/${registration.id}/confirm-payment`);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await activityFor(tournament.id)).map((entry) => entry.eventType)).toEqual([
      "payment_confirmed",
      "payment_confirmed",
    ]);
  });

  it("answers 404 for an unknown registration", async () => {
    const { agent } = await ownedTournament();

    const response = await agent.patch(`/api/registrations/${UNKNOWN_ID}/confirm-payment`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Registration not found" });
  });
});

describe("pending and confirmed registrations", () => {
  async function highHandTournament() {
    const tournament = await createTournament({
      clubId: (await createClub()).id,
      buyInAmount: "50.00",
      rebuyAmount: "50.00",
      addonAmount: "25.00",
      enableHighHand: true,
      highHandAmount: "20.00",
    });
    const unpaid = await registered(tournament.id, "Unpaid", { enteringHighHands: true });
    const unpaidMulti = await registered(tournament.id, "Unpaid Multi", { buyIns: 2, rebuys: 1, addons: 1 });
    const paid = await registered(tournament.id, "Paid", { paymentConfirmed: true, enteringHighHands: true });
    const paidPlain = await registered(tournament.id, "Paid Plain", { paymentConfirmed: true });
    return { tournament, unpaid, unpaidMulti, paid, paidPlain };
  }

  const byName = (rows: Array<{ player: { name: string } }>) =>
    [...rows].sort((a, b) => a.player.name.localeCompare(b.player.name));

  it("lists unpaid registrations with the player and amountOwed = buy-in + high hand, ignoring extra buy-ins, re-buys and add-ons (money-18)", async () => {
    const { tournament, unpaid, unpaidMulti } = await highHandTournament();

    const response = await (await anon()).get(`/api/tournaments/${tournament.id}/pending-registrations`);

    expect(response.status).toBe(200);
    expect(byName(response.body)).toEqual([
      { ...(asJson(unpaid.registration) as object), player: asJson(unpaid.player), amountOwed: 70 },
      { ...(asJson(unpaidMulti.registration) as object), player: asJson(unpaidMulti.player), amountOwed: 50 },
    ]);
  });

  it("lists paid registrations with the player and amountPaid worked out the same way", async () => {
    const { tournament, paid, paidPlain } = await highHandTournament();

    const response = await (await anon()).get(`/api/tournaments/${tournament.id}/confirmed-registrations`);

    expect(response.status).toBe(200);
    expect(byName(response.body)).toEqual([
      { ...(asJson(paid.registration) as object), player: asJson(paid.player), amountPaid: 70 },
      { ...(asJson(paidPlain.registration) as object), player: asJson(paidPlain.player), amountPaid: 50 },
    ]);
  });

  it("leaves the high-hand fee out when the tournament no longer offers high hands", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, buyInAmount: "30.00", enableHighHand: false, highHandAmount: "20.00" });
    await registered(tournament.id, "Alice", { enteringHighHands: true });

    const response = await (await anon()).get(`/api/tournaments/${tournament.id}/pending-registrations`);

    expect(response.body.map((row: { amountOwed: number }) => row.amountOwed)).toEqual([30]);
  });

  it("returns empty lists for an unknown tournament", async () => {
    const app = await getApp();

    expect((await request(app).get(`/api/tournaments/${UNKNOWN_ID}/pending-registrations`)).body).toEqual([]);
    expect((await request(app).get(`/api/tournaments/${UNKNOWN_ID}/confirmed-registrations`)).body).toEqual([]);
  });
});

describe("known bug SEC-01: registration changes need no session", () => {
  it("today: an anonymous visitor confirms a payment, edits a registration and eliminates a player", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const { registration } = await registered(tournament.id, "Alice");
    const app = await getApp();

    const confirm = await request(app).patch(`/api/registrations/${registration.id}/confirm-payment`);
    const patch = await request(app).patch(`/api/registrations/${registration.id}`).send({ pointsAwarded: 999 });
    const put = await request(app).put(`/api/registrations/${registration.id}`).send({ isEliminated: true });

    expect([confirm.status, patch.status, put.status]).toEqual([200, 200, 200]);
    expect(await registrationRow(registration.id)).toMatchObject({ paymentConfirmed: true, pointsAwarded: 999, isEliminated: true });
  });

  it.fails("refuses anonymous registration changes (401) and leaves the registration alone", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const { registration } = await registered(tournament.id, "Alice");
    const app = await getApp();

    const responses = [
      await request(app).patch(`/api/registrations/${registration.id}/confirm-payment`),
      await request(app).patch(`/api/registrations/${registration.id}`).send({ pointsAwarded: 999 }),
      await request(app).put(`/api/registrations/${registration.id}`).send({ isEliminated: true }),
      await request(app).patch(`/api/tournaments/${tournament.id}/registrations/${registration.id}`).send({ rebuys: 3 }),
    ];

    for (const response of responses) expect(response.status).toBe(401);
    expect(await registrationRow(registration.id)).toEqual(registration);
  });
});
