import { describe, expect, it } from "vitest";
import { PLAN, seatName, seatPositions } from "./seat-geometry";

/** A seat's point in plan units. */
const inUnits = ({ left, top }: { left: number; top: number }) => ({ x: (left / 100) * PLAN.width, y: (top / 100) * PLAN.height });

/** The angle round the table, clockwise on screen from the dealer at the bottom centre, 0 to 2π. */
const clockwiseFromDealer = (seat: { left: number; top: number }) => {
  const { x, y } = inUnits(seat);
  const angle = Math.atan2((y - PLAN.cy) / PLAN.seatRy, (x - PLAN.cx) / PLAN.seatRx) - Math.PI / 2;
  return (angle + 4 * Math.PI) % (2 * Math.PI);
};

describe("seatPositions", () => {
  it("puts seat 1 on the dealer's left (the bottom, just left of centre) and runs the numbers clockwise", () => {
    for (const count of [2, 6, 9, 10]) {
      const seats = seatPositions(count);
      expect(seats).toHaveLength(count);
      expect(seats[0].left).toBeLessThan(50);
      // In the bottom half (a 2-seat table's seat 1 is at the left end: on the line).
      expect(seats[0].top).toBeGreaterThan(50 - 1e-9);
      const angles = seats.map(clockwiseFromDealer);
      for (let i = 1; i < count; i++) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
    }
  });

  it("seats the last player on the dealer's right, mirroring seat 1", () => {
    const seats = seatPositions(9);
    expect(seats[8].left).toBeCloseTo(100 - seats[0].left, 6);
    expect(seats[8].top).toBeCloseTo(seats[0].top, 6);
  });

  it("spaces the seats evenly along the rail, not bunched at the ends of the table", () => {
    const seats = seatPositions(10).map(inUnits);
    const gaps = seats.map((seat, i) => {
      const next = seats[(i + 1) % seats.length];
      return Math.hypot(next.x - seat.x, next.y - seat.y);
    });
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.1);
  });

  it("keeps every seat on the plan's box", () => {
    for (const seat of seatPositions(10)) {
      expect(seat.left).toBeGreaterThanOrEqual(0);
      expect(seat.left).toBeLessThanOrEqual(100);
      expect(seat.top).toBeGreaterThanOrEqual(0);
      expect(seat.top).toBeLessThanOrEqual(100);
    }
  });

  it("answers the same positions for the same table size", () => {
    expect(seatPositions(8)).toBe(seatPositions(8));
  });
});

describe("seatName", () => {
  it("is the first word of the name", () => {
    expect(seatName("  Aroha  Ngata ")).toBe("Aroha");
    expect(seatName("Cher")).toBe("Cher");
  });
});
