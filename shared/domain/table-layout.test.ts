import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_SHAPE,
  isTableShape,
  PLAN,
  resolveTableShape,
  TABLE_SHAPE_LABELS,
  TABLE_SHAPES,
  tableLayout,
  type TableShape,
} from "./table-layout";

const round6 = (value: number) => Number(value.toFixed(6));
const SEAT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Clockwise on screen (y down) from the dealer's spot below the centre: the angle from the bottom, growing towards the left. */
const angleFromDealer = (seat: { x: number; y: number }) => {
  const angle = Math.atan2(-(seat.x - PLAN.cx), seat.y - PLAN.cy);
  return angle < 0 ? angle + 2 * Math.PI : angle;
};

describe("table shapes", () => {
  it("are oval, rectangle and round, oval when nothing says otherwise", () => {
    expect(TABLE_SHAPES).toEqual(["oval", "rectangle", "round"]);
    expect(DEFAULT_TABLE_SHAPE).toBe("oval");
    expect(TABLE_SHAPE_LABELS).toEqual({ oval: "Oval", rectangle: "Rectangle", round: "Round" });
    expect(isTableShape("rectangle")).toBe(true);
    expect(isTableShape("square")).toBe(false);
    expect(isTableShape(null)).toBe(false);
  });

  it("resolve to the table's own, else the tournament's, else the club's, else oval", () => {
    expect(resolveTableShape("round", "rectangle", "oval")).toBe("round");
    expect(resolveTableShape(null, "rectangle", "round")).toBe("rectangle");
    expect(resolveTableShape(null, undefined, "round")).toBe("round");
    expect(resolveTableShape(null, null, null)).toBe("oval");
    expect(resolveTableShape("hexagon", null, "rectangle")).toBe("rectangle");
    expect(resolveTableShape()).toBe("oval");
  });
});

describe("tableLayout", () => {
  it("draws the oval exactly as Phase 4 did (seat-geometry.ts)", () => {
    const at = (count: number) => tableLayout("oval", count).seats.map((seat) => [round6(seat.left), round6(seat.top)]);
    expect(at(2)).toEqual([[7, 50], [93, 50]]);
    expect(at(6)).toEqual([
      [30.866406, 87.015702],
      [7, 50],
      [30.866406, 12.984298],
      [69.133594, 12.984298],
      [93, 50],
      [69.133594, 87.015702],
    ]);
    expect(at(9)[0]).toEqual([37.105015, 89.430856]);
    expect(at(9)[4]).toEqual([50, 8.666667]);
    expect(at(10)[2]).toEqual([7, 50]);
    expect(tableLayout("oval", 9).felt).toEqual({ kind: "ellipse", cx: 200, cy: 150, rx: 124, ry: 62 });
    expect(tableLayout("oval", 9).rail).toEqual({ kind: "ellipse", cx: 200, cy: 150, rx: 134, ry: 72 });
    expect(tableLayout("oval", 9).dealer).toEqual({ x: 200, y: 196 });
  });

  it("puts the rectangle's dealer in the middle of a long side and the round table's below its centre", () => {
    const rectangle = tableLayout("rectangle", 9);
    expect(rectangle.felt).toEqual({ kind: "rect", x: 70, y: 86, width: 260, height: 128, radius: 18 });
    expect(rectangle.rail).toEqual({ kind: "rect", x: 60, y: 76, width: 280, height: 148, radius: 28 });
    expect(rectangle.dealer).toEqual({ x: 200, y: 198 });
    const round = tableLayout("round", 9);
    expect(round.felt).toEqual({ kind: "ellipse", cx: 200, cy: 150, rx: 82, ry: 82 });
    expect(round.dealer).toEqual({ x: 200, y: 216 });
  });

  describe.each(TABLE_SHAPES)("a %s table", (shape: TableShape) => {
    it.each(SEAT_COUNTS)("with %d seats numbers them 1 to N clockwise from the dealer's left, all inside the plan", (count) => {
      const layout = tableLayout(shape, count);
      expect(layout.shape).toBe(shape);
      expect([layout.width, layout.height]).toEqual([PLAN.width, PLAN.height]);
      expect(layout.seats.map((seat) => seat.seatNumber)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      const angles = layout.seats.map(angleFromDealer);
      for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
      // Seat 1 is on the dealer's left: left of the centre line, in the lower half or at the end of the table.
      expect(layout.seats[0].x).toBeLessThan(PLAN.cx);
      expect(layout.seats[0].y).toBeGreaterThanOrEqual(PLAN.cy - 1e-9);
      for (const seat of layout.seats) {
        expect(seat.x).toBeGreaterThan(0);
        expect(seat.x).toBeLessThan(PLAN.width);
        expect(seat.y).toBeGreaterThan(0);
        expect(seat.y).toBeLessThan(PLAN.height);
        expect(seat.left).toBeCloseTo((seat.x / PLAN.width) * 100, 9);
        expect(seat.top).toBeCloseTo((seat.y / PLAN.height) * 100, 9);
      }
    });

    it.each(SEAT_COUNTS)("with %d seats is mirrored about the dealer, and no two seats are closer than a seat's width", (count) => {
      const { seats } = tableLayout(shape, count);
      seats.forEach((seat, i) => {
        const mirror = seats[count - 1 - i];
        expect(seat.x + mirror.x).toBeCloseTo(2 * PLAN.cx, 1);
        expect(seat.y).toBeCloseTo(mirror.y, 1);
        for (const other of seats.slice(i + 1)) expect(Math.hypot(seat.x - other.x, seat.y - other.y)).toBeGreaterThan(44);
      });
      // Nobody sits in the dealer's spot: the gap at the bottom centre is as wide as any between two seats.
      const first = seats[0];
      const last = seats[count - 1];
      expect(first.x + last.x).toBeCloseTo(2 * PLAN.cx, 1);
    });
  });

  it("puts a rectangle's 9 seats round both long sides and the ends", () => {
    const { seats } = tableLayout("rectangle", 9);
    const near = seats.filter((seat) => seat.y > 240).length;
    const far = seats.filter((seat) => seat.y < 60).length;
    const ends = seats.filter((seat) => seat.x < 60 || seat.x > 340).length;
    expect(near).toBeGreaterThanOrEqual(2);
    expect(far).toBeGreaterThanOrEqual(3);
    expect(ends).toBeGreaterThanOrEqual(2);
  });

  it("clamps the seat count to 2–10 and hands back the same layout for the same table", () => {
    expect(tableLayout("round", 1).seats).toHaveLength(2);
    expect(tableLayout("round", 14).seats).toHaveLength(10);
    expect(tableLayout("round", Number.NaN).seats).toHaveLength(2);
    expect(tableLayout("rectangle", 9)).toBe(tableLayout("rectangle", 9));
    expect(tableLayout("rectangle", 8.7)).toBe(tableLayout("rectangle", 8));
  });
});
