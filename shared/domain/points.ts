/**
 * Season points for a finishing position: the rule finalize has always applied. PURE: no imports.
 *
 * Points are awarded only when the tournament tracks points and has a points system:
 * - the first allocation covering the position (a single place, or `position`..`positionEnd`) gives
 *   its points, even 0;
 * - with no allocation for the position, the system's participation points apply instead (a
 *   fallback, not an addition);
 * - each knockout then adds the system's knockout points.
 * A total of 0 or less is stored as no points (null).
 */

/** A `PointsSystem` row fits as it is. */
export interface PointsSystemInput {
  participationPoints?: number | null;
  knockoutPoints?: number | null;
}

/** A `PointsAllocation` row fits as it is. */
export interface AllocationInput {
  position: number;
  /** The last place of a range; null, undefined or 0 means the single place `position`. */
  positionEnd?: number | null;
  points: number;
}

/**
 * The allocation that pays `position`. Allocations are tried by `position`, keeping the given order
 * between equal positions (the database sorts them by `position, id`), so overlaps resolve the same
 * way every time.
 */
export function allocationFor<A extends AllocationInput>(position: number, allocations: readonly A[]): A | undefined {
  const ordered = [...allocations].sort((a, b) => a.position - b.position);
  return ordered.find((allocation) =>
    allocation.positionEnd
      ? position >= allocation.position && position <= allocation.positionEnd
      : position === allocation.position,
  );
}

export interface PointsRules {
  trackPoints: boolean;
  /** The tournament's points system, or null when it has none. */
  pointsSystem: PointsSystemInput | null;
  allocations: readonly AllocationInput[];
}

/** The points awarded for finishing `position` with `knockouts`, or null for none. */
export function pointsForFinish(rules: PointsRules, position: number, knockouts: number | null | undefined): number | null {
  if (!rules.trackPoints || rules.pointsSystem === null) return null;
  const { participationPoints, knockoutPoints } = rules.pointsSystem;

  let points = 0;
  const allocation = allocationFor(position, rules.allocations);
  if (allocation) {
    points = allocation.points;
  } else if ((participationPoints ?? 0) > 0) {
    points = participationPoints ?? 0;
  }
  const kos = knockouts ?? 0;
  if (kos > 0 && knockoutPoints) points += kos * knockoutPoints;

  return points > 0 ? points : null;
}
