import { pointsAllocations, pointsSystems, type PointsAllocation, type PointsSystem } from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { uniqueSuffix } from "./sequence";

export type NewPointsSystem = typeof pointsSystems.$inferInsert;
export type NewPointsAllocation = typeof pointsAllocations.$inferInsert;
/** One row of a points table: `position` alone, or the range `position`–`positionEnd`. */
export type AllocationSpec = Pick<NewPointsAllocation, "position" | "positionEnd" | "points" | "description">;

export function buildPointsSystem(overrides: Partial<NewPointsSystem> & Pick<NewPointsSystem, "seasonId">): NewPointsSystem {
  return {
    name: `Test Points ${uniqueSuffix()}`,
    participationPoints: 0,
    knockoutPoints: 0,
    ...overrides,
  };
}

export async function createPointsSystem(
  overrides: Partial<NewPointsSystem> & Pick<NewPointsSystem, "seasonId">,
  db: Database = getDb(),
): Promise<PointsSystem> {
  const [system] = await db.insert(pointsSystems).values(buildPointsSystem(overrides)).returning();
  return system;
}

export function buildPointsAllocation(pointsSystemId: string, spec: AllocationSpec): NewPointsAllocation {
  return { pointsSystemId, ...spec };
}

/** Insert `specs` for `pointsSystemId`, returned in the order given. */
export async function createPointsAllocations(
  pointsSystemId: string,
  specs: readonly AllocationSpec[],
  db: Database = getDb(),
): Promise<PointsAllocation[]> {
  const created: PointsAllocation[] = [];
  for (const spec of specs) {
    const [allocation] = await db.insert(pointsAllocations).values(buildPointsAllocation(pointsSystemId, spec)).returning();
    created.push(allocation);
  }
  return created;
}
