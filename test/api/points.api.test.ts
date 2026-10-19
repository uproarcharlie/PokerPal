/**
 * The points API (server/routes/points.ts): a season's points systems and each system's
 * allocations (points per finishing position or range of positions). Reads are public; writes need
 * a manager of the season's club (SEC-03). Allocations never overlap and are listed by position
 * (bug-37).
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pointsAllocations, pointsSystems, tournaments } from "@shared/schema";
import { findForbiddenKeys } from "@shared/api/public";
import {
  createClub,
  createPointsAllocations,
  createPointsSystem,
  createSeason,
  createTournament,
} from "../factories";
import { anon, asJson, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const signInAdmin = () => signIn({ role: "admin" });

const newSeason = async () => createSeason({ clubId: (await createClub()).id });

const systemRow = async (id: string) => (await testDb().select().from(pointsSystems).where(eq(pointsSystems.id, id)))[0];

const allocationsOf = (pointsSystemId: string) =>
  testDb().select().from(pointsAllocations).where(eq(pointsAllocations.pointsSystemId, pointsSystemId));

const byPosition = <T extends { position: number }>(rows: readonly T[]) => [...rows].sort((a, b) => a.position - b.position);

const UNAUTHENTICATED = { error: "Authentication required", code: "UNAUTHENTICATED" };

describe("GET /api/seasons/:seasonId/points-systems", () => {
  it("lists that season's points systems only, oldest first", async () => {
    const season = await newSeason();
    const later = await createPointsSystem({ seasonId: season.id, name: "Later", createdAt: new Date("2026-02-01") });
    const system = await createPointsSystem({
      seasonId: season.id,
      participationPoints: 2,
      knockoutPoints: 1,
      description: "Main",
      createdAt: new Date("2026-01-01"),
    });
    await createPointsSystem({ seasonId: (await newSeason()).id });

    const response = await (await anon()).get(`/api/seasons/${season.id}/points-systems`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([asJson(system), asJson(later)]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
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

  it("creates the allocations sent with it in the same transaction", async () => {
    const season = await newSeason();
    const { agent } = await signInAdmin();

    const response = await agent.post(`/api/seasons/${season.id}/points-systems`).send({
      name: "With table",
      allocations: [
        { position: 2, points: 6 },
        { position: 1, points: 10, description: "Winner" },
        { position: 3, positionEnd: 9, points: 2 },
      ],
    });

    expect(response.status).toBe(201);
    expect(byPosition(await allocationsOf(response.body.id))).toEqual([
      expect.objectContaining({ position: 1, positionEnd: null, points: 10, description: "Winner" }),
      expect.objectContaining({ position: 2, positionEnd: null, points: 6, description: null }),
      expect.objectContaining({ position: 3, positionEnd: 9, points: 2 }),
    ]);
  });

  it("creates nothing when the allocations sent overlap (bug-37)", async () => {
    const season = await newSeason();
    const { agent } = await signInAdmin();

    const response = await agent.post(`/api/seasons/${season.id}/points-systems`).send({
      name: "Clashing",
      allocations: [{ position: 1, positionEnd: 3, points: 10 }, { position: 3, points: 5 }],
    });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["allocations", 1, "position"] })]);
    expect(await testDb().select().from(pointsSystems)).toEqual([]);
  });

  it("rejects a body without a name or with points that are not whole numbers", async () => {
    const season = await newSeason();
    const { agent } = await signInAdmin();

    for (const [body, field] of [
      [{ participationPoints: 1 }, "name"],
      [{ name: "Fractional", participationPoints: 1.5 }, "participationPoints"],
      [{ name: "Stringly", knockoutPoints: "2" }, "knockoutPoints"],
      [{ name: "Negative", knockoutPoints: -1 }, "knockoutPoints"],
    ] as const) {
      const response = await agent.post(`/api/seasons/${season.id}/points-systems`).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid points system data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await testDb().select().from(pointsSystems)).toEqual([]);
  });

  it("answers 404 when the season does not exist", async () => {
    const { agent } = await signInAdmin();

    const response = await agent.post(`/api/seasons/${UNKNOWN_ID}/points-systems`).send({ name: "Orphan" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Season not found", code: "NOT_FOUND" });
  });

  it("requires a signed-in, active manager of the season's club (SEC-03)", async () => {
    const { club, owner, manager, stranger, deactivated } = await clubWithStaff();
    const season = await createSeason({ clubId: club.id });
    const path = `/api/seasons/${season.id}/points-systems`;

    const anonymous = await (await anon()).post(path).send({ name: "Planted" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual(UNAUTHENTICATED);
    expect((await deactivated.agent.post(path).send({ name: "Planted" })).status).toBe(401);
    expect((await stranger.agent.post(path).send({ name: "Planted" })).status).toBe(403);
    expect((await manager.agent.post(path).send({ name: "By manager" })).status).toBe(201);
    expect((await owner.agent.post(path).send({ name: "By owner" })).status).toBe(201);
    expect((await testDb().select().from(pointsSystems)).map((s) => s.name).sort()).toEqual(["By manager", "By owner"]);
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
    expect(response.body).toEqual({ error: "Points system not found", code: "NOT_FOUND" });
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

  it("answers 404 for an unknown points system instead of 204 (SEC-03)", async () => {
    const { agent } = await signInAdmin();

    const response = await agent.delete(`/api/points-systems/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Points system not found", code: "NOT_FOUND" });
  });

  it("requires a signed-in, active manager of the season's club (SEC-03)", async () => {
    const { club, manager, stranger, deactivated } = await clubWithStaff();
    const season = await createSeason({ clubId: club.id });
    const system = await createPointsSystem({ seasonId: season.id });

    expect((await (await anon()).delete(`/api/points-systems/${system.id}`)).status).toBe(401);
    expect((await deactivated.agent.delete(`/api/points-systems/${system.id}`)).status).toBe(401);
    const refused = await stranger.agent.delete(`/api/points-systems/${system.id}`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "You don't have permission to manage this points system", code: "FORBIDDEN" });
    expect(await systemRow(system.id)).toEqual(system);

    expect((await manager.agent.delete(`/api/points-systems/${system.id}`)).status).toBe(204);
    expect(await systemRow(system.id)).toBeUndefined();
  });
});

describe("GET /api/points-systems/:pointsSystemId/allocations", () => {
  it("lists that system's allocations only, by position (bug-37)", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const created = await createPointsAllocations(system.id, [
      { position: 3, positionEnd: 9, points: 2, description: "Final table" },
      { position: 1, points: 10, description: "Winner" },
      { position: 2, points: 6 },
    ]);
    const other = await createPointsSystem({ seasonId: (await newSeason()).id });
    await createPointsAllocations(other.id, [{ position: 1, points: 99 }]);

    const response = await (await anon()).get(`/api/points-systems/${system.id}/allocations`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(byPosition(created).map(asJson));
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

  it("rejects a missing position or points, a position that is not a whole number, or a range that runs backwards", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const { agent } = await signInAdmin();

    for (const [body, field] of [
      [{ points: 10 }, "position"],
      [{ position: 1 }, "points"],
      [{ position: "1", points: 10 }, "position"],
      [{ position: 1.5, points: 10 }, "position"],
      [{ position: 0, points: 10 }, "position"],
      [{ position: 5, positionEnd: 2, points: 10 }, "positionEnd"],
    ] as const) {
      const response = await agent.post(`/api/points-systems/${system.id}/allocations`).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid points allocation data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await allocationsOf(system.id)).toEqual([]);
  });

  it("answers 404 when the points system does not exist", async () => {
    const { agent } = await signInAdmin();

    const response = await agent.post(`/api/points-systems/${UNKNOWN_ID}/allocations`).send({ position: 1, points: 10 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Points system not found", code: "NOT_FOUND" });
  });

  it("refuses an allocation that overlaps an existing one with 409 ALLOCATION_OVERLAP (bug-37)", async () => {
    const system = await createPointsSystem({ seasonId: (await newSeason()).id });
    const existing = await createPointsAllocations(system.id, [{ position: 3, positionEnd: 9, points: 2 }]);
    const { agent } = await signInAdmin();

    for (const body of [{ position: 5, points: 4 }, { position: 1, positionEnd: 3, points: 4 }, { position: 9, positionEnd: 12, points: 1 }]) {
      const response = await agent.post(`/api/points-systems/${system.id}/allocations`).send(body);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "Position 3-9 already has points",
        code: "ALLOCATION_OVERLAP",
        details: { allocationId: existing[0].id },
      });
    }
    expect(await allocationsOf(system.id)).toEqual(existing);
    expect((await agent.post(`/api/points-systems/${system.id}/allocations`).send({ position: 10, points: 1 })).status).toBe(201);
  });

  it("requires a signed-in, active manager of the season's club (SEC-03)", async () => {
    const { club, manager, stranger, deactivated } = await clubWithStaff();
    const system = await createPointsSystem({ seasonId: (await createSeason({ clubId: club.id })).id });
    const path = `/api/points-systems/${system.id}/allocations`;

    const anonymous = await (await anon()).post(path).send({ position: 1, points: 1000 });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual(UNAUTHENTICATED);
    expect((await deactivated.agent.post(path).send({ position: 1, points: 1000 })).status).toBe(401);
    expect((await stranger.agent.post(path).send({ position: 1, points: 1000 })).status).toBe(403);
    expect(await allocationsOf(system.id)).toEqual([]);
    expect((await manager.agent.post(path).send({ position: 1, points: 10 })).status).toBe(201);
  });
});
