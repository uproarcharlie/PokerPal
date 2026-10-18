/**
 * Characterization of today's season API (server/routes.ts): list, read,
 * create, update and delete, and what a delete takes with it.
 *
 * Writes that are unauthenticated today are exercised as the club owner or an
 * admin, who keep access once they are locked down. `it.fails` tests state the
 * correct behaviour for a known hole, tagged with its audit finding id; switch
 * them to `it` when the hole is fixed.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pointsAllocations, pointsSystems, seasons, tournaments } from "@shared/schema";
import {
  createClub,
  createPointsAllocations,
  createPointsSystem,
  createSeason,
  createTournament,
  createUser,
} from "../factories";
import { anon, asJson, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const seasonRow = async (id: string) => (await testDb().select().from(seasons).where(eq(seasons.id, id)))[0];

/** A signed-in member and a club they own. */
async function clubOwner() {
  const signedIn = await signIn();
  const club = await createClub({ ownerId: signedIn.user.id });
  return { ...signedIn, club };
}

describe("GET /api/seasons", () => {
  it("lists every season of every club when no clubId is given", async () => {
    const [clubA, clubB] = [await createClub(), await createClub()];
    const spring = await createSeason({ clubId: clubA.id, name: "A Spring" });
    const ongoing = await createSeason({ clubId: clubB.id, name: "B Ongoing", endDate: null, isActive: false });

    const response = await (await anon()).get("/api/seasons");

    expect(response.status).toBe(200);
    const listed = [...(response.body as Array<{ name: string }>)].sort((a, b) => a.name.localeCompare(b.name));
    expect(listed).toEqual([asJson(spring), asJson(ongoing)]);
  });

  it("lists only that club's seasons when given ?clubId=", async () => {
    const [club, otherClub] = [await createClub(), await createClub()];
    const season = await createSeason({ clubId: club.id });
    await createSeason({ clubId: otherClub.id });

    const response = await (await anon()).get("/api/seasons").query({ clubId: club.id });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([asJson(season)]);
  });

  it("returns an empty list for an unknown club", async () => {
    await createSeason({ clubId: (await createClub()).id });

    const response = await (await anon()).get("/api/seasons").query({ clubId: UNKNOWN_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
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
    expect(response.body).toEqual({ error: "Season not found" });
  });
});

describe("POST /api/seasons", () => {
  it("requires a signed-in user", async () => {
    const club = await createClub();

    const response = await (await anon()).post("/api/seasons").send({ name: "2026", clubId: club.id, startDate: "2026-01-01" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
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

  it("rejects a body without a name, a club or a valid start date", async () => {
    const { agent, club } = await clubOwner();

    for (const [body, field] of [
      [{ clubId: club.id, startDate: "2026-01-01" }, "name"],
      [{ name: "No club", startDate: "2026-01-01" }, "clubId"],
      [{ name: "Bad date", clubId: club.id, startDate: "not a date" }, "startDate"],
    ] as const) {
      const response = await agent.post("/api/seasons").send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid season data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await testDb().select().from(seasons)).toEqual([]);
  });

  it("answers 500 when the club does not exist", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.post("/api/seasons").send({ name: "Orphan", clubId: UNKNOWN_ID, startDate: "2026-01-01" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to create season" });
  });

  it.fails("refuses a member who does not own the club (SEC-03)", async () => {
    const { agent } = await signIn();
    const club = await createClub({ ownerId: (await createUser()).id });

    const response = await agent.post("/api/seasons").send({ name: "Planted", clubId: club.id, startDate: "2026-01-01" });

    expect(response.status).toBe(403);
    expect(await testDb().select().from(seasons)).toEqual([]);
  });

  it.fails("saves a blank end date as no end date, not 1 January 1970 (DATA-22)", async () => {
    const { agent, club } = await clubOwner();

    const response = await agent.post("/api/seasons").send({ name: "Open-ended", clubId: club.id, startDate: "2026-01-01", endDate: null });

    expect(response.status).toBe(201);
    expect(response.body.endDate).toBeNull();
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

  it("answers 404 for an unknown season", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/seasons/${UNKNOWN_ID}`).send({ name: "Ghost" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found" });
  });

  it("rejects an invalid body", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id });

    const response = await agent.put(`/api/seasons/${season.id}`).send({ startDate: "not a date" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid season data");
    expect(await seasonRow(season.id)).toEqual(season);
  });

  it.fails("requires a signed-in user (SEC-03)", async () => {
    const season = await createSeason({ clubId: (await createClub()).id });

    const response = await (await anon()).put(`/api/seasons/${season.id}`).send({ name: "Vandalised" });

    expect(response.status).toBe(401);
    expect(await seasonRow(season.id)).toEqual(season);
  });

  it.fails("refuses a member who does not own the season's club (SEC-03)", async () => {
    const { agent } = await signIn();
    const season = await createSeason({ clubId: (await createClub({ ownerId: (await createUser()).id })).id });

    const response = await agent.put(`/api/seasons/${season.id}`).send({ name: "Vandalised" });

    expect(response.status).toBe(403);
    expect(await seasonRow(season.id)).toEqual(season);
  });

  it.fails("does not move a season to another club (SEC-03)", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id });
    const otherClub = await createClub();

    await agent.put(`/api/seasons/${season.id}`).send({ clubId: otherClub.id });

    expect((await seasonRow(season.id)).clubId).toBe(club.id);
  });

  it.fails("clears the end date when sent a blank one, instead of saving 1 January 1970 (DATA-22)", async () => {
    const { agent, club } = await clubOwner();
    const season = await createSeason({ clubId: club.id });

    const response = await agent.put(`/api/seasons/${season.id}`).send({ endDate: null });

    expect(response.status).toBe(200);
    expect((await seasonRow(season.id)).endDate).toBeNull();
  });
});

describe("DELETE /api/seasons/:id", () => {
  it("deletes the season with its points systems and allocations, and unlinks its tournaments", async () => {
    const { agent, club } = await clubOwner();
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
  });

  it("answers 404 for an unknown season", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.delete(`/api/seasons/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found" });
  });

  it.fails("requires a signed-in user (SEC-03)", async () => {
    const season = await createSeason({ clubId: (await createClub()).id });
    await createPointsSystem({ seasonId: season.id });

    const response = await (await anon()).delete(`/api/seasons/${season.id}`);

    expect(response.status).toBe(401);
    expect(await seasonRow(season.id)).toEqual(season);
    expect(await testDb().select().from(pointsSystems)).toHaveLength(1);
  });

  it.fails("refuses a member who does not own the season's club (SEC-03)", async () => {
    const { agent } = await signIn();
    const season = await createSeason({ clubId: (await createClub({ ownerId: (await createUser()).id })).id });

    const response = await agent.delete(`/api/seasons/${season.id}`);

    expect(response.status).toBe(403);
    expect(await seasonRow(season.id)).toEqual(season);
  });
});
