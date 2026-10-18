/**
 * Characterization of today's activity feed, GET /api/tournaments/:id/activity
 * (server/routes.ts, storage.getActivityLog): newest first, ties broken by id,
 * each entry carrying its full player row or null.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { activityLog } from "@shared/schema";
import { createClub, createPlayer, createTournament, createUser } from "../factories";
import { anon, asJson, loginAs, resetDb, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

/** Postgres' text form of a timestamptz in the session's zone, e.g. "2026-03-01 19:00:00+00" or "...12.345678+13". */
const PG_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

type FeedEntry = { id: string; eventType: string; description: string; timestamp: string };

const feed = async (tournamentId: string) => {
  const response = await (await anon()).get(`/api/tournaments/${tournamentId}/activity`);
  expect(response.status).toBe(200);
  return response.body as FeedEntry[];
};

describe("GET /api/tournaments/:tournamentId/activity", () => {
  it("returns entries newest first, each with its full player row or null", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const alice = await createPlayer({ name: "Alice" });
    const [older, newest, middle] = await testDb()
      .insert(activityLog)
      .values([
        { tournamentId: tournament.id, playerId: alice.id, eventType: "registration", description: "Alice registered for the tournament", timestamp: "2026-03-01T18:00:00Z" },
        { tournamentId: tournament.id, eventType: "status_change", description: "Tournament status changed to In Progress", timestamp: "2026-03-01T19:00:00Z" },
        { tournamentId: tournament.id, playerId: alice.id, eventType: "payment_confirmed", description: "Payment confirmed for Alice", eventData: '{"note":"cash"}', timestamp: "2026-03-01T18:30:00Z" },
      ])
      .returning();

    const entries = await feed(tournament.id);

    expect(entries).toEqual([
      { ...(asJson(newest) as object), player: null },
      { ...(asJson(middle) as object), player: asJson(alice) },
      { ...(asJson(older) as object), player: asJson(alice) },
    ]);
    expect(entries.map((entry) => Date.parse(entry.timestamp))).toEqual([
      Date.parse("2026-03-01T19:00:00Z"),
      Date.parse("2026-03-01T18:30:00Z"),
      Date.parse("2026-03-01T18:00:00Z"),
    ]);
  });

  it("serves timestamps in Postgres' text form, not ISO 8601, and eventData as the stored JSON string", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    await testDb().insert(activityLog).values({
      tournamentId: tournament.id,
      eventType: "high_hand",
      description: "Alice won high hand ($150)",
      eventData: '{"amount":"150"}',
      timestamp: "2026-03-01T19:00:00Z",
    });

    const [entry] = await feed(tournament.id);

    expect(entry.timestamp).toMatch(PG_TIMESTAMPTZ);
    expect(entry).toMatchObject({ eventData: '{"amount":"150"}' });
  });

  it("breaks timestamp ties by id, highest first", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const at = "2026-03-01T19:00:00Z";
    await testDb()
      .insert(activityLog)
      .values(
        ["a-entry", "c-entry", "b-entry"].map((id) => ({ id, tournamentId: tournament.id, eventType: "rebuy", description: id, timestamp: at })),
      );

    expect((await feed(tournament.id)).map((entry) => entry.id)).toEqual(["c-entry", "b-entry", "a-entry"]);
  });

  it("shows what the director's actions logged, most recent first, and nothing from other tournaments", async () => {
    const owner = await createUser();
    const club = await createClub({ ownerId: owner.id });
    const tournament = await createTournament({ clubId: club.id, status: "registration", rebuyAmount: "50.00" });
    const other = await createTournament({ clubId: club.id });
    const alice = await createPlayer({ name: "Alice" });
    const bob = await createPlayer({ name: "Bob" });
    const { agent } = await loginAs({ email: owner.email });
    const register = async (tournamentId: string, playerId: string) =>
      (await agent.post(`/api/tournaments/${tournamentId}/registrations`).send({ playerId })).body.id as string;

    const aliceRegistration = await register(tournament.id, alice.id);
    await register(tournament.id, bob.id);
    await register(other.id, alice.id);
    await agent.patch(`/api/registrations/${aliceRegistration}/confirm-payment`);
    await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "in_progress" });
    await agent.put(`/api/registrations/${aliceRegistration}`).send({ rebuys: 1 });
    await agent
      .put(`/api/registrations/${aliceRegistration}`)
      .send({ isEliminated: true, eliminationTime: "2026-03-01T21:00:00.000Z", eliminatedBy: bob.id });

    const entries = await feed(tournament.id);

    expect(entries.map(({ eventType, description }) => [eventType, description])).toEqual([
      ["elimination", "Alice was eliminated by Bob"],
      ["rebuy", "Alice made 1 re-buy"],
      ["status_change", "Tournament status changed to In Progress"],
      ["payment_confirmed", "Payment confirmed for Alice"],
      ["registration", "Bob registered for the tournament"],
      ["registration", "Alice registered for the tournament"],
    ]);
    const timestamps = entries.map((entry) => Date.parse(entry.timestamp));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("returns an empty list for an unknown tournament", async () => {
    expect(await feed(UNKNOWN_ID)).toEqual([]);
  });
});
