/**
 * A tournament's activity feed, GET /api/tournaments/:id/activity (server/routes/activity.ts): public,
 * newest first with ties broken by id, at most `limit` entries, each with only its player's public
 * fields (SEC-09) and in one query (perf-23). Staff bookkeeping (payment confirmations, AP rate
 * changes) is shown only to people who can manage the tournament's club.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys, PUBLIC_ACTIVITY_FIELDS } from "@shared/api/public";
import { activityLog, tournamentRegistrations, type ActivityLog } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, createUser } from "../factories";
import { anon, asJson, resetDb, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

/** Postgres' text form of a timestamptz in the session's zone, e.g. "2026-03-01 19:00:00+00" or "...12.345678+13". */
const PG_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

type FeedEntry = ActivityLog & { player: { id: string; name: string; imageUrl: string | null } | null };

const feed = async (tournamentId: string, query = "") => {
  const response = await (await anon()).get(`/api/tournaments/${tournamentId}/activity${query}`);
  expect(response.status).toBe(200);
  return response.body as FeedEntry[];
};

const log = (tournamentId: string, eventType: string, timestamp: string, extra: Partial<typeof activityLog.$inferInsert> = {}) =>
  testDb().insert(activityLog).values({ tournamentId, eventType, description: `${eventType} at ${timestamp}`, timestamp, ...extra });

describe("GET /api/tournaments/:id/activity", () => {
  it("returns entries newest first, each with the player's public fields or null", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const alice = await createPlayer({ name: "Alice", imageUrl: "/uploads/alice.webp" });
    const [older, newest, middle] = await testDb()
      .insert(activityLog)
      .values([
        { tournamentId: tournament.id, playerId: alice.id, eventType: "registration", description: "Alice registered for the tournament", timestamp: "2026-03-01T18:00:00Z" },
        { tournamentId: tournament.id, eventType: "status_change", description: "Tournament status changed to In Progress", timestamp: "2026-03-01T19:00:00Z" },
        { tournamentId: tournament.id, playerId: alice.id, eventType: "rebuy", description: "Alice made 1 re-buy", eventData: '{"count":1}', timestamp: "2026-03-01T18:30:00Z" },
      ])
      .returning();
    const publicAlice = { id: alice.id, name: "Alice", imageUrl: "/uploads/alice.webp" };

    const entries = await feed(tournament.id);

    expect(entries).toEqual([
      { ...(asJson(newest) as object), player: null },
      { ...(asJson(middle) as object), player: publicAlice },
      { ...(asJson(older) as object), player: publicAlice },
    ]);
    expect(entries.map((entry) => Date.parse(entry.timestamp ?? ""))).toEqual([
      Date.parse("2026-03-01T19:00:00Z"),
      Date.parse("2026-03-01T18:30:00Z"),
      Date.parse("2026-03-01T18:00:00Z"),
    ]);
  });

  it("never carries a player's email, phone or linked account (SEC-09)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const account = await createUser();
    const alice = await createPlayer({ name: "Alice", email: "alice@example.test", phone: "021 555 0101", userId: account.id });
    await log(tournament.id, "registration", "2026-03-01T18:00:00Z", { playerId: alice.id });

    const entries = await feed(tournament.id);

    expect(findForbiddenKeys(entries)).toEqual([]);
    const body = JSON.stringify(entries);
    for (const secret of ["alice@example.test", "021 555 0101", account.id]) expect(body).not.toContain(secret);
  });

  it("serves timestamps in Postgres' text form, not ISO 8601, and eventData as the stored JSON string", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    await log(tournament.id, "high_hand", "2026-03-01T19:00:00Z", { eventData: '{"amount":"150"}' });

    const [entry] = await feed(tournament.id);

    expect(entry.timestamp).toMatch(PG_TIMESTAMPTZ);
    expect(entry).toMatchObject({ eventData: '{"amount":"150"}' });
  });

  it("breaks timestamp ties by id, highest first", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const at = "2026-03-01T19:00:00Z";
    await testDb()
      .insert(activityLog)
      .values(["a-entry", "c-entry", "b-entry"].map((id) => ({ id, tournamentId: tournament.id, eventType: "rebuy", description: id, timestamp: at })));

    expect((await feed(tournament.id)).map((entry) => entry.id)).toEqual(["c-entry", "b-entry", "a-entry"]);
  });

  it("returns the newest `limit` entries, 1000 unless asked, and refuses a malformed limit", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    for (const hour of [10, 11, 12]) await log(tournament.id, "rebuy", `2026-03-01T${hour}:00:00Z`);

    expect((await feed(tournament.id, "?limit=2")).map((entry) => entry.description)).toEqual([
      "rebuy at 2026-03-01T12:00:00Z",
      "rebuy at 2026-03-01T11:00:00Z",
    ]);
    expect(await feed(tournament.id)).toHaveLength(3);
    for (const limit of ["0", "2001", "lots"]) {
      const response = await (await anon()).get(`/api/tournaments/${tournament.id}/activity?limit=${limit}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION");
    }
  });

  it("keeps the start of a big night: 320 entries all come back by default (TN-08)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const start = Date.parse("2026-03-01T18:00:00Z");
    await testDb()
      .insert(activityLog)
      .values(
        Array.from({ length: 320 }, (_, i) => ({
          tournamentId: tournament.id,
          eventType: i === 0 ? "registration" : "rebuy",
          description: `entry ${i}`,
          timestamp: new Date(start + i * 1000).toISOString(),
        })),
      );

    const entries = await feed(tournament.id);

    expect(entries).toHaveLength(320);
    expect(entries.at(-1)?.description).toBe("entry 0");
  });

  it("shows staff bookkeeping only to people who can manage the tournament's club", async () => {
    const staff = await clubWithStaff();
    const tournament = await createTournament({ clubId: staff.club.id });
    await log(tournament.id, "registration", "2026-03-01T18:00:00Z");
    await log(tournament.id, "payment_confirmed", "2026-03-01T18:05:00Z");
    await log(tournament.id, "rake_rates_changed", "2026-03-01T18:10:00Z");
    const types = async (agent: { get: (url: string) => PromiseLike<{ body: FeedEntry[] }> }) =>
      (await agent.get(`/api/tournaments/${tournament.id}/activity`)).body.map((entry) => entry.eventType);

    expect(await types(await anon())).toEqual(["registration"]);
    expect(await types(staff.stranger.agent)).toEqual(["registration"]);
    expect(await types(staff.deactivated.agent)).toEqual(["registration"]);
    for (const member of [staff.manager, staff.owner, staff.admin]) {
      expect(await types(member.agent)).toEqual(["rake_rates_changed", "payment_confirmed", "registration"]);
    }
  });

  it("shows what the director's actions logged, most recent first, and nothing from other tournaments", async () => {
    const staff = await clubWithStaff();
    const tournament = await createTournament({ clubId: staff.club.id, status: "registration" });
    const other = await createTournament({ clubId: staff.club.id, status: "registration" });
    const [winner, runnerUp] = [await createPlayer(), await createPlayer()];
    await createRegistration({ tournamentId: tournament.id, playerId: winner.id, paymentConfirmed: true });
    const busted = await createRegistration({ tournamentId: tournament.id, playerId: runnerUp.id, paymentConfirmed: true });
    const agent = staff.owner.agent;

    await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "in_progress" });
    await agent.put(`/api/tournaments/${other.id}`).send({ status: "in_progress" });
    await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: true });
    await agent.put(`/api/tournaments/${tournament.id}/prize-pool/adjustment`).send({ mode: "ap_override", amount: 5, reason: "Low turnout" });
    await testDb()
      .update(tournamentRegistrations)
      .set({ isEliminated: true, eliminationTime: new Date() })
      .where(eq(tournamentRegistrations.id, busted.id));
    expect((await agent.post(`/api/tournaments/${tournament.id}/finalize`)).status).toBe(200);

    const entries = await feed(tournament.id);

    expect(entries.map(({ eventType, description }) => [eventType, description])).toEqual([
      ["status_change", "Tournament finalized - positions, prizes, and points assigned"],
      ["prize_pool_adjusted", "Rake set manually to $5 (the rates give $0) - Low turnout"],
      ["prize_pool_locked", "Prize pool has been locked - no further registrations, rebuys, or addons allowed"],
      ["status_change", "Tournament status changed to In Progress"],
    ]);
    expect(findForbiddenKeys(entries)).toEqual([]);
    expect(JSON.stringify(entries)).not.toContain(staff.owner.user.id);
  });

  it("leaves a seating change's moves and undo record out of the feed, for staff too, keeping its figures (P4REV3-LOAD-02)", async () => {
    const staff = await clubWithStaff();
    const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress" });
    for (const name of ["Ana", "Ben", "Cat", "Dan"]) {
      await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer({ name })).id, paymentConfirmed: true });
    }
    const setUp = await staff.manager.agent.post(`/api/tournaments/${tournament.id}/seating/setup`).send({ seatCount: 2 });
    expect(setUp.status, JSON.stringify(setUp.body)).toBe(201);
    const stored = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournament.id));
    const drawn = stored.find((entry) => entry.eventType === "seating_drawn");
    expect(Object.keys(JSON.parse(drawn?.eventData ?? "{}")).sort()).toEqual(["moves", "players", "scope", "undo"]);
    // Rows that are not JSON objects pass through as they are.
    await log(tournament.id, "seating_balanced", "2026-03-01T18:00:00Z", { eventData: "not json" });
    await log(tournament.id, "seat_assigned", "2026-03-01T18:01:00Z", { eventData: '{"registrationId":"r1","from":null}' });

    for (const agent of [await anon(), staff.manager.agent]) {
      const entries = (await agent.get(`/api/tournaments/${tournament.id}/activity`)).body as FeedEntry[];
      const data = Object.fromEntries(entries.map((entry) => [entry.eventType, entry.eventData]));
      expect(JSON.parse(data.seating_drawn ?? "{}")).toEqual({ scope: "unseated", players: 4 });
      expect(data.seating_balanced).toBe("not json");
      expect(data.seat_assigned).toBe('{"registrationId":"r1","from":null}');
      expect(JSON.stringify(entries)).not.toContain(setUp.body.seating.tables[0].id);
    }
    // The TD still sees every move of the last change.
    const seating = await staff.manager.agent.get(`/api/tournaments/${tournament.id}/seating`);
    expect(seating.body.lastChange).toMatchObject({ eventType: "seating_drawn", canUndo: true });
    expect(seating.body.lastChange.moves).toHaveLength(4);
  });

  it("sends only the allowlisted columns, so a column added to activity_log later stays private (P2REV4-CQ-03)", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    await log(tournament.id, "registration", "2026-03-01T18:00:00Z");

    const [entry] = await feed(tournament.id);

    expect(Object.keys(entry).sort()).toEqual([...PUBLIC_ACTIVITY_FIELDS, "player"].sort());
  });

  it("returns an empty list for an unknown tournament", async () => {
    expect(await feed(UNKNOWN_ID)).toEqual([]);
  });
});
