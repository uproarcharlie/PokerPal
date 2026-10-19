/**
 * The season API (server/routes/seasons.ts): public list and read; create and update by the club's
 * staff; delete by its owner or an admin (SEC-03); what a delete takes with it; open-ended seasons
 * (DATA-22).
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog, pointsAllocations, pointsSystems, seasons, tournaments } from "@shared/schema";
import { findForbiddenKeys } from "@shared/api/public";
import {
  createClub,
  createPointsAllocations,
  createPointsSystem,
  createSeason,
  createTournament,
  createUser,
} from "../factories";
import { anon, asJson, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const seasonRow = async (id: string) => (await testDb().select().from(seasons).where(eq(seasons.id, id)))[0];

const UNAUTHENTICATED = { error: "Authentication required", code: "UNAUTHENTICATED" };

/** A signed-in member and a club they own. */
async function clubOwner() {
  const signedIn = await signIn();
  const club = await createClub({ ownerId: signedIn.user.id });
  return { ...signedIn, club };
}

describe("GET /api/seasons", () => {
  it("lists every season of every club, oldest first, when no clubId is given", async () => {
    const [clubA, clubB] = [await createClub(), await createClub()];
    const ongoing = await createSeason({ clubId: clubB.id, name: "B Ongoing", endDate: null, isActive: false, createdAt: new Date("2026-01-01") });
    const spring = await createSeason({ clubId: clubA.id, name: "A Spring", createdAt: new Date("2026-02-01") });

    const response = await (await anon()).get("/api/seasons");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([asJson(ongoing), asJson(spring)]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("lists only that club's seasons when given ?clubId=", async () => {
    const [club, otherClub] = [await createClub(), await createClub()];
    const season = await createSeason({ clubId: club.id });
    await createSeason({ clubId: otherClub.id });

    const response = await (await anon()).get("/api/seasons").query({ clubId: club.id });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([asJson(season)]);
  });

  it("returns an empty list for an unknown club, and 400 for a malformed club id", async () => {
    await createSeason({ clubId: (await createClub()).id });

    const unknown = await (await anon()).get("/api/seasons").query({ clubId: UNKNOWN_ID });
    const malformed = await (await anon()).get("/api/seasons").query({ clubId: "not an id" });

    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual([]);
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("VALIDATION");
  });
});

describe("GET /api/seasons/:id", () => {
  it("returns the season", async () => {
    const season = await createSeason({ clubId: (await createClub()).id });

    const response = await (await anon()).get(`/api/seasons/${season.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asJson(season));
  });

  it("answers 404 for an unknown season", async () => {
    const response = await (await anon()).get(`/api/seasons/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found", code: "NOT_FOUND" });
  });
});

describe("POST /api/seasons", () => {
  it("requires a signed-in, active user", async () => {
    const { club, deactivated } = await clubWithStaff();

    const response = await (await anon()).post("/api/seasons").send({ name: "2026", clubId: club.id, startDate: "2026-01-01" });
    const fromDeactivated = await deactivated.agent.post("/api/seasons").send({ name: "2026", clubId: club.id, startDate: "2026-01-01" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(fromDeactivated.status).toBe(401);
    expect(await testDb().select().from(seasons)).toEqual([]);
  });

  it("creates a season, parsing date strings and defaulting to active with no end date", async () => {
    const { agent, club } = await clubOwner();

    const response = await agent.post("/api/seasons").send({
      id: "client-chosen-id",
      name: "Winter League",
      clubId: club.id,
      startDate: "2026-06-01T00:00:00.000Z",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Winter League",
      clubId: club.id,
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: null,
      isActive: true,
      createdAt: expect.any(String),
    });
    expect(response.body.id).not.toBe("client-chosen-id");
    expect(asJson(await seasonRow(response.body.id))).toEqual(response.body);
  });

  it("stores an end date and an inactive flag when sent", async () => {
    const { agent, club } = await clubOwner();

    const response = await agent
      .post("/api/seasons")
      .send({ name: "Summer", clubId: club.id, startDate: "2026-01-01", endDate: "2026-03-31", isActive: false });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-03-31T00:00:00.000Z",
      isActive: false,
    });
  });

  it("rejects a body without a name, a club or a valid start date, or ending before it starts", async () => {
    const { agent, club } = await clubOwner();

    for (const [body, field] of [
      [{ clubId: club.id, startDate: "2026-01-01" }, "name"],
      [{ name: "No club", startDate: "2026-01-01" }, "clubId"],
      [{ name: "Bad date", clubId: club.id, startDate: "not a date" }, "startDate"],
      [{ name: "Backwards", clubId: club.id, startDate: "2026-06-01", endDate: "2026-01-01" }, "endDate"],
    ] as const) {
      const response = await agent.post("/api/seasons").send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid season data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await testDb().select().from(seasons)).toEqual([]);
  });

  it("answers 404 when the club does not exist", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.post("/api/seasons").send({ name: "Orphan", clubId: UNKNOWN_ID, startDate: "2026-01-01" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found", code: "NOT_FOUND" });
  });

  it("lets the club's managers and admins create one, and refuses anyone else (SEC-03)", async () => {
    const { club, manager, admin, stranger } = await clubWithStaff();
    const body = { name: "League", clubId: club.id, startDate: "2026-01-01" };

    expect((await manager.agent.post("/api/seasons").send(body)).status).toBe(201);
    expect((await admin.agent.post("/api/seasons").send(body)).status).toBe(201);
    const refused = await stranger.agent.post("/api/seasons").send({ ...body, name: "Planted" });

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "You don't have permission to manage this club", code: "FORBIDDEN" });
    expect((await testDb().select().from(seasons)).map((s) => s.name)).toEqual(["League", "League"]);
  });

  it("saves a blank end date as no end date, not 1 January 1970 (DATA-22)", async () => {
    const { agent, club } = await clubOwner();

    for (const endDate of [null, ""]) {
      const response = await agent.post("/api/seasons").send({ name: "Open-ended", clubId: club.id, startDate: "2026-01-01", endDate });

      expect(response.status).toBe(201);
      expect(response.body.endDate).toBeNull();
      expect((await seasonRow(response.body.id)).endDate).toBeNull();
    }
  });
});

describe("PUT /api/seasons/:id", () => {
  it("updates the fields sent and leaves the rest alone", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id, name: "Old name" });

    const response = await agent
      .put(`/api/seasons/${season.id}`)
      .send({ name: "New name", isActive: false, endDate: "2026-06-30T00:00:00.000Z" });

    expect(response.status).toBe(200);
    const expected = { ...season, name: "New name", isActive: false, endDate: new Date("2026-06-30T00:00:00.000Z") };
    expect(response.body).toEqual(asJson(expected));
    expect(await seasonRow(season.id)).toEqual(expected);
  });

  it("accepts the whole edit form, which resends the season's own club", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id });

    const response = await agent.put(`/api/seasons/${season.id}`).send({
      name: "Renamed",
      clubId: club.id,
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: null,
      isActive: true,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: "Renamed", clubId: club.id, endDate: null });
  });

  it("answers 404 for an unknown season", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/seasons/${UNKNOWN_ID}`).send({ name: "Ghost" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found", code: "NOT_FOUND" });
  });

  it("rejects an invalid body, including an end before the stored start", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id, startDate: new Date("2026-03-01T00:00:00Z") });

    const badDate = await agent.put(`/api/seasons/${season.id}`).send({ startDate: "not a date" });
    const backwards = await agent.put(`/api/seasons/${season.id}`).send({ endDate: "2026-02-01" });

    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("Invalid season data");
    expect(backwards.status).toBe(400);
    expect(backwards.body.details).toEqual([expect.objectContaining({ path: ["endDate"] })]);
    expect(await seasonRow(season.id)).toEqual(season);
  });

  it("requires a signed-in, active user (SEC-03)", async () => {
    const { club, deactivated } = await clubWithStaff();
    const season = await createSeason({ clubId: club.id });

    const response = await (await anon()).put(`/api/seasons/${season.id}`).send({ name: "Vandalised" });
    const fromDeactivated = await deactivated.agent.put(`/api/seasons/${season.id}`).send({ name: "Vandalised" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(fromDeactivated.status).toBe(401);
    expect(await seasonRow(season.id)).toEqual(season);
  });

  it("lets the club's managers and admins update it, and refuses anyone else (SEC-03)", async () => {
    const { club, manager, admin, stranger } = await clubWithStaff();
    const season = await createSeason({ clubId: club.id });

    expect((await manager.agent.put(`/api/seasons/${season.id}`).send({ name: "By manager" })).status).toBe(200);
    expect((await admin.agent.put(`/api/seasons/${season.id}`).send({ name: "By admin" })).status).toBe(200);
    const refused = await stranger.agent.put(`/api/seasons/${season.id}`).send({ name: "Vandalised" });

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "You don't have permission to manage this season", code: "FORBIDDEN" });
    expect((await seasonRow(season.id)).name).toBe("By admin");
  });

  it("does not move a season to another club (SEC-03)", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id });
    const otherClub = await createClub({ ownerId: (await createUser()).id });

    const response = await agent.put(`/api/seasons/${season.id}`).send({ clubId: otherClub.id, name: "Moved" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "A season cannot move to another club", code: "CANNOT_MOVE" });
    expect(await seasonRow(season.id)).toEqual(season);
  });

  it("clears the end date when sent a blank one, instead of saving 1 January 1970 (DATA-22)", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id });

    const response = await agent.put(`/api/seasons/${season.id}`).send({ endDate: null });

    expect(response.status).toBe(200);
    expect(response.body.endDate).toBeNull();
    expect((await seasonRow(season.id)).endDate).toBeNull();
  });
});

describe("DELETE /api/seasons/:id", () => {
  it("deletes the season with its points systems and allocations, unlinks its tournaments, and audits it", async () => {
    const { agent, club, user } = await clubOwner();
    const season = await createSeason({ clubId: club.id });
    const keptSeason = await createSeason({ clubId: club.id });
    const system = await createPointsSystem({ seasonId: season.id });
    await createPointsAllocations(system.id, [{ position: 1, points: 10 }]);
    const keptSystem = await createPointsSystem({ seasonId: keptSeason.id });
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id, pointsSystemId: system.id });

    const response = await agent.delete(`/api/seasons/${season.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    const db = testDb();
    expect(await seasonRow(season.id)).toBeUndefined();
    expect(await db.select().from(pointsSystems)).toEqual([keptSystem]);
    expect(await db.select().from(pointsAllocations)).toEqual([]);
    expect(await db.select().from(tournaments).where(eq(tournaments.id, tournament.id))).toEqual([
      { ...tournament, seasonId: null, pointsSystemId: null },
    ]);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "season.delete"), eq(auditLog.targetId, season.id)))).toEqual([
      expect.objectContaining({ actorUserId: user.id, targetType: "season", data: { name: season.name, clubId: club.id } }),
    ]);
  });

  it("answers 404 for an unknown season", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.delete(`/api/seasons/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found", code: "NOT_FOUND" });
  });

  it("requires a signed-in, active user (SEC-03)", async () => {
    const { club, deactivated } = await clubWithStaff();
    const season = await createSeason({ clubId: club.id });
    await createPointsSystem({ seasonId: season.id });

    const response = await (await anon()).delete(`/api/seasons/${season.id}`);
    const fromDeactivated = await deactivated.agent.delete(`/api/seasons/${season.id}`);

    expect(response.status).toBe(401);
    expect(fromDeactivated.status).toBe(401);
    expect(await seasonRow(season.id)).toEqual(season);
    expect(await testDb().select().from(pointsSystems)).toHaveLength(1);
  });

  it("refuses a stranger and a manager: only the owner or an admin deletes a season (SEC-03)", async () => {
    const { club, manager, stranger, admin } = await clubWithStaff();
    const season = await createSeason({ clubId: club.id });

    for (const who of [stranger, manager]) {
      const response = await who.agent.delete(`/api/seasons/${season.id}`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Only the club's owner or an admin can do that", code: "FORBIDDEN" });
    }
    expect(await seasonRow(season.id)).toEqual(season);
    expect((await admin.agent.delete(`/api/seasons/${season.id}`)).status).toBe(204);
  });
});
