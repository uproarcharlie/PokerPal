/**
 * Characterization of today's tournament API (server/routes.ts): create, read,
 * list with confirmedPlayerCount, PUT with its ownership check and activity log
 * entries, the PATCH twin, and delete. Finalize lives in finalize.api.test.ts.
 *
 * `it.fails` tests state the correct behaviour for a known hole, tagged with
 * its audit finding id. They pass while the hole is open; when it is fixed,
 * Vitest reports them as failing, so switch them to `it` and delete the
 * "today" test beside them.
 */
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { activityLog, tournamentRegistrations, tournaments } from "@shared/schema";
import {
  createClub,
  createPlayer,
  createRegistration,
  createSeason,
  createTournament,
  createUser,
  type NewTournament,
} from "../factories";
import { anon, asJson, getApp, loginAs, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

/** A tournament in a club owned by a signed-in user, who can manage it. */
async function ownedTournament(overrides: Partial<NewTournament> = {}) {
  const owner = await createUser();
  const club = await createClub({ ownerId: owner.id });
  const tournament = await createTournament({ clubId: club.id, ...overrides });
  const { agent } = await loginAs({ email: owner.email });
  return { owner, club, tournament, agent };
}

const tournamentRow = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

const activityFor = async (tournamentId: string) =>
  (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)))
    .sort((a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp)))
    .map(({ eventType, description, playerId, eventData }) => ({ eventType, description, playerId, eventData }));

describe("POST /api/tournaments", () => {
  it("creates a tournament from the form's payload, storing money as decimal strings and filling the defaults", async () => {
    const owner = await createUser();
    const club = await createClub({ ownerId: owner.id });
    const { agent } = await loginAs({ email: owner.email });

    const response = await agent.post("/api/tournaments").send({
      name: "Friday Freezeout",
      clubId: club.id,
      startDateTime: "2026-05-01T07:00:00.000Z",
      buyInAmount: 50,
      rebuyAmount: "25",
      maxPlayers: 40,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Friday Freezeout",
      description: null,
      imageUrl: null,
      clubId: club.id,
      seasonId: null,
      pointsSystemId: null,
      startDateTime: "2026-05-01T07:00:00.000Z",
      status: "scheduled",
      buyInAmount: "50.00",
      rebuyAmount: "25.00",
      addonAmount: null,
      maxRebuys: null,
      rebuyPeriodMinutes: null,
      rakeType: "none",
      rakeAmount: "0.00",
      rebuyRakeType: "none",
      rebuyRakeAmount: "0.00",
      addonRakeType: "none",
      addonRakeAmount: "0.00",
      payoutStructure: "standard",
      customPayouts: null,
      enableHighHand: false,
      highHandAmount: null,
      highHandRakeType: "none",
      highHandRakeAmount: "0.00",
      highHandPayouts: 1,
      enableLateRegistration: false,
      trackPoints: true,
      minPlayers: 8,
      maxPlayers: 40,
      prizePoolLocked: false,
      prizePoolLockedAt: null,
      manualPrizePool: null,
      useClubAddress: true,
      address: null,
      createdAt: expect.any(String),
    });
    expect(asJson(await tournamentRow(response.body.id))).toEqual(response.body);
  });

  it("answers 400 with the zod issues when the payload is invalid", async () => {
    const club = await createClub();
    const { agent } = await signIn();

    const response = await agent
      .post("/api/tournaments")
      .send({ clubId: club.id, startDateTime: "not a date", buyInAmount: 50, maxPlayers: 40, rakeType: "lots" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid tournament data");
    expect(response.body.details.map((issue: { path: string[] }) => issue.path.join("."))).toEqual([
      "name",
      "startDateTime",
      "rakeType",
    ]);
  });

  it("answers 500 when the club does not exist", async () => {
    const { agent } = await signIn();

    const response = await agent
      .post("/api/tournaments")
      .send({ name: "Orphan", clubId: UNKNOWN_ID, startDateTime: "2026-05-01T07:00:00.000Z", buyInAmount: 50, maxPlayers: 9 });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to create tournament" });
  });

  describe("known bug SEC-02 / security-08: anyone can create a tournament in any club", () => {
    const payload = (clubId: string) => ({
      name: "Planted",
      clubId,
      startDateTime: "2026-05-01T07:00:00.000Z",
      buyInAmount: 50,
      maxPlayers: 9,
    });

    it("today: an anonymous visitor creates one", async () => {
      const club = await createClub();

      const response = await (await anon()).post("/api/tournaments").send(payload(club.id));

      expect(response.status).toBe(201);
      expect(await tournamentRow(response.body.id)).toMatchObject({ clubId: club.id });
    });

    it.fails("refuses an anonymous visitor (401) and creates nothing", async () => {
      const club = await createClub();

      const response = await (await anon()).post("/api/tournaments").send(payload(club.id));

      expect(response.status).toBe(401);
      expect(await testDb().select().from(tournaments)).toEqual([]);
    });

    it.fails("refuses a signed-in user who does not own the club (403)", async () => {
      const club = await createClub({ ownerId: (await createUser()).id });
      const { agent } = await signIn();

      const response = await agent.post("/api/tournaments").send(payload(club.id));

      expect(response.status).toBe(403);
      expect(await testDb().select().from(tournaments)).toEqual([]);
    });
  });
});

describe("GET /api/tournaments/:id", () => {
  it("returns the stored row, without a confirmedPlayerCount", async () => {
    const club = await createClub();
    const tournament = await createTournament({ clubId: club.id, rakeType: "percentage", rakeAmount: "10.00" });
    await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id, paymentConfirmed: true });

    const response = await (await anon()).get(`/api/tournaments/${tournament.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asJson(tournament));
    expect(response.body).not.toHaveProperty("confirmedPlayerCount");
  });

  it("answers 404 for an unknown id", async () => {
    const response = await (await anon()).get(`/api/tournaments/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found" });
  });
});

describe("GET /api/tournaments", () => {
  it("lists every tournament with confirmedPlayerCount, which counts only confirmed payments", async () => {
    const club = await createClub();
    const busy = await createTournament({ clubId: club.id, name: "Busy" });
    const empty = await createTournament({ clubId: club.id, name: "Empty" });
    for (const paymentConfirmed of [true, true, false, true, false]) {
      await createRegistration({ tournamentId: busy.id, playerId: (await createPlayer()).id, paymentConfirmed });
    }

    const response = await (await anon()).get("/api/tournaments");

    expect(response.status).toBe(200);
    const listed = [...(response.body as Array<{ name: string }>)].sort((a, b) => a.name.localeCompare(b.name));
    expect(listed).toEqual([
      { ...(asJson(busy) as object), confirmedPlayerCount: 3 },
      { ...(asJson(empty) as object), confirmedPlayerCount: 0 },
    ]);
  });

  it("filters by clubId or seasonId, and clubId wins when both are given", async () => {
    const clubA = await createClub();
    const clubB = await createClub();
    const seasonB = await createSeason({ clubId: clubB.id });
    const inA = await createTournament({ clubId: clubA.id });
    const inBSeason = await createTournament({ clubId: clubB.id, seasonId: seasonB.id });
    await createTournament({ clubId: clubB.id });
    const app = await getApp();
    const ids = async (query: string) =>
      ((await request(app).get(`/api/tournaments${query}`)).body as Array<{ id: string }>).map((t) => t.id).sort();

    expect(await ids(`?clubId=${clubA.id}`)).toEqual([inA.id]);
    expect(await ids(`?seasonId=${seasonB.id}`)).toEqual([inBSeason.id]);
    expect(await ids(`?clubId=${clubA.id}&seasonId=${seasonB.id}`)).toEqual([inA.id]);
    expect(await ids(`?clubId=${UNKNOWN_ID}`)).toEqual([]);
  });
});

describe("PUT /api/tournaments/:id", () => {
  it("answers 401 to anonymous visitors", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });

    const response = await (await anon()).put(`/api/tournaments/${tournament.id}`).send({ name: "Hijacked" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect((await tournamentRow(tournament.id)).name).toBe(tournament.name);
  });

  it("answers 403 to a signed-in user who does not own the club", async () => {
    const { tournament } = await ownedTournament();
    const { agent } = await signIn();

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ name: "Hijacked" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "You don't have permission to update this tournament" });
    expect((await tournamentRow(tournament.id)).name).toBe(tournament.name);
  });

  it("answers 403 to a full member when the club has no owner", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const { agent } = await signIn();

    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ name: "Mine now" })).status).toBe(403);
  });

  it("lets the club owner update fields and returns the updated row", async () => {
    const { tournament, agent } = await ownedTournament();

    const response = await agent
      .put(`/api/tournaments/${tournament.id}`)
      .send({ name: "Renamed", buyInAmount: 75, manualPrizePool: "1200", rakeType: "fixed", rakeAmount: 5 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...(asJson(tournament) as object),
      name: "Renamed",
      buyInAmount: "75.00",
      manualPrizePool: "1200.00",
      rakeType: "fixed",
      rakeAmount: "5.00",
    });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("lets an admin update a tournament in a club they do not own", async () => {
    const { tournament } = await ownedTournament();
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ name: "Admin edit" });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("Admin edit");
  });

  it("answers 404 for an unknown tournament", async () => {
    const { agent } = await signIn();

    const response = await agent.put(`/api/tournaments/${UNKNOWN_ID}`).send({ name: "Nobody" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found" });
  });

  it("answers 400 with the zod issues for an invalid change", async () => {
    const { tournament, agent } = await ownedTournament();

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ payoutStructure: "winner_takes_all" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid tournament data", details: [{ path: ["payoutStructure"] }] });
  });

  it.each([
    ["registration", "Registration Open"],
    ["in_progress", "In Progress"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
    ["paused", "paused"],
  ])("logs a status change to %s as %j", async (status, label) => {
    const { tournament, agent } = await ownedTournament({ status: "scheduled" });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ status });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(status);
    expect(await activityFor(tournament.id)).toEqual([
      { eventType: "status_change", description: `Tournament status changed to ${label}`, playerId: null, eventData: null },
    ]);
  });

  it("labels a change back to scheduled", async () => {
    const { tournament, agent } = await ownedTournament({ status: "registration" });

    await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "scheduled" });

    expect((await activityFor(tournament.id)).map((entry) => entry.description)).toEqual([
      "Tournament status changed to Scheduled",
    ]);
  });

  it("does not log when the status is resent unchanged", async () => {
    const { tournament, agent } = await ownedTournament({ status: "in_progress" });

    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "in_progress" })).status).toBe(200);
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("logs locking the prize pool once, does not stamp prizePoolLockedAt itself, and does not log unlocking", async () => {
    const { tournament, agent } = await ownedTournament();
    const lock = { eventType: "prize_pool_locked", description: "Prize pool has been locked - no further registrations, rebuys, or addons allowed", playerId: null, eventData: null };

    const locked = await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: true });
    await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: true });
    const unlocked = await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: false });

    expect(locked.body).toMatchObject({ prizePoolLocked: true, prizePoolLockedAt: null });
    expect(unlocked.body.prizePoolLocked).toBe(false);
    expect(await activityFor(tournament.id)).toEqual([lock]);
  });

  it("logs a status change and a lock sent together as two entries", async () => {
    const { tournament, agent } = await ownedTournament({ status: "registration" });

    await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "in_progress", prizePoolLocked: true });

    expect((await activityFor(tournament.id)).map((entry) => entry.eventType).sort()).toEqual([
      "prize_pool_locked",
      "status_change",
    ]);
  });
});

describe("PATCH /api/tournaments/:id", () => {
  it("updates the row like PUT but writes no activity log", async () => {
    const { tournament, agent } = await ownedTournament({ status: "registration" });

    const response = await agent.patch(`/api/tournaments/${tournament.id}`).send({ status: "in_progress", prizePoolLocked: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...(asJson(tournament) as object), status: "in_progress", prizePoolLocked: true });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("answers 404 for an unknown tournament", async () => {
    const { agent } = await signIn();

    const response = await agent.patch(`/api/tournaments/${UNKNOWN_ID}`).send({ name: "Nobody" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found" });
  });

  describe("known bug SEC-02 / security-08: anyone can rewrite a tournament through PATCH", () => {
    it("today: an anonymous visitor unlocks the prize pool and sets a manual pool", async () => {
      const { tournament } = await ownedTournament({ prizePoolLocked: true });

      const response = await (await anon())
        .patch(`/api/tournaments/${tournament.id}`)
        .send({ prizePoolLocked: false, manualPrizePool: "5000" });

      expect(response.status).toBe(200);
      expect(await tournamentRow(tournament.id)).toMatchObject({ prizePoolLocked: false, manualPrizePool: "5000.00" });
    });

    it.fails("refuses an anonymous visitor (401) and leaves the tournament alone", async () => {
      const { tournament } = await ownedTournament({ prizePoolLocked: true });

      const response = await (await anon())
        .patch(`/api/tournaments/${tournament.id}`)
        .send({ prizePoolLocked: false, manualPrizePool: "5000" });

      expect(response.status).toBe(401);
      expect(await tournamentRow(tournament.id)).toMatchObject({ prizePoolLocked: true, manualPrizePool: null });
    });
  });
});

describe("DELETE /api/tournaments/:id", () => {
  it("answers 401 to anonymous visitors", async () => {
    const { tournament } = await ownedTournament();

    const response = await (await anon()).delete(`/api/tournaments/${tournament.id}`);

    expect(response.status).toBe(401);
    expect(await tournamentRow(tournament.id)).toBeDefined();
  });

  it("answers 403 to a signed-in user who does not own the club", async () => {
    const { tournament } = await ownedTournament();
    const { agent } = await signIn();

    const response = await agent.delete(`/api/tournaments/${tournament.id}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "You don't have permission to delete this tournament" });
    expect(await tournamentRow(tournament.id)).toBeDefined();
  });

  it("lets the owner delete it, cascading to its registrations and activity log", async () => {
    const { tournament, agent } = await ownedTournament();
    const player = await createPlayer();
    await createRegistration({ tournamentId: tournament.id, playerId: player.id });
    await testDb().insert(activityLog).values({ tournamentId: tournament.id, eventType: "registration", description: "x" });

    const response = await agent.delete(`/api/tournaments/${tournament.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: "Tournament deleted successfully" });
    expect((await (await anon()).get(`/api/tournaments/${tournament.id}`)).status).toBe(404);
    expect(await testDb().select().from(tournamentRegistrations)).toEqual([]);
    expect(await testDb().select().from(activityLog)).toEqual([]);
  });

  it("lets an admin delete a tournament in a club they do not own", async () => {
    const { tournament } = await ownedTournament();
    const { agent } = await signIn({ role: "admin" });

    expect((await agent.delete(`/api/tournaments/${tournament.id}`)).status).toBe(200);
    expect(await tournamentRow(tournament.id)).toBeUndefined();
  });

  it("answers 404 for an unknown tournament", async () => {
    const { agent } = await signIn();

    const response = await agent.delete(`/api/tournaments/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found" });
  });
});
