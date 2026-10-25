/**
 * Where the seats of a table plan sit: round an oval, as at the venue. The plan is drawn in a box of
 * PLAN.width × PLAN.height units (the felt's SVG viewBox), and each seat is placed over it in percent
 * of that box, so the seats keep their size (a 40 px tap target) however wide the card is.
 */
export const PLAN = {
  width: 400,
  height: 300,
  cx: 200,
  cy: 150,
  /** The ellipse the seats' centres sit on, clear of the rail so the names under the far seats stay off the felt. */
  seatRx: 172,
  seatRy: 124,
  /** The felt, and the rail round it. */
  feltRx: 124,
  feltRy: 62,
  railWidth: 10,
} as const;

export interface SeatPoint {
  /** Percent of the plan's width, from its left edge. */
  left: number;
  /** Percent of the plan's height, from its top edge. */
  top: number;
}

/** Steps the seat ellipse is measured in: plenty for seats spaced to within a fraction of a pixel. */
const SAMPLES = 720;

const cache = new Map<number, readonly SeatPoint[]>();

/**
 * The seats of a `seatCount`-seat table, seat 1 first. The dealer sits at the bottom centre; seat 1 is
 * on the dealer's left and the numbers run clockwise, the order players are dealt to. Seats are spaced
 * evenly along the ellipse (not by angle, which bunches them at the ends of a long table).
 */
export function seatPositions(seatCount: number): readonly SeatPoint[] {
  const count = Math.max(1, Math.floor(seatCount));
  const known = cache.get(count);
  if (known) return known;

  // From the dealer (t = π/2 is the bottom centre, y pointing down), t growing runs clockwise on screen.
  const points = Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = Math.PI / 2 + (2 * Math.PI * i) / SAMPLES;
    return { x: PLAN.cx + PLAN.seatRx * Math.cos(t), y: PLAN.cy + PLAN.seatRy * Math.sin(t) };
  });
  const along = [0];
  for (let i = 1; i <= SAMPLES; i++) {
    along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = along[SAMPLES];

  const seats = Array.from({ length: count }, (_, k) => {
    const target = (total * (k + 0.5)) / count;
    let i = 1;
    while (along[i] < target) i++;
    const share = (target - along[i - 1]) / (along[i] - along[i - 1]);
    const x = points[i - 1].x + (points[i].x - points[i - 1].x) * share;
    const y = points[i - 1].y + (points[i].y - points[i - 1].y) * share;
    return { left: (x / PLAN.width) * 100, top: (y / PLAN.height) * 100 };
  });
  cache.set(count, seats);
  return seats;
}

/** The name written under a seat: the first word of the player's name. */
export function seatName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
