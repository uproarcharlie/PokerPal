/**
 * Pending actions: players request a re-buy, add-on or knockout from their phone (public, validated
 * against the tournament: SEC-05, security-40); the tournament's staff list them, confirm them
 * (applied exactly once: data-integrity-11) or dismiss them.
 */
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import { activityLog, auditLog, pendingActions, tournamentRegistrations, tournaments, type Player } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, createUser, type NewTournament } from "../factories";
import { anon, asJson, loginAs, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { CLUB_ROLES, signInClubRole, signInDeactivatedManager, STAFF_ROLES } from "../helpers/club-staff";

beforeEach(resetDb);

/** An in-progress tournament in a club owned by a signed-in user, with two registered players. */
async function liveTournament(overrides: Partial<NewTournament> = {}) {
  const owner = await createUser();
  const club = await createClub({ ownerId: owner.id });
  const tournament = await createTournament({
    clubId: club.id,
    status: "in_progress",
    rebuyAmount: "50.00",
    addonAmount: "50.00",
    ...overrides,
  });
  const alice = await createPlayer({ name: "Alice", phone: "021 555 0101", email: "alice@example.test" });
  const bob = await createPlayer({ name: "Bob" });
  const [aliceRegistration, bobRegistration] = await Promise.all(
    [alice, bob].map((player) => createRegistration({ tournamentId: tournament.id, playerId: player.id })),
  );
  const { agent } = await loginAs({ email: owner.email });
  return { club, tournament, alice, bob, aliceRegistration, bobRegistration, agent };
}

const actionsOf = (tournamentId: string) =>
  testDb().select().from(pendingActions).where(eq(pendingActions.tournamentId, tournamentId));

const registrationRow = async (id: string) =>
  (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];

/** The tournament's activity as [eventType, description], in the order it was written. */
const activityOf = async (tournamentId: string) =>
  (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp))).map(
    ({ eventType, description }) => [eventType, description],
  );

async function insertAction(values: typeof pendingActions.$inferInsert) {
  const [action] = await testDb().insert(pendingActions).values(values).returning();
  return action;
}

const request = async (tournamentId: string, body: object) =>
  (await anon()).post(`/api/tournaments/${tournamentId}/pending-actions`).send(body);

const publicPlayer = (player: Player) => ({ id: player.id, name: player.name, imageUrl: player.imageUrl });

describe("POST /api/tournaments/:id/pending-actions", () => {
  it("records a player's re-buy request anonymously", async () => {
    const { tournament, alice } = await liveTournament();

    const response = await request(tournament.id, { playerId: alice.id, actionType: "rebuy", timestamp: "2000-01-01T00:00:00Z" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      tournamentId: tournament.id,
      playerId: alice.id,
      actionType: "rebuy",
      targetPlayerId: null,
      timestamp: expect.any(String),
      player: null,
      targetPlayer: null,
    });
    expect(findForbiddenKeys(response.body)).toEqual([]);
    const { player: _player, targetPlayer: _target, ...row } = response.body;
    expect(asJson(await actionsOf(tournament.id))).toEqual([row]);
  });

  it("records a knockout claim with its target, also while the pool is locked", async () => {
    const { tournament, alice, bob } = await liveTournament({ prizePoolLocked: true });

    const response = await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ actionType: "knockout", targetPlayerId: bob.id });
  });

  it("takes the tournament from the path, not the body", async () => {
    const { tournament, alice } = await liveTournament();
    const other = await createTournament({ clubId: tournament.clubId });

    const response = await request(tournament.id, { playerId: alice.id, actionType: "addon", tournamentId: other.id });

    expect(response.body.tournamentId).toBe(tournament.id);
    expect(await actionsOf(other.id)).toEqual([]);
  });

  it("answers 400 with the zod issues for a missing or unknown action type, or a bad knockout target (SEC-05)", async () => {
    const { tournament, alice, bob } = await liveTournament();

    for (const [body, field] of [
      [{ playerId: alice.id }, "actionType"],
      [{ playerId: alice.id, actionType: "free money" }, "actionType"],
      [{ playerId: alice.id, actionType: "knockout" }, "targetPlayerId"],
      [{ playerId: alice.id, actionType: "knockout", targetPlayerId: alice.id }, "targetPlayerId"],
      [{ playerId: alice.id, actionType: "rebuy", targetPlayerId: bob.id }, "targetPlayerId"],
    ] as const) {
      const response = await request(tournament.id, body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "Invalid action data", code: "VALIDATION", details: [{ path: [field] }] });
    }
    expect(await actionsOf(tournament.id)).toEqual([]);
  });

  it("checks the request against the tournament (security-40)", async () => {
    const { club, tournament, alice, bob } = await liveTournament({ maxRebuys: 1 });
    const done = await createTournament({ clubId: club.id, status: "completed" });
    const locked = await createTournament({ clubId: club.id, status: "in_progress", prizePoolLocked: true, rebuyAmount: "50.00", addonAmount: "50.00" });
    await createRegistration({ tournamentId: done.id, playerId: alice.id });
    await createRegistration({ tournamentId: locked.id, playerId: alice.id });
    const out = await createPlayer();
    await createRegistration({ tournamentId: tournament.id, playerId: out.id, isEliminated: true });
    const knockedOut = await createPlayer({ name: "Kim" });
    await createRegistration({ tournamentId: tournament.id, playerId: knockedOut.id, isEliminated: true, eliminatedBy: bob.id });
    const noRebuys = await createTournament({ clubId: club.id, status: "in_progress", rebuyAmount: null });
    await createRegistration({ tournamentId: noRebuys.id, playerId: out.id, isEliminated: true });
    // A freezeout: no re-buy or add-on price, so the page never offers either (CQ-P2-05).
    const freezeout = await createTournament({ clubId: club.id, status: "in_progress", rebuyAmount: null, addonAmount: "0.00" });
    await createRegistration({ tournamentId: freezeout.id, playerId: alice.id });
    const capped = await createPlayer();
    await createRegistration({ tournamentId: tournament.id, playerId: capped.id, rebuys: 1 });
    const stranger = await createPlayer();

    const cases = [
      [await request(UNKNOWN_ID, { playerId: alice.id, actionType: "rebuy" }), 404, "NOT_FOUND"],
      [await request(done.id, { playerId: alice.id, actionType: "rebuy" }), 409, "TOURNAMENT_CLOSED"],
      [await request(tournament.id, { playerId: stranger.id, actionType: "rebuy" }), 409, "PLAYER_NOT_REGISTERED"],
      [await request(tournament.id, { playerId: UNKNOWN_ID, actionType: "addon" }), 409, "PLAYER_NOT_REGISTERED"],
      [await request(tournament.id, { playerId: out.id, actionType: "addon" }), 409, "PLAYER_ELIMINATED"],
      [await request(tournament.id, { playerId: out.id, actionType: "knockout", targetPlayerId: alice.id }), 409, "PLAYER_ELIMINATED"],
      [await request(noRebuys.id, { playerId: out.id, actionType: "rebuy" }), 409, "PLAYER_ELIMINATED"],
      [await request(freezeout.id, { playerId: alice.id, actionType: "rebuy" }), 409, "NOT_OFFERED"],
      [await request(freezeout.id, { playerId: alice.id, actionType: "addon" }), 409, "NOT_OFFERED"],
      [await request(locked.id, { playerId: alice.id, actionType: "rebuy" }), 409, "PRIZE_POOL_LOCKED"],
      [await request(locked.id, { playerId: alice.id, actionType: "addon" }), 409, "PRIZE_POOL_LOCKED"],
      [await request(tournament.id, { playerId: capped.id, actionType: "rebuy" }), 409, "MAX_REBUYS_REACHED"],
      [await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: knockedOut.id }), 409, "ALREADY_ELIMINATED"],
      [await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: stranger.id }), 400, "INVALID_TARGET"],
    ] as const;

    for (const [response, status, code] of cases) {
      expect([response.status, response.body.code]).toEqual([status, code]);
    }
    expect(await testDb().select().from(pendingActions)).toEqual([]);
    expect((await request(tournament.id, { playerId: bob.id, actionType: "rebuy" })).status).toBe(201);
  });

  it("says a cancelled tournament was cancelled, not that it finished, like every other closed-tournament refusal (P2REV4-03)", async () => {
    const { tournament, alice } = await liveTournament();
    await testDb().update(tournaments).set({ status: "cancelled" }).where(eq(tournaments.id, tournament.id));

    const response = await request(tournament.id, { playerId: alice.id, actionType: "addon" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "This tournament was cancelled", code: "TOURNAMENT_CLOSED" });
  });

  it("refuses the same request while one is waiting (409 DUPLICATE_PENDING_ACTION), even when sent at once", async () => {
    const { tournament, alice, bob } = await liveTournament();
    const app = await anon();

    const responses = await Promise.all(
      [1, 2, 3].map(() => app.post(`/api/tournaments/${tournament.id}/pending-actions`).send({ playerId: alice.id, actionType: "rebuy" })),
    );
    const differentType = await request(tournament.id, { playerId: alice.id, actionType: "addon" });
    const knockout = await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(responses.find((r) => r.status === 409)?.body.code).toBe("DUPLICATE_PENDING_ACTION");
    expect([differentType.status, knockout.status]).toEqual([201, 201]);
    expect(await actionsOf(tournament.id)).toHaveLength(3);
  });
});

describe("GET /api/tournaments/:id/pending-actions", () => {
  it("lists the tournament's actions oldest first, with both players' public fields only", async () => {
    const { tournament, alice, bob, agent } = await liveTournament();
    const rebuy = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy", timestamp: new Date("2026-03-01T20:00:00Z") });
    const knockout = await insertAction({
      tournamentId: tournament.id,
      playerId: bob.id,
      actionType: "knockout",
      targetPlayerId: alice.id,
      timestamp: new Date("2026-03-01T20:05:00Z"),
    });
    await insertAction({ tournamentId: (await createTournament({ clubId: tournament.clubId })).id, playerId: alice.id, actionType: "addon" });

    const response = await agent.get(`/api/tournaments/${tournament.id}/pending-actions`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { ...(asJson(rebuy) as object), player: publicPlayer(alice), targetPlayer: null },
      { ...(asJson(knockout) as object), player: publicPlayer(bob), targetPlayer: publicPlayer(alice) },
    ]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("is for the club's staff only (SEC-05): 401 anonymous, 403 strangers, 404 unknown tournament", async () => {
    const { club, tournament } = await liveTournament();
    const path = `/api/tournaments/${tournament.id}/pending-actions`;

    expect((await (await anon()).get(path)).status).toBe(401);
    for (const role of CLUB_ROLES) {
      const { agent } = await signInClubRole(role, club.id);
      expect((await agent.get(path)).status).toBe(STAFF_ROLES.includes(role) ? 200 : 403);
    }
    const { agent: admin } = await signIn({ role: "admin" });
    expect((await admin.get(`/api/tournaments/${UNKNOWN_ID}/pending-actions`)).status).toBe(404);
  });
});

describe("POST /api/pending-actions/:id/confirm", () => {
  it("applies a re-buy once: +1, logged, and the request is gone", async () => {
    const { tournament, alice, aliceRegistration, agent } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" });

    const response = await agent.post(`/api/pending-actions/${action.id}/confirm`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      registration: { ...(asJson({ ...aliceRegistration, rebuys: 1 }) as object), player: publicPlayer(alice) },
      reentered: false,
      target: null,
    });
    expect(await actionsOf(tournament.id)).toEqual([]);
    expect(await activityOf(tournament.id)).toEqual([["rebuy", "Alice made 1 re-buy"]]);
  });

  it("applies an add-on", async () => {
    const { tournament, alice, aliceRegistration, agent } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "addon" });

    await agent.post(`/api/pending-actions/${action.id}/confirm`);

    expect((await registrationRow(aliceRegistration.id)).addons).toBe(1);
    expect(await activityOf(tournament.id)).toEqual([["addon", "Alice purchased 1 add-on"]]);
  });

  it("refuses to apply a queued add-on at a tournament that sells none, leaving it to dismiss: never a $0 entry (CQ-P2-05)", async () => {
    const { tournament, alice, aliceRegistration, agent } = await liveTournament({ addonAmount: null });
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "addon" });

    const response = await agent.post(`/api/pending-actions/${action.id}/confirm`);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "NOT_OFFERED", error: "This tournament has no add-ons: dismiss the request instead" });
    expect((await registrationRow(aliceRegistration.id)).addons).toBe(0);
    expect(await actionsOf(tournament.id)).toHaveLength(1);
    expect(await activityOf(tournament.id)).toEqual([]);
  });

  it("applies a knockout: the target is eliminated by the player, who is credited the knockout", async () => {
    const { tournament, alice, bob, aliceRegistration, bobRegistration, agent } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });

    const response = await agent.post(`/api/pending-actions/${action.id}/confirm`);

    expect(response.status).toBe(200);
    expect(response.body.registration).toMatchObject({ id: aliceRegistration.id, knockouts: 1 });
    expect(response.body.target).toMatchObject({ id: bobRegistration.id, isEliminated: true, eliminatedBy: alice.id, player: publicPlayer(bob) });
    expect(await registrationRow(bobRegistration.id)).toMatchObject({ isEliminated: true, eliminatedBy: alice.id, eliminationTime: expect.any(Date) });
    expect(await activityOf(tournament.id)).toEqual([["elimination", "Bob was eliminated by Alice"]]);
  });

  it("applies the request exactly once when it is confirmed twice at once (data-integrity-11)", async () => {
    const { tournament, alice, aliceRegistration, agent } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" });
    const other = await signInClubRole("manager", tournament.clubId);

    const responses = await Promise.all([
      agent.post(`/api/pending-actions/${action.id}/confirm`),
      other.agent.post(`/api/pending-actions/${action.id}/confirm`),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
    expect((await registrationRow(aliceRegistration.id)).rebuys).toBe(1);
  });

  it("refuses what the rules no longer allow and keeps the request pending", async () => {
    const { tournament, alice, bob, agent } = await liveTournament({ maxRebuys: 1 });
    const carol = await createPlayer({ name: "Carol" });
    await createRegistration({ tournamentId: tournament.id, playerId: carol.id });
    const rebuy = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" });
    const knockout = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });
    await testDb().update(tournamentRegistrations).set({ rebuys: 1 }).where(eq(tournamentRegistrations.playerId, alice.id));
    await testDb()
      .update(tournamentRegistrations)
      .set({ isEliminated: true, eliminatedBy: carol.id })
      .where(eq(tournamentRegistrations.playerId, bob.id));

    const maxed = await agent.post(`/api/pending-actions/${rebuy.id}/confirm`);
    const alreadyOut = await agent.post(`/api/pending-actions/${knockout.id}/confirm`);

    expect([maxed.status, maxed.body.code]).toEqual([409, "MAX_REBUYS_REACHED"]);
    expect([alreadyOut.status, alreadyOut.body.code]).toEqual([409, "ALREADY_ELIMINATED"]);
    expect(alreadyOut.body.error).toBe("Bob is already out, knocked out by Carol");
    expect(await actionsOf(tournament.id)).toHaveLength(2);
  });

  describe("knockout claims the table got to first (TN-06)", () => {
    it("credits the claimer when the TD already marked the target out with nobody as eliminator", async () => {
      const { tournament, alice, bob, aliceRegistration, bobRegistration, agent } = await liveTournament();
      const outAt = new Date("2026-03-01T20:00:00Z");
      await testDb()
        .update(tournamentRegistrations)
        .set({ isEliminated: true, eliminationTime: outAt })
        .where(eq(tournamentRegistrations.id, bobRegistration.id));
      // From a phone that still lists Bob: the claim is accepted, not refused.
      const claim = await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });
      expect(claim.status).toBe(201);

      const response = await agent.post(`/api/pending-actions/${claim.body.id}/confirm`);

      expect(response.status).toBe(200);
      expect(await registrationRow(bobRegistration.id)).toMatchObject({ isEliminated: true, eliminatedBy: alice.id, eliminationTime: outAt });
      expect((await registrationRow(aliceRegistration.id)).knockouts).toBe(1);
      expect(await activityOf(tournament.id)).toEqual([["knockout_credited", "Alice is credited with knocking out Bob"]]);
    });

    it("logs Bob going out once when the TD marked him out first and then confirms the claim on him (TN-REV2-03)", async () => {
      const { tournament, alice, bob, bobRegistration, agent } = await liveTournament();
      expect((await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: true })).status).toBe(200);
      const claim = await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });

      expect((await agent.post(`/api/pending-actions/${claim.body.id}/confirm`)).status).toBe(200);

      expect(await activityOf(tournament.id)).toEqual([
        ["elimination", "Bob was eliminated"],
        ["knockout_credited", "Alice is credited with knocking out Bob"],
      ]);
      // The public feed shows both entries, but only one says Bob went out.
      const feed = await (await anon()).get(`/api/tournaments/${tournament.id}/activity`);
      expect((feed.body as Array<{ eventType: string }>).filter((entry) => entry.eventType === "elimination")).toHaveLength(1);
    });

    it("still credits a claimer who went out after asking", async () => {
      const { tournament, alice, bob, aliceRegistration, bobRegistration, agent } = await liveTournament();
      const claim = await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });
      expect(claim.status).toBe(201);
      await testDb()
        .update(tournamentRegistrations)
        .set({ isEliminated: true, eliminationTime: new Date() })
        .where(eq(tournamentRegistrations.id, aliceRegistration.id));

      const response = await agent.post(`/api/pending-actions/${claim.body.id}/confirm`);

      expect(response.status).toBe(200);
      expect(await registrationRow(bobRegistration.id)).toMatchObject({ isEliminated: true, eliminatedBy: alice.id });
      expect((await registrationRow(aliceRegistration.id)).knockouts).toBe(1);
    });

    it("still refuses staff crediting a knockout to someone already out, saying who", async () => {
      const { alice, aliceRegistration, bobRegistration, agent } = await liveTournament();
      await testDb().update(tournamentRegistrations).set({ isEliminated: true }).where(eq(tournamentRegistrations.id, aliceRegistration.id));

      const response = await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: true, eliminatedBy: alice.id });

      expect([response.status, response.body.code]).toEqual([400, "INVALID_TARGET"]);
      expect(response.body.error).toBe("Alice is out of the tournament, so the knockout cannot go to them");
    });
  });

  describe("re-entry: a player who is out buys back in (TN-04)", () => {
    it("takes a re-buy request from a player who is out, and confirming puts them back in without taking the knockout off whoever got them", async () => {
      const { tournament, alice, bob, aliceRegistration, bobRegistration, agent } = await liveTournament();
      const busted = await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: true, eliminatedBy: alice.id });
      expect(busted.status).toBe(200);

      const ask = await request(tournament.id, { playerId: bob.id, actionType: "rebuy" });
      expect(ask.status).toBe(201);
      const response = await agent.post(`/api/pending-actions/${ask.body.id}/confirm`);

      expect(response.status).toBe(200);
      expect(await registrationRow(bobRegistration.id)).toMatchObject({ isEliminated: false, eliminationTime: null, eliminatedBy: null, rebuys: 1 });
      expect((await registrationRow(aliceRegistration.id)).knockouts).toBe(1);
      expect((await activityOf(tournament.id)).map(([eventType]) => eventType)).toEqual(["elimination", "rebuy", "reentry"]);
    });

    it("says whether confirming put the player back in", async () => {
      const { tournament, alice, bob, bobRegistration, agent } = await liveTournament();
      await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: true, eliminatedBy: alice.id });
      const ask = await request(tournament.id, { playerId: bob.id, actionType: "rebuy" });

      const response = await agent.post(`/api/pending-actions/${ask.body.id}/confirm`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, reentered: true, registration: { isEliminated: false, rebuys: 1 } });
    });

    describe("a re-buy asked for while still in, by a player knocked out since (TN-RV2-01)", () => {
      /** Bob asks for a re-buy while still in, then Alice knocks him out before the TD confirms it. */
      async function askThenBust() {
        const live = await liveTournament();
        const ask = await request(live.tournament.id, { playerId: live.bob.id, actionType: "rebuy" });
        expect(ask.status).toBe(201);
        const busted = await live.agent.put(`/api/registrations/${live.bobRegistration.id}`).send({ isEliminated: true, eliminatedBy: live.alice.id });
        expect(busted.status).toBe(200);
        return { ...live, actionId: ask.body.id as string, out: await registrationRow(live.bobRegistration.id) };
      }

      it("is never quietly a re-entry: the TD is asked, and the request waits for the answer", async () => {
        const { tournament, bobRegistration, agent, actionId, out } = await askThenBust();

        const response = await agent.post(`/api/pending-actions/${actionId}/confirm`);

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
          error: "Bob asked for this re-buy before being knocked out. Confirm it as a buy-back to put Bob back in, or just record the re-buy they paid for",
          code: "REBUY_BEFORE_ELIMINATION",
          details: { playerName: "Bob", requestedAt: expect.any(String), eliminatedAt: out.eliminationTime?.toISOString() },
        });
        expect(Date.parse(response.body.details.requestedAt)).toBeLessThanOrEqual(out.eliminationTime!.getTime());
        expect((await actionsOf(tournament.id)).map((action) => action.id)).toEqual([actionId]);
        expect(await registrationRow(bobRegistration.id)).toEqual(out);
      });

      it("records only the re-buy when the TD says the chips came before the bust: Bob stays out, busting when he did", async () => {
        const { tournament, aliceRegistration, bobRegistration, agent, actionId, out } = await askThenBust();

        const response = await agent.post(`/api/pending-actions/${actionId}/confirm`).send({ reenter: false });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ reentered: false, registration: { isEliminated: true, rebuys: 1 } });
        expect(await registrationRow(bobRegistration.id)).toEqual({ ...out, rebuys: 1 });
        expect((await registrationRow(aliceRegistration.id)).knockouts).toBe(1);
        expect((await activityOf(tournament.id)).map(([eventType]) => eventType)).toEqual(["elimination", "rebuy"]);
        expect(await actionsOf(tournament.id)).toEqual([]);
      });

      it("puts Bob back in when the TD says it was his buy-back", async () => {
        const { tournament, bobRegistration, agent, actionId } = await askThenBust();

        const response = await agent.post(`/api/pending-actions/${actionId}/confirm`).send({ reenter: true });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ reentered: true, registration: { isEliminated: false, rebuys: 1 } });
        expect(await registrationRow(bobRegistration.id)).toMatchObject({ isEliminated: false, eliminationTime: null, rebuys: 1 });
        expect((await activityOf(tournament.id)).map(([eventType]) => eventType)).toEqual(["elimination", "rebuy", "reentry"]);
      });

      it("asks too when the elimination has no time recorded (a row from before Phase 2)", async () => {
        const { tournament, bob, bobRegistration, agent } = await liveTournament();
        await testDb()
          .update(tournamentRegistrations)
          .set({ isEliminated: true, eliminationTime: null })
          .where(eq(tournamentRegistrations.id, bobRegistration.id));
        const action = await insertAction({ tournamentId: tournament.id, playerId: bob.id, actionType: "rebuy" });

        const response = await agent.post(`/api/pending-actions/${action.id}/confirm`);

        expect(response.status).toBe(409);
        expect(response.body.details).toMatchObject({ playerName: "Bob", eliminatedAt: null });
      });

      it("takes only `reenter` in the body", async () => {
        const { agent, actionId } = await askThenBust();

        const response = await agent.post(`/api/pending-actions/${actionId}/confirm`).send({ reenter: "yes", force: true });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe("VALIDATION");
      });
    });

    it("re-enters through POST /counts too, while a restore still undoes the knockout (money-25)", async () => {
      const { alice, aliceRegistration, bobRegistration, agent } = await liveTournament();
      await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: true, eliminatedBy: alice.id });

      const reentered = await agent.post(`/api/registrations/${bobRegistration.id}/counts`).send({ rebuys: 1 });
      expect(reentered.status).toBe(200);
      expect(reentered.body).toMatchObject({ isEliminated: false, rebuys: 1 });
      expect((await registrationRow(aliceRegistration.id)).knockouts).toBe(1);

      await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: true, eliminatedBy: alice.id });
      await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: false });
      expect((await registrationRow(aliceRegistration.id)).knockouts).toBe(1);
    });
  });

  it("refuses a re-buy once the pool is locked when the request may have come after the lock, keeping the request", async () => {
    const { tournament, alice, agent } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" });
    // Locked with no lock time on record (as before lock times were stamped): nothing shows the request came first.
    await testDb().update(tournaments).set({ prizePoolLocked: true }).where(eq(tournaments.id, tournament.id));

    const response = await agent.post(`/api/pending-actions/${action.id}/confirm`);

    expect([response.status, response.body.code]).toEqual([409, "PRIZE_POOL_LOCKED"]);
    expect(await actionsOf(tournament.id)).toHaveLength(1);
  });

  it("applies re-buys and add-ons the players asked for before the TD locked the pool (TN2-01)", async () => {
    const { tournament, alice, bob, aliceRegistration, bobRegistration, agent } = await liveTournament();
    const rebuy = await request(tournament.id, { playerId: alice.id, actionType: "rebuy" });
    const addon = await request(tournament.id, { playerId: bob.id, actionType: "addon" });
    // The end of the re-buy break: lock first, then work through the queue.
    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: true })).status).toBe(200);

    const confirmed = [
      await agent.post(`/api/pending-actions/${rebuy.body.id}/confirm`),
      await agent.post(`/api/pending-actions/${addon.body.id}/confirm`),
    ];

    expect(confirmed.map((response) => response.status)).toEqual([200, 200]);
    expect((await registrationRow(aliceRegistration.id)).rebuys).toBe(1);
    expect((await registrationRow(bobRegistration.id)).addons).toBe(1);
    // The lock still refuses anything new: a request, or staff adding one directly.
    expect((await request(tournament.id, { playerId: alice.id, actionType: "rebuy" })).body.code).toBe("PRIZE_POOL_LOCKED");
    expect((await agent.post(`/api/registrations/${aliceRegistration.id}/counts`).send({ rebuys: 1 })).body.code).toBe("PRIZE_POOL_LOCKED");
  });

  it("eliminates a claimed knockout's target at the time of the claim, so a late confirmation keeps the bust order (MONEY-P2REV-03)", async () => {
    const { tournament, alice, bob, aliceRegistration, bobRegistration, agent } = await liveTournament();
    const carol = await createPlayer({ name: "Carol" });
    const carolRegistration = await createRegistration({ tournamentId: tournament.id, playerId: carol.id });
    const dave = await createPlayer({ name: "Dave" });
    const daveRegistration = await createRegistration({ tournamentId: tournament.id, playerId: dave.id });

    // Bob busts first, claimed from Alice's phone; then the TD knocks Carol out directly; then confirms Alice's claim.
    const claim = await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await agent.put(`/api/registrations/${carolRegistration.id}`).send({ isEliminated: true })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await agent.post(`/api/pending-actions/${claim.body.id}/confirm`)).status).toBe(200);

    const bobOut = (await registrationRow(bobRegistration.id)).eliminationTime as Date;
    const carolOut = (await registrationRow(carolRegistration.id)).eliminationTime as Date;
    expect(bobOut.toISOString()).toBe(new Date(claim.body.timestamp).toISOString());
    expect(bobOut.getTime()).toBeLessThan(carolOut.getTime());
    // So Carol, who went out later, finishes above Bob.
    const preview = await agent
      .post(`/api/tournaments/${tournament.id}/finalize/preview`)
      .send({ finishOrder: [daveRegistration.id, aliceRegistration.id] });
    expect(preview.body.rows.map((row: { playerName: string }) => row.playerName)).toEqual(["Dave", "Alice", "Carol", "Bob"]);
  });

  it("clears a knockout claim the TD already recorded exactly, rather than refusing it forever (TN2-02)", async () => {
    const { tournament, alice, bob, aliceRegistration, bobRegistration, agent } = await liveTournament();
    const claim = await request(tournament.id, { playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });
    expect((await agent.put(`/api/registrations/${bobRegistration.id}`).send({ isEliminated: true, eliminatedBy: alice.id })).status).toBe(200);

    const response = await agent.post(`/api/pending-actions/${claim.body.id}/confirm`);

    expect(response.status).toBe(200);
    expect(await actionsOf(tournament.id)).toEqual([]);
    expect((await registrationRow(aliceRegistration.id)).knockouts).toBe(1);
  });

  it.each(CLUB_ROLES)("as the club's %s", async (role) => {
    const { club, tournament, alice } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "addon" });
    const { agent } = await signInClubRole(role, club.id);

    const response = await agent.post(`/api/pending-actions/${action.id}/confirm`);

    expect(response.status).toBe(STAFF_ROLES.includes(role) ? 200 : 403);
    expect(await actionsOf(tournament.id)).toHaveLength(STAFF_ROLES.includes(role) ? 0 : 1);
  });

  it("refuses anonymous visitors and deactivated accounts, and answers 404 for an unknown action", async () => {
    const { club, tournament, alice, agent } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "addon" });
    const deactivated = await signInDeactivatedManager(club.id);

    expect((await (await anon()).post(`/api/pending-actions/${action.id}/confirm`)).status).toBe(401);
    expect((await deactivated.agent.post(`/api/pending-actions/${action.id}/confirm`)).status).toBe(401);
    expect((await agent.post(`/api/pending-actions/${UNKNOWN_ID}/confirm`)).body).toEqual({
      error: "Pending action not found",
      code: "NOT_FOUND",
    });
    expect(await actionsOf(tournament.id)).toHaveLength(1);
  });
});

describe("requests still waiting when the tournament is finalized (TN2-02)", () => {
  it("are cleared by finalize, since none could be applied to a completed tournament, and counted in its audit row", async () => {
    const { tournament, alice, bob, agent } = await liveTournament();
    await request(tournament.id, { playerId: alice.id, actionType: "addon" });
    await request(tournament.id, { playerId: bob.id, actionType: "rebuy" });

    const preview = await agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});
    const order = preview.body.activePlayers.map((player: { registrationId: string }) => player.registrationId);
    const finalized = await agent.post(`/api/tournaments/${tournament.id}/finalize`).send({ finishOrder: order });

    expect(finalized.status).toBe(200);
    expect(await actionsOf(tournament.id)).toEqual([]);
    const [audit] = await testDb().select().from(auditLog).where(eq(auditLog.action, "tournament.finalize"));
    expect(audit.data).toMatchObject({ requestsCleared: 2 });
  });
});

describe("DELETE /api/pending-actions/:id", () => {
  it("dismisses the action without applying it, then answers 404 for it", async () => {
    const { tournament, alice, aliceRegistration, agent } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" });

    const deleted = await agent.delete(`/api/pending-actions/${action.id}`);
    const again = await agent.delete(`/api/pending-actions/${action.id}`);

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: "Pending action not found", code: "NOT_FOUND" });
    expect(await actionsOf(tournament.id)).toEqual([]);
    expect(await registrationRow(aliceRegistration.id)).toEqual(aliceRegistration);
  });

  it("leaves a trace: the audit log says who dismissed what, asked for when (P2REV4-CQ2-09)", async () => {
    const owner = await createUser({ email: "dismisser@example.test" });
    const club = await createClub({ ownerId: owner.id });
    const tournament = await createTournament({ clubId: club.id, status: "in_progress", rebuyAmount: "25.00" });
    const ann = await createPlayer({ name: "Ann" });
    await createRegistration({ tournamentId: tournament.id, playerId: ann.id });
    const action = await insertAction({ tournamentId: tournament.id, playerId: ann.id, actionType: "rebuy" });
    const { agent } = await loginAs({ email: owner.email });

    expect((await agent.delete(`/api/pending-actions/${action.id}`)).status).toBe(200);

    const rows = await testDb().select().from(auditLog).where(eq(auditLog.action, "pending_action.dismiss"));
    expect(rows).toEqual([
      expect.objectContaining({
        actorUserId: owner.id,
        targetType: "tournament",
        targetId: tournament.id,
        data: {
          actionId: action.id,
          actionType: "rebuy",
          playerId: ann.id,
          targetPlayerId: null,
          requestedAt: action.timestamp?.toISOString(),
        },
      }),
    ]);
  });

  it("refuses an anonymous visitor (401) and a stranger (403), and keeps the action (SEC-05)", async () => {
    const { club, tournament, alice } = await liveTournament();
    const action = await insertAction({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" });
    const stranger = await signInClubRole("stranger", club.id);

    const anonymous = await (await anon()).delete(`/api/pending-actions/${action.id}`);
    const notStaff = await stranger.agent.delete(`/api/pending-actions/${action.id}`);

    expect([anonymous.status, notStaff.status]).toEqual([401, 403]);
    expect(await actionsOf(tournament.id)).toEqual([action]);
  });
});
