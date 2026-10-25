/**
 * Where the seats of a table are drawn, for each table shape (round 5, item 4). PURE: no imports, no
 * I/O; the seat plans (TD's Seats tab, the public seat finder, the TV's seating overlay) all draw from
 * `tableLayout`, so every screen numbers the seats the same way.
 *
 * Every layout is drawn in the same PLAN box (400 × 300 units, the SVG viewBox), and each seat is
 * placed over it in percent of that box, so the seats keep their tap-target size however wide the card
 * is. The dealer sits in the middle of the bottom edge (on a rectangle, the middle of a long side);
 * seat 1 is on the dealer's left and the numbers run clockwise, the order players are dealt to. Seats
 * are spaced evenly along the shape (by distance, not by angle, which would bunch them at the ends of
 * a long table), with the dealer in the gap between the last seat and seat 1. A table of fewer seats
 * (a 6-handed game at a 9-seat table is a table of 6 seats) spreads them evenly round the same shape.
 */

export const TABLE_SHAPES = ["oval", "rectangle", "round"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** What a table is drawn as when neither it, its tournament nor its club says. */
export const DEFAULT_TABLE_SHAPE: TableShape = "oval";

export const TABLE_SHAPE_LABELS: Readonly<Record<TableShape, string>> = {
  oval: "Oval",
  rectangle: "Rectangle",
  round: "Round",
};

export function isTableShape(value: unknown): value is TableShape {
  return typeof value === "string" && (TABLE_SHAPES as readonly string[]).includes(value);
}

/** The shape a table is drawn as: its own, else its tournament's, else its club's default, else oval. */
export function resolveTableShape(...choices: ReadonlyArray<string | null | undefined>): TableShape {
  return choices.find(isTableShape) ?? DEFAULT_TABLE_SHAPE;
}

/** The box every table is drawn in (SVG viewBox units). */
export const PLAN = { width: 400, height: 300, cx: 200, cy: 150, railWidth: 10 } as const;

export interface PlanPoint {
  x: number;
  y: number;
}

/** The felt (or the rail round it): an ellipse (oval, round) or a rounded rectangle. */
export type FeltOutline =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; radius: number };

export interface SeatLayout {
  seatNumber: number;
  /** The seat's centre in plan units. */
  x: number;
  y: number;
  /** The same as percent of the plan's width and height, from its top-left corner (for absolutely placed seat buttons). */
  left: number;
  top: number;
}

export interface TableLayout {
  shape: TableShape;
  width: number;
  height: number;
  felt: FeltOutline;
  /** The felt grown by PLAN.railWidth. */
  rail: FeltOutline;
  /** Where the dealer button is drawn, on the felt in front of the dealer. */
  dealer: PlanPoint;
  /** Seat 1 first. */
  seats: SeatLayout[];
}

/** The closed track each shape's seat centres sit on, from the dealer's spot round clockwise (on screen, y down). */
interface Track {
  /** The point at `t` in [0, 1): 0 is the dealer's spot, rising t runs clockwise. */
  at(t: number): PlanPoint;
}

const ellipseTrack = (rx: number, ry: number): Track => ({
  // t = 0 is the bottom centre (angle π/2 with y pointing down); a growing angle moves left first: clockwise on screen.
  at: (t) => ({ x: PLAN.cx + rx * Math.cos(Math.PI / 2 + 2 * Math.PI * t), y: PLAN.cy + ry * Math.sin(Math.PI / 2 + 2 * Math.PI * t) }),
});

/**
 * A rounded rectangle centred in the plan, walked from the middle of its bottom edge: left along the
 * bottom, up the left end, right along the top, down the right end and back along the bottom.
 */
function roundedRectTrack(width: number, height: number, radius: number): Track {
  const left = PLAN.cx - width / 2;
  const right = PLAN.cx + width / 2;
  const top = PLAN.cy - height / 2;
  const bottom = PLAN.cy + height / 2;
  const straightX = width - 2 * radius;
  const straightY = height - 2 * radius;
  const arc = (Math.PI * radius) / 2;
  // Pieces in walking order, each with its length and the point a share `s` (0–1) along it.
  const corner = (cx: number, cy: number, from: number) => (s: number) => ({
    x: cx + radius * Math.cos(from + (Math.PI / 2) * s),
    y: cy + radius * Math.sin(from + (Math.PI / 2) * s),
  });
  const pieces: Array<{ length: number; at: (s: number) => PlanPoint }> = [
    { length: straightX / 2, at: (s) => ({ x: PLAN.cx - (straightX / 2) * s, y: bottom }) },
    { length: arc, at: corner(left + radius, bottom - radius, Math.PI / 2) },
    { length: straightY, at: (s) => ({ x: left, y: bottom - radius - straightY * s }) },
    { length: arc, at: corner(left + radius, top + radius, Math.PI) },
    { length: straightX, at: (s) => ({ x: left + radius + straightX * s, y: top }) },
    { length: arc, at: corner(right - radius, top + radius, (3 * Math.PI) / 2) },
    { length: straightY, at: (s) => ({ x: right, y: top + radius + straightY * s }) },
    { length: arc, at: corner(right - radius, bottom - radius, 0) },
    { length: straightX / 2, at: (s) => ({ x: right - radius - (straightX / 2) * s, y: bottom }) },
  ];
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  return {
    at(t) {
      let distance = (((t % 1) + 1) % 1) * total;
      for (const piece of pieces) {
        if (distance <= piece.length || piece === pieces[pieces.length - 1]) return piece.at(piece.length === 0 ? 0 : Math.min(1, distance / piece.length));
        distance -= piece.length;
      }
      return pieces[0].at(0);
    },
  };
}

/** Steps a track is measured in: plenty for seats spaced to within a fraction of a unit. */
const SAMPLES = 720;

/** `count` points spread evenly along `track` by distance, the k-th at (k + ½) / count of the way round. */
function evenlyAlong(track: Track, count: number): PlanPoint[] {
  const points = Array.from({ length: SAMPLES + 1 }, (_, i) => track.at(i / SAMPLES));
  const along = [0];
  for (let i = 1; i <= SAMPLES; i++) along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = along[SAMPLES];
  return Array.from({ length: count }, (_, k) => {
    const target = (total * (k + 0.5)) / count;
    let i = 1;
    while (along[i] < target) i++;
    const share = (target - along[i - 1]) / (along[i] - along[i - 1]);
    return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * share, y: points[i - 1].y + (points[i].y - points[i - 1].y) * share };
  });
}

const grow = (outline: FeltOutline, by: number): FeltOutline =>
  outline.kind === "ellipse"
    ? { ...outline, rx: outline.rx + by, ry: outline.ry + by }
    : { kind: "rect", x: outline.x - by, y: outline.y - by, width: outline.width + 2 * by, height: outline.height + 2 * by, radius: outline.radius + by };

interface ShapeSpec {
  felt: FeltOutline;
  track: Track;
  /** How far in from the felt's bottom edge the dealer button sits. */
  dealerInset: number;
}

/**
 * Each shape's felt and seat track. The oval is the Phase 4 plan, unchanged. The rectangle's long sides
 * are top and bottom, with the dealer in the middle of the bottom one; its seat track keeps the seats
 * clear of the rail. The round table is a circle as tall as the oval.
 */
const SHAPES: Readonly<Record<TableShape, ShapeSpec>> = {
  oval: { felt: { kind: "ellipse", cx: PLAN.cx, cy: PLAN.cy, rx: 124, ry: 62 }, track: ellipseTrack(172, 124), dealerInset: 16 },
  rectangle: {
    felt: { kind: "rect", x: PLAN.cx - 130, y: PLAN.cy - 64, width: 260, height: 128, radius: 18 },
    track: roundedRectTrack(344, 244, 56),
    dealerInset: 16,
  },
  round: { felt: { kind: "ellipse", cx: PLAN.cx, cy: PLAN.cy, rx: 82, ry: 82 }, track: ellipseTrack(124, 124), dealerInset: 16 },
};

export const TABLE_LAYOUT_LIMITS = { minSeats: 2, maxSeats: 10 } as const;

const cache = new Map<string, TableLayout>();

/**
 * The layout of a `seatCount`-seat table of `shape` (seat counts outside 2–10 are clamped to them).
 * The same object is returned for the same arguments: treat it as read-only.
 */
export function tableLayout(shape: TableShape, seatCount: number): TableLayout {
  const count = Math.min(TABLE_LAYOUT_LIMITS.maxSeats, Math.max(TABLE_LAYOUT_LIMITS.minSeats, Math.floor(Number.isFinite(seatCount) ? seatCount : 0)));
  const key = `${shape}:${count}`;
  const known = cache.get(key);
  if (known) return known;
  const spec = SHAPES[shape] ?? SHAPES[DEFAULT_TABLE_SHAPE];
  const feltBottom = spec.felt.kind === "ellipse" ? spec.felt.cy + spec.felt.ry : spec.felt.y + spec.felt.height;
  const layout: TableLayout = {
    shape,
    width: PLAN.width,
    height: PLAN.height,
    felt: spec.felt,
    rail: grow(spec.felt, PLAN.railWidth),
    dealer: { x: PLAN.cx, y: feltBottom - spec.dealerInset },
    seats: evenlyAlong(spec.track, count).map((point, index) => ({
      seatNumber: index + 1,
      x: point.x,
      y: point.y,
      left: (point.x / PLAN.width) * 100,
      top: (point.y / PLAN.height) * 100,
    })),
  };
  cache.set(key, layout);
  return layout;
}
