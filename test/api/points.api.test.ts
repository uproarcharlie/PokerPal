/**
 * Characterization of today's points API (server/routes.ts): a season's points
 * systems and each system's allocations (points per finishing position or
 * range of positions).
 *
 * Writes that are unauthenticated today are exercised as an admin, who keeps
 * access once they are locked down. `it.fails` tests state the correct
 * behaviour for a known hole, tagged with its audit finding id; switch them to
 * `it` when the hole is fixed.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pointsAllocations, pointsSystems, tournaments } from "@shared/schema";
import {
  createClub,
  createPointsAllocations,
  createPointsSystem,
  createSeason,
  createTournament,
} from "../factories";
import { anon, asJson, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const signInAdmin = () => signIn({ role: "admin" });

const newSeason = async () => createSeason({ clubId: (await createClub()).id });

const systemRow = async (id: string) => (await testDb().select().from(pointsSystems).where(eq(pointsSystems.id, id)))[0];

const allocationsOf = (pointsSystemId: string) =>
  testDb().select().from(pointsAllocations).where(eq(pointsAllocations.pointsSystemId, pointsSystemId));

const byPosition = <T extends { position: number }>(rows: readonly T[]) => [...rows].sort((a, b) => a.position - b.position);

describe("GET /api/seasons/:seasonId/points-systems", () => {
  it("lists that season's points systems only", async () => {
    const season = await newSeason();
    const system = await createPointsSystem({ seasonId: season.id, participationPoints: 2, knockoutPoints: 1, description: "Main" });
    await createPointsSystem({ seasonId: (await newSeason()).id });

    const response = await (await anon()).get(`/api/seasons/${season.id}/points-systems`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([asJson(system)]);
  });

  it("returns an empty list for an unknown season", async () => {
    const response = await (await anon()).get(`/api/seasons/${UNKNOWN_ID}/points-systems`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("POST /api/seasons/:seasonId/points-systems", () => {
  it("creates a system for the season in the URL, whatever season the body names", async () => {
    const season = await newSeason();
    const otherSeason = await newSeason();
    const { agent } = await signInAdmin();

    const response = await agent
      .post(`/api/seasons/${season.id}/points-systems`)
      .send({ id: "client-chosen-id", seasonId: otherSeason.id, name: "League points" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      seasonId: season.id,
      name: "League points",
      description: null,
      participationPoints: 0,
      knockoutPoints: 0,
      createdAt: expect.any(String),
    });
    expect(response.body.id).not.toBe("client-chosen-id");
    expect(asJson(await systemRow(response.body.id))).toEqual(response.body);
  });

  it("stores participation and knockout points when sent", async () => {
    const season = await newSeason();
    const { agent } = await signInAdmin();

    const response = await agent
      .post(`/api/seasons/${season.id}/points-systems`)
      .send({ name: "Bounty league", description: "KO bonus", participationPoints: 5, knockoutPoints: 2 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ description: "KO bonus", participationPoints: 5, knockoutPoints: 2 });
  });

  it("rejects a body without a name or with non-integer points", async () => {
    const season = await newSeason();
    const { agent } = await signInAdmin();

    for (const [body, field] of [
      [{ participationPoints: 1 }, "name"],
      [{ name: "Fractional", participationPoints: 1.5 }, "participationPoints"],
      [{ name: "Stringly", knockoutPoints: "2" }, "knockoutPoints"],
    ] as const) {
      const response = await agent.post(`/api/seasons/${season.id}/points-systems`).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid points system data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await testDb().select().from(pointsSystems)).toEqual([]);
  });

  it("answers 500 when the season does not exist", async () => {
    const { agent } = await signInAdmin();

    const response = await agent.post(`/api/seasons/${UNKNOWN_ID}/points-systems`).send({ name: "Orphan" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to create points system" });
  });

  it.fails("requires a signed-in user (SEC-03)", async () => {
    const season = await newSeason();

    const response = await (await anon()).post(`/api/seasons/${season.id}/points-systems`).send({ name: "Planted" });

    expect(response.status).toBe(401);
    expect(await testDb().select().from(pointsSystems)).toEqual([]);
  });
});

describe("GET /api/points-systems/:id", () => {
  it("returns the points system", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id, participationPoints: 3 });

    const response = await (await anon()).get(`/api/points-systems/${system.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asJson(system));
  });

  it("answers 404 for an unknown points system", async () => {
    const response = await (await anon()).get(`/api/points-systems/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Points system not found" });
  });
});

describe("DELETE /api/points-systems/:id", () => {
  it("deletes the system and its allocations, and unlinks tournaments that used it", async () => {
    const season = await newSeason();
    const system = await createPointsSystem({ seasonId: season.id });
    await createPointsAllocations(system.id, [{ position: 1, points: 10 }, { position: 2, points: 5 }]);
    const kept = await createPointsSystem({ seasonId: season.id });
    const [keptAllocation] = await createPointsAllocations(kept.id, [{ position: 1, points: 1 }]);
    const tournament = await createTournament({ clubId: season.clubId, seasonId: season.id, pointsSystemId: system.id });
    const { agent } = await signInAdmin();

    const response = await agent.delete(`/api/points-systems/${system.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    const db = testDb();
    expect(await db.select().from(pointsSystems)).toEqual([kept]);
    expect(await db.select().from(pointsAllocations)).toEqual([keptAllocation]);
    expect(await db.select().from(tournaments).where(eq(tournaments.id, tournament.id))).toEqual([
      { ...tournament, pointsSystemId: null },
    ]);
  });

  it.fails("answers 404 for an unknown points system instead of 204 (SEC-03)", async () => {
    const { agent } = await signInAdmin();

    const response = await agent.delete(`/api/points-systems/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
  });

  it.fails("requires a signed-in user (SEC-03)", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });

    const response = await (await anon()).delete(`/api/points-systems/${system.id}`);

    expect(response.status).toBe(401);
    expect(await systemRow(system.id)).toEqual(system);
  });
});

describe("GET /api/points-systems/:pointsSystemId/allocations", () => {
  it("lists that system's allocations only", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const created = await createPointsAllocations(system.id, [
      { position: 1, points: 10, description: "Winner" },
      { position: 2, points: 6 },
      { position: 3, positionEnd: 9, points: 2, description: "Final table" },
    ]);
    const other = await createPointsSystem({ seasonId: (await newSeason()).id });
    await createPointsAllocations(other.id, [{ position: 1, points: 99 }]);

    const response = await (await anon()).get(`/api/points-systems/${system.id}/allocations`);

    expect(response.status).toBe(200);
    expect(byPosition(response.body as Array<{ position: number }>)).toEqual(created.map(asJson));
  });

  it("returns an empty list for an unknown points system", async () => {
    const response = await (await anon()).get(`/api/points-systems/${UNKNOWN_ID}/allocations`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("POST /api/points-systems/:pointsSystemId/allocations", () => {
  it("creates an allocation for the system in the URL, whatever system the body names", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const other = await createPointsSystem({ seasonId: (await newSeason()).id });
    const { agent } = await signInAdmin();

    const response = await agent
      .post(`/api/points-systems/${system.id}/allocations`)
      .send({ id: "client-chosen-id", pointsSystemId: other.id, position: 1, points: 10 });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      pointsSystemId: system.id,
      position: 1,
      positionEnd: null,
      points: 10,
      description: null,
    });
    expect(response.body.id).not.toBe("client-chosen-id");
    expect(await allocationsOf(system.id)).toEqual([response.body]);
  });

  it("stores a range of positions with a description", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const { agent } = await signInAdmin();

    const response = await agent
      .post(`/api/points-systems/${system.id}/allocations`)
      .send({ position: 4, positionEnd: 10, points: 3, description: "4th-10th" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ position: 4, positionEnd: 10, points: 3, description: "4th-10th" });
  });

  it("rejects a missing position or points, or a position that is not an integer", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const { agent } = await signInAdmin();

    for (const [body, field] of [
      [{ points: 10 }, "position"],
      [{ position: 1 }, "points"],
      [{ position: "1", points: 10 }, "position"],
      [{ position: 1.5, points: 10 }, "position"],
    ] as const) {
      const response = await agent.post(`/api/points-systems/${system.id}/allocations`).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid points allocation data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await allocationsOf(system.id)).toEqual([]);
  });

  it("answers 500 when the points system does not exist", async () => {
    const { agent } = await signInAdmin();

    const response = await agent.post(`/api/points-systems/${UNKNOWN_ID}/allocations`).send({ position: 1, points: 10 });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to create points allocation" });
  });

  it.fails("refuses an allocation that overlaps an existing one (bug-37)", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const existing = await createPointsAllocations(system.id, [{ position: 3, positionEnd: 9, points: 2 }]);
    const { agent } = await signInAdmin();

    const response = await agent.post(`/api/points-systems/${system.id}/allocations`).send({ position: 5, points: 4 });

    expect(response.status).toBe(400);
    expect(await allocationsOf(system.id)).toEqual(existing);
  });

  it.fails("requires a signed-in user (SEC-03)", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });

    const response = await (await anon()).post(`/api/points-systems/${system.id}/allocations`).send({ position: 1, points: 1000 });

    expect(response.status).toBe(401);
    expect(await allocationsOf(system.id)).toEqual([]);
  });
});
