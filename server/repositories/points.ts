import { asc, eq } from "drizzle-orm";
import {
  pointsAllocations,
  pointsSystems,
  type InsertPointsAllocation,
  type InsertPointsSystem,
  type PointsAllocation,
  type PointsSystem,
} from "@shared/schema";
import type { Executor } from "../db";

// Points systems

export async function getPointsSystem(ex: Executor, id: string): Promise<PointsSystem | undefined> {
  const [pointsSystem] = await ex.select().from(pointsSystems).where(eq(pointsSystems.id, id));
  return pointsSystem || undefined;
}

/** The system's row, locked until the transaction ends, so allocations are added to it one at a time. */
export async function lockPointsSystem(ex: Executor, id: string): Promise<PointsSystem | undefined> {
  const [pointsSystem] = await ex.select().from(pointsSystems).where(eq(pointsSystems.id, id)).for("update");
  return pointsSystem;
}

/** The season's points systems, oldest first. */
export async function getPointsSystemsBySeason(ex: Executor, seasonId: string): Promise<PointsSystem[]> {
  return ex
    .select()
    .from(pointsSystems)
    .where(eq(pointsSystems.seasonId, seasonId))
    .orderBy(asc(pointsSystems.createdAt), asc(pointsSystems.id));
}

export async function createPointsSystem(ex: Executor, insertPS: InsertPointsSystem): Promise<PointsSystem> {
  const [pointsSystem] = await ex.insert(pointsSystems).values(insertPS).returning();
  return pointsSystem;
}

/** Deletes the system and (FK cascade) its allocations; tournaments using it keep no system. */
export async function deletePointsSystem(ex: Executor, id: string): Promise<boolean> {
  const deleted = await ex.delete(pointsSystems).where(eq(pointsSystems.id, id)).returning({ id: pointsSystems.id });
  return deleted.length > 0;
}

// Points allocations

/** The system's allocations by position, so the first matching one is always the same (bug-37). */
export async function getPointsAllocationsBySystem(ex: Executor, pointsSystemId: string): Promise<PointsAllocation[]> {
  return ex
    .select()
    .from(pointsAllocations)
    .where(eq(pointsAllocations.pointsSystemId, pointsSystemId))
    .orderBy(asc(pointsAllocations.position), asc(pointsAllocations.id));
}

export interface PointsRulesRows {
  pointsSystem: PointsSystem | null;
  /** By position, then id, so an overlap always resolves the same way (bug-37). */
  allocations: PointsAllocation[];
}

/** A points system and its allocations (none for no system or an unknown one), read once per finalize (perf-26). */
export async function pointsRules(ex: Executor, pointsSystemId: string | null): Promise<PointsRulesRows> {
  const pointsSystem = pointsSystemId ? await getPointsSystem(ex, pointsSystemId) : undefined;
  if (!pointsSystem) return { pointsSystem: null, allocations: [] };
  return { pointsSystem, allocations: await getPointsAllocationsBySystem(ex, pointsSystem.id) };
}

export async function createPointsAllocation(ex: Executor, insertPA: InsertPointsAllocation): Promise<PointsAllocation> {
  const [allocation] = await ex.insert(pointsAllocations).values(insertPA).returning();
  return allocation;
}

/** Inserts `rows` in one statement. */
export async function createPointsAllocations(ex: Executor, rows: readonly InsertPointsAllocation[]): Promise<void> {
  if (rows.length > 0) await ex.insert(pointsAllocations).values([...rows]);
}
