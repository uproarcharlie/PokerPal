/**
 * Characterization of today's pending-action API (server/routes.ts): players
 * request a re-buy, add-on or knockout from their phone (POST, public), the
 * director's screen lists them with both players (GET) and clears them once
 * applied or rejected (DELETE).
 *
 * `it.fails` tests state the correct behaviour for a known hole, tagged with
 * its audit finding id. They pass while the hole is open; when it is fixed,
 * Vitest reports them as failing, so switch them to `it` and delete the
 * "today" test beside them.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pendingActions } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, createUser } from "../factories";
import { anon, asJson, loginAs, resetDb, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

/** An in-progress tournament in a club owned by a signed-in user, with two registered players. */
async function liveTournament() {
  const owner = await createUser();
  const club = await createClub({ ownerId: owner.id });
  const tournament = await createTournament({ clubId: club.id, status: "in_progress", rebuyAmount: "50.00", addonAmount: "50.00" });
  const alice = await createPlayer({ name: "Alice" });
  const bob = await createPlayer({ name: "Bob" });
  for (const player of [alice, bob]) await createRegistration({ tournamentId: tournament.id, playerId: player.id });
  const { agent } = await loginAs({ email: owner.email });
  return { tournament, alice, bob, agent };
}

const actionsOf = (tournamentId: string) =>
  testDb().select().from(pendingActions).where(eq(pendingActions.tournamentId, tournamentId));

describe("POST /api/tournaments/:tournamentId/pending-actions", () => {
  it("records a player's request anonymously", async () => {
    const { tournament, alice } = await liveTournament();

    const response = await (await anon())
      .post(`/api/tournaments/${tournament.id}/pending-actions`)
      .send({ playerId: alice.id, actionType: "rebuy" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      tournamentId: tournament.id,
      playerId: alice.id,
      actionType: "rebuy",
      targetPlayerId: null,
      timestamp: expect.any(String),
    });
    expect(asJson(await actionsOf(tournament.id))).toEqual([response.body]);
  });

  it("records a knockout claim with its target", async () => {
    const { tournament, alice, bob } = await liveTournament();

    const response = await (await anon())
      .post(`/api/tournaments/${tournament.id}/pending-actions`)
      .send({ playerId: alice.id, actionType: "knockout", targetPlayerId: bob.id });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ actionType: "knockout", targetPlayerId: bob.id });
  });

  it("takes the tournament from the path, not the body", async () => {
    const { tournament, alice } = await liveTournament();
    const other = await createTournament({ clubId: tournament.clubId });

    const response = await (await anon())
      .post(`/api/tournaments/${tournament.id}/pending-actions`)
      .send({ playerId: alice.id, actionType: "addon", tournamentId: other.id });

    expect(response.body.tournamentId).toBe(tournament.id);
    expect(await actionsOf(other.id)).toEqual([]);
  });

  it("accepts any action type, a player who is not registered, and a tournament that is not running (SEC-05 / security-40)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id, status: "completed", prizePoolLocked: true });
    const stranger = await createPlayer();

    const response = await (await anon())
      .post(`/api/tournaments/${tournament.id}/pending-actions`)
      .send({ playerId: stranger.id, actionType: "free money" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ playerId: stranger.id, actionType: "free money" });
  });

  it("answers 400 with the zod issues when the action type is missing", async () => {
    const { tournament, alice } = await liveTournament();

    const response = await (await anon()).post(`/api/tournaments/${tournament.id}/pending-actions`).send({ playerId: alice.id });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid action data", details: [{ path: ["actionType"] }] });
  });

  it.each([
    ["the player", (ids: { tournament: string; player: string }) => ({ tournament: ids.tournament, player: UNKNOWN_ID })],
    ["the tournament", (ids: { tournament: string; player: string }) => ({ tournament: UNKNOWN_ID, player: ids.player })],
  ])("answers 500 when %s does not exist", async (_label, pick) => {
    const { tournament, alice } = await liveTournament();
    const target = pick({ tournament: tournament.id, player: alice.id });

    const response = await (await anon())
      .post(`/api/tournaments/${target.tournament}/pending-actions`)
      .send({ playerId: target.player, actionType: "rebuy" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to create pending action" });
  });
});

describe("GET /api/tournaments/:tournamentId/pending-actions", () => {
  it("lists the tournament's actions with the full player and target rows, to anonymous visitors", async () => {
    const { tournament, alice, bob } = await liveTournament();
    const [rebuy] = await testDb().insert(pendingActions).values({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" }).returning();
    const [knockout] = await testDb()
      .insert(pendingActions)
      .values({ tournamentId: tournament.id, playerId: bob.id, actionType: "knockout", targetPlayerId: alice.id })
      .returning();
    const other = await createTournament({ clubId: tournament.clubId });
    await testDb().insert(pendingActions).values({ tournamentId: other.id, playerId: alice.id, actionType: "addon" });

    const response = await (await anon()).get(`/api/tournaments/${tournament.id}/pending-actions`);

    expect(response.status).toBe(200);
    const listed = [...(response.body as Array<{ actionType: string }>)].sort((a, b) => a.actionType.localeCompare(b.actionType));
    expect(listed).toEqual([
      { ...(asJson(knockout) as object), player: asJson(bob), targetPlayer: asJson(alice) },
      { ...(asJson(rebuy) as object), player: asJson(alice), targetPlayer: null },
    ]);
  });

  it("returns an empty list for an unknown tournament", async () => {
    const response = await (await anon()).get(`/api/tournaments/${UNKNOWN_ID}/pending-actions`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("DELETE /api/pending-actions/:id", () => {
  it("removes the action, then answers 404 for it", async () => {
    const { tournament, alice, agent } = await liveTournament();
    const [action] = await testDb().insert(pendingActions).values({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" }).returning();

    const deleted = await agent.delete(`/api/pending-actions/${action.id}`);
    const again = await agent.delete(`/api/pending-actions/${action.id}`);

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: "Pending action not found" });
    expect(await actionsOf(tournament.id)).toEqual([]);
  });

  describe("known bug SEC-05: anyone can clear a pending action", () => {
    it("today: an anonymous visitor deletes one", async () => {
      const { tournament, alice } = await liveTournament();
      const [action] = await testDb().insert(pendingActions).values({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" }).returning();

      const response = await (await anon()).delete(`/api/pending-actions/${action.id}`);

      expect(response.status).toBe(200);
      expect(await actionsOf(tournament.id)).toEqual([]);
    });

    it.fails("refuses an anonymous visitor (401) and keeps the action", async () => {
      const { tournament, alice } = await liveTournament();
      const [action] = await testDb().insert(pendingActions).values({ tournamentId: tournament.id, playerId: alice.id, actionType: "rebuy" }).returning();

      const response = await (await anon()).delete(`/api/pending-actions/${action.id}`);

      expect(response.status).toBe(401);
      expect(await actionsOf(tournament.id)).toEqual([action]);
    });
  });
});
