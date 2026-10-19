import { describe, expect, expectTypeOf, it } from "vitest";
import type { PointsAllocation, PointsSystem } from "../schema";
import { allocationFor, pointsForFinish, type AllocationInput, type PointsRules, type PointsSystemInput } from "./points";

const table: AllocationInput[] = [
  { position: 1, points: 100 },
  { position: 2, points: 75 },
  { position: 3, points: 50 },
  { position: 4, positionEnd: 6, points: 25 },
];

const rules = (overrides: Partial<PointsRules> = {}): PointsRules => ({
  trackPoints: true,
  pointsSystem: { participationPoints: 10, knockoutPoints: 5 },
  allocations: table,
  ...overrides,
});

describe("allocationFor", () => {
  it.each([
    [1, 100],
    [3, 50],
    [4, 25],
    [6, 25],
    [7, undefined],
  ])("finds the allocation for place %i", (position, points) => {
    expect(allocationFor(position, table)?.points).toBe(points);
  });

  it("treats a positionEnd of null or 0 as a single place", () => {
    expect(allocationFor(1, [{ position: 1, positionEnd: 0, points: 9 }])?.points).toBe(9);
    expect(allocationFor(2, [{ position: 1, positionEnd: 0, points: 9 }])).toBeUndefined();
    expect(allocationFor(1, [{ position: 1, positionEnd: null, points: 9 }])?.points).toBe(9);
  });

  it("resolves overlaps the same way every time: lowest starting place first, then the given order (bug-37)", () => {
    const overlapping: AllocationInput[] = [
      { position: 3, positionEnd: 5, points: 30 },
      { position: 1, positionEnd: 4, points: 40 },
      { position: 3, points: 31 },
    ];

    expect(allocationFor(3, overlapping)?.points).toBe(40);
    expect(allocationFor(5, overlapping)?.points).toBe(30);
    expect(allocationFor(3, [overlapping[0], overlapping[2]])?.points).toBe(30);
    expect(allocationFor(3, [overlapping[2], overlapping[0]])?.points).toBe(31);
  });

  it("does not reorder the caller's list", () => {
    const list = [{ position: 2, points: 1 }, { position: 1, points: 2 }];
    allocationFor(1, list);

    expect(list.map((a) => a.position)).toEqual([2, 1]);
  });
});

describe("pointsForFinish: the rule finalize has always applied", () => {
  it("awards the allocation for the place, plus knockout points", () => {
    expect(pointsForFinish(rules(), 1, 4)).toBe(120);
    expect(pointsForFinish(rules(), 5, 0)).toBe(25);
  });

  it("falls back to participation points only for places without an allocation", () => {
    expect(pointsForFinish(rules(), 7, 0)).toBe(10);
    expect(pointsForFinish(rules(), 7, 2)).toBe(20);
  });

  it("gives a place allocated 0 points nothing, not participation, stored as none", () => {
    const zero = rules({ allocations: [{ position: 1, points: 50 }, { position: 2, points: 0 }] });

    expect(pointsForFinish(zero, 2, 0)).toBeNull();
    expect(pointsForFinish(zero, 2, 1)).toBe(5);
    expect(pointsForFinish(zero, 3, 0)).toBe(10);
  });

  it("awards nothing when the tournament does not track points or has no points system", () => {
    expect(pointsForFinish(rules({ trackPoints: false }), 1, 3)).toBeNull();
    expect(pointsForFinish(rules({ pointsSystem: null }), 1, 3)).toBeNull();
  });

  it("treats missing participation, knockout points and knockouts as none", () => {
    const bare = rules({ pointsSystem: { participationPoints: null, knockoutPoints: null }, allocations: [] });

    expect(pointsForFinish(bare, 1, 3)).toBeNull();
    expect(pointsForFinish(rules({ allocations: [] }), 1, null)).toBe(10);
    expect(pointsForFinish(rules({ allocations: [] }), 1, undefined)).toBe(10);
  });

  it("stores a total of 0 or less as none", () => {
    const negative = rules({ allocations: [{ position: 1, points: -5 }], pointsSystem: { knockoutPoints: 2 } });

    expect(pointsForFinish(negative, 1, 2)).toBeNull();
    expect(pointsForFinish(negative, 1, 3)).toBe(1);
  });

  it("accepts database rows as they are", () => {
    expectTypeOf<PointsSystem>().toExtend<PointsSystemInput>();
    expectTypeOf<PointsAllocation>().toExtend<AllocationInput>();
  });
});
