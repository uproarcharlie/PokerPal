/** Points systems (per season) and their per-position allocations. */
import { z } from "zod";
import { integerSchema, nullableIntegerSchema, optionalText, requiredText } from "./common";

const points = integerSchema(0, 1_000_000);
const position = integerSchema(1, 1000);

/** One position (`positionEnd` null) or an inclusive range of positions, e.g. 4 to 10. */
export const allocationSchema = z
  .object({
    position,
    positionEnd: nullableIntegerSchema(1, 1000),
    points,
    description: optionalText(200),
  })
  .refine((a) => a.positionEnd == null || a.positionEnd >= a.position, {
    message: "The last position must not be before the first",
    path: ["positionEnd"],
  });
export type AllocationInput = z.infer<typeof allocationSchema>;

interface PositionRange {
  position: number;
  positionEnd?: number | null;
}

/** Index pairs [i, j] (i < j) of allocations whose positions overlap; empty when none do (bug-37). */
export function overlappingAllocations(allocations: readonly PositionRange[]): Array<[number, number]> {
  const end = (a: PositionRange) => a.positionEnd ?? a.position;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < allocations.length; i++) {
    for (let j = i + 1; j < allocations.length; j++) {
      const a = allocations[i];
      const b = allocations[j];
      if (a.position <= end(b) && b.position <= end(a)) pairs.push([i, j]);
    }
  }
  return pairs;
}

/**
 * POST /api/seasons/:id/points-systems. `allocations`, when given, are created in the same
 * transaction, so a failure leaves no half-built system; they must not overlap.
 */
export const createPointsSystemSchema = z.object({
  name: requiredText(100),
  description: optionalText(500),
  participationPoints: points.optional(),
  knockoutPoints: points.optional(),
  allocations: z
    .array(allocationSchema)
    .max(100)
    .optional()
    .superRefine((allocations, ctx) => {
      for (const [, j] of overlappingAllocations(allocations ?? [])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [j, "position"], message: "Overlaps another allocation" });
      }
    }),
});
export type CreatePointsSystemInput = z.infer<typeof createPointsSystemSchema>;

/** POST /api/points-systems/:id/allocations: refused with 409 ALLOCATION_OVERLAP if it overlaps a stored one. */
export const createAllocationSchema = allocationSchema;
