import type { PointsAllocation, PointsSystem } from "@shared/schema";
import { overlappingAllocations, type AllocationInput, type CreatePointsSystemInput } from "@shared/api/points";
import {
  pickFields,
  PUBLIC_POINTS_ALLOCATION_FIELDS,
  PUBLIC_POINTS_SYSTEM_FIELDS,
  type PublicPointsAllocation,
  type PublicPointsSystem,
} from "@shared/api/public";
import { db } from "../db";
import { conflict, notFound } from "../http/errors";
import * as pointsRepo from "../repositories/points";

/**
 * Season points systems and their per-position allocations. Allocations never overlap (bug-37), so
 * finalize finds at most one per position; they are listed by position.
 */

const toPublicPointsSystem = (system: PointsSystem): PublicPointsSystem => ({
  ...pickFields(system, PUBLIC_POINTS_SYSTEM_FIELDS),
  createdAt: system.createdAt?.toISOString() ?? null,
});

const toPublicAllocation = (allocation: PointsAllocation): PublicPointsAllocation =>
  pickFields(allocation, PUBLIC_POINTS_ALLOCATION_FIELDS);

const allocationRow = (pointsSystemId: string, allocation: AllocationInput) => ({
  pointsSystemId,
  position: allocation.position,
  positionEnd: allocation.positionEnd ?? null,
  points: allocation.points,
  description: allocation.description ?? null,
});

export async function listPointsSystems(seasonId: string): Promise<PublicPointsSystem[]> {
  return (await pointsRepo.getPointsSystemsBySeason(db, seasonId)).map(toPublicPointsSystem);
}

export async function getPointsSystem(id: string): Promise<PublicPointsSystem> {
  const system = await pointsRepo.getPointsSystem(db, id);
  if (!system) throw notFound("Points system not found");
  return toPublicPointsSystem(system);
}

/** The system and any `allocations` (already checked not to overlap) in one transaction. */
export async function createPointsSystem(seasonId: string, input: CreatePointsSystemInput): Promise<PublicPointsSystem> {
  const system = await db.transaction(async (tx) => {
    const created = await pointsRepo.createPointsSystem(tx, {
      seasonId,
      name: input.name,
      description: input.description ?? null,
      ...(input.participationPoints === undefined ? {} : { participationPoints: input.participationPoints }),
      ...(input.knockoutPoints === undefined ? {} : { knockoutPoints: input.knockoutPoints }),
    });
    await pointsRepo.createPointsAllocations(
      tx,
      (input.allocations ?? []).map((allocation) => allocationRow(created.id, allocation)),
    );
    return created;
  });
  return toPublicPointsSystem(system);
}

/** 404 for an unknown id (it was 204). Tournaments that used it keep no points system. */
export async function deletePointsSystem(id: string): Promise<void> {
  if (!(await pointsRepo.deletePointsSystem(db, id))) throw notFound("Points system not found");
}

export async function listAllocations(pointsSystemId: string): Promise<PublicPointsAllocation[]> {
  return (await pointsRepo.getPointsAllocationsBySystem(db, pointsSystemId)).map(toPublicAllocation);
}

/**
 * 409 ALLOCATION_OVERLAP when it shares a position with a stored allocation of the system. Answers
 * the public projection, like the list, never the row as stored (P2REV4-CQ2-06).
 */
export async function createAllocation(pointsSystemId: string, input: AllocationInput): Promise<PublicPointsAllocation> {
  return db.transaction(async (tx) => {
    // The lock makes concurrent adds to one system take turns, so two overlapping ones cannot both pass.
    if (!(await pointsRepo.lockPointsSystem(tx, pointsSystemId))) throw notFound("Points system not found");
    const existing = await pointsRepo.getPointsAllocationsBySystem(tx, pointsSystemId);
    const clash = overlappingAllocations([...existing, input]).find(([, j]) => j === existing.length);
    if (clash) {
      const other = existing[clash[0]];
      const range = other.positionEnd ? `${other.position}-${other.positionEnd}` : `${other.position}`;
      throw conflict("ALLOCATION_OVERLAP", `Position ${range} already has points`, { allocationId: other.id });
    }
    return toPublicAllocation(await pointsRepo.createPointsAllocation(tx, allocationRow(pointsSystemId, input)));
  });
}
