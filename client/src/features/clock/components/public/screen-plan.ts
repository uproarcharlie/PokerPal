/**
 * How the TV clock fills its screen (round 5, items 17, 19, 21–23): every size in pixels, worked out
 * from the visible area (inside the edge margin), so the clock always fits one screen exactly and
 * never scrolls, on a 40" TV across a room as on a phone held sideways.
 *
 * Every line is one line (long names are shrunk to fit, then cut short), so each part's height is
 * known before it is drawn, and the parts are given room in a fixed priority. Always: the countdown,
 * the blinds and ante (the level's number too, where the TD shows it), and what comes next. Then: the
 * time to the break, the players, the average stack, the prize pool and the QR code. Then the rest
 * (other figures the TD switched on, the places, the money carried into the pool, the club's name),
 * each only while there is room. A TV's countdown takes about a third of the screen's height, and no
 * word on it is smaller than 3% of the height. The club's logo is centred over it all (round 5, item
 * 24): about 15% of the height in play, and the centrepiece, about 30%, while the clock has not
 * started, on a break and once the game is over (the centre text). Pure: no DOM.
 */

/** A figure tile ("Players 18 / 20"), in the order of priority. */
export interface TileText {
  label: string;
  value: string;
  /** Said smaller after the value ("148 BB"). */
  detail?: string;
  /** Drawn larger: the figures the room looks for first. */
  lead?: boolean;
}

/** The clock's words, for their widths. */
export interface FaceText {
  /** "LEVEL 4" where the TD shows the level's number, else "" (none: the blinds are the headline). */
  title: string;
  /** A break's note ("Colour up"). */
  note: string | null;
  /** "Paused" as large as the blinds ("big"), or "Not started" / "Final level" in a small chip. */
  status: { text: string; size: "big" | "small" } | null;
  /** The widest the countdown gets on this level, digits as 0: "00:00", "0:00:00". */
  timer: string;
  blinds: string | null;
  ante: string | null;
  /** "BREAK IN 52:31", "BREAK — BACK IN 8:12", "NO MORE BREAKS". */
  breakLine: string;
  /** "Next: 600/1,200 · BB ante 1,200". */
  next: string;
}

export interface MoneyText {
  pool: { label: string; amount: string } | null;
  /** Every place offered ("1st", "$500"), best first. */
  payouts: Array<{ place: string; amount: string }>;
  /** Under the places: "Includes $200 carried over from Week 3" (carriedInNote), or null. */
  carried: string | null;
  /** What of the pool no place pays yet, or that the pool is shown once locked. */
  note: string | null;
}

/**
 * The logo's centrepiece and the words under it (round 5, item 24): before the start ("STARTING
 * SOON"), on a break (its countdown), and on a screen with no clock to show (not set up, complete,
 * cancelled).
 */
export interface CentreText {
  /** "Starting soon", "Break — back in", "Tournament complete" (drawn in capitals, as are the status and the note). */
  headline: string;
  /** "Paused", under the headline. */
  status: string | null;
  /** The break's countdown at its widest ("00:00"), or null for none. */
  timer: string | null;
  /** A break's note ("Colour up"). */
  note: string | null;
  /** Smaller lines: what comes next, the first blinds, a message (`wrap`: up to three rows). */
  lines: ReadonlyArray<{ text: string; wrap?: boolean }>;
  /** A button under it all ("See the results"). */
  action: boolean;
}

export interface PlanInput {
  /** The visible area inside the edge margin, in CSS pixels. */
  width: number;
  height: number;
  logo: boolean;
  name: string;
  /** The club's name under the event's (null: not shown). */
  clubName: string | null;
  face: FaceText;
  /** Instead of the face: the logo as the centrepiece, these words under it. */
  centre?: CentreText | null;
  tiles: TileText[];
  money: MoneyText | null;
  qrCaption: string | null;
  /** Steps of shrinking asked for by the overflow guard (0: none): each takes 6% off the height planned for. */
  squeeze?: number;
}

export interface FacePlan {
  width: number;
  title: number;
  note: number;
  status: number;
  timer: number;
  blinds: number;
  ante: number;
  breakLine: number;
  next: number;
  gap: number;
}

export interface CentrePlan {
  width: number;
  /** The logo's box (0: no logo). */
  logo: number;
  logoWidth: number;
  headline: number;
  status: number;
  timer: number;
  note: number;
  /** Each line's size, and the rows it takes. */
  lines: Array<{ size: number; rows: number }>;
  /** The button's height (0: none). */
  action: number;
  gap: number;
}

export interface TilePlan {
  shown: number;
  columns: number;
  label: number;
  /** The value's size, per tile shown. */
  values: number[];
  padX: number;
  padY: number;
  gap: number;
  /** The height they take (px). */
  used: number;
}

export interface MoneyPlan {
  pool: boolean;
  payouts: number;
  /** The money carried in fits under the places. */
  carried: boolean;
  note: boolean;
  label: number;
  amount: number;
  row: number;
  small: number;
  padX: number;
  padY: number;
  gap: number;
}

export interface ScreenPlan {
  layout: "landscape" | "portrait";
  width: number;
  height: number;
  /** `top`: the logo's row (portrait: at least CORNER_BAND, for the corner buttons). No logo here with a centrepiece. */
  header: { logo: number; top: number; name: number; club: number | null; gap: number; height: number };
  /** The clock in play (all 0 with a centrepiece). */
  face: FacePlan;
  centre: CentrePlan | null;
  /** Each side column's width (landscape; 0 without one). */
  side: number;
  gap: number;
  tiles: TilePlan;
  money: MoneyPlan | null;
  qr: { size: number; caption: number } | null;
  /** How tall each part is planned to be (px), for the checks. */
  used: { header: number; face: number; left: number; right: number; below: number };
}

/** A size worked out for the screen, as CSS: "41.5px". */
export const px = (size: number): string => `${size.toFixed(1)}px`;

/** About how many ems a line takes in the display's bold face (Inter, tabular figures). */
export function textEm(text: string): number {
  let em = 0;
  for (const char of text) {
    if (char >= "0" && char <= "9") em += 0.63;
    else if (",.:;·'".includes(char)) em += 0.3;
    else if (char === " ") em += 0.28;
    else if (char === "/") em += 0.4;
    else if (char === "—") em += 1;
    else if (char === "–" || char === "-") em += 0.5;
    else if (char >= "A" && char <= "Z") em += 0.72;
    else if (char >= "a" && char <= "z") em += 0.57;
    else em += 0.66;
  }
  return Math.max(1, em * 1.04);
}

/** The largest size, up to `max`, at which `text` fits `width`. */
const fitText = (text: string, width: number, max: number) => Math.min(max, width / textEm(text));

/** The line heights each part is drawn with (the components use the same). */
export const LINE = { title: 1.1, note: 1.15, status: 1.15, chip: 1.6, timer: 1, blinds: 1.1, ante: 1.15, breakLine: 1.2, next: 1.25, label: 1.25, value: 1.05, row: 1.3 } as const;

interface FaceRatios {
  title: number;
  note: number;
  statusBig: number;
  statusSmall: number;
  timer: number;
  timerMin: number;
  blinds: number;
  ante: number;
  breakLine: number;
  next: number;
  nextMin: number;
  gap: number;
}

const LANDSCAPE_FACE: FaceRatios = {
  title: 0.065,
  note: 0.045,
  statusBig: 0.065,
  statusSmall: 0.032,
  timer: 0.34,
  timerMin: 0.24,
  blinds: 0.105,
  ante: 0.062,
  breakLine: 0.058,
  next: 0.04,
  nextMin: 0.03,
  gap: 0.012,
};

const PORTRAIT_FACE: FaceRatios = {
  title: 0.045,
  note: 0.032,
  statusBig: 0.05,
  statusSmall: 0.024,
  timer: 0.2,
  timerMin: 0.12,
  blinds: 0.07,
  ante: 0.042,
  breakLine: 0.045,
  next: 0.03,
  nextMin: 0.022,
  gap: 0.01,
};

function faceHeight(face: FaceText, plan: FacePlan): number {
  const parts = [
    face.title ? plan.title * LINE.title : 0,
    face.note ? plan.note * LINE.note : 0,
    face.status ? plan.status * (face.status.size === "big" ? LINE.status : LINE.chip) : 0,
    plan.timer * LINE.timer,
    face.blinds ? plan.blinds * LINE.blinds : 0,
    face.ante ? plan.ante * LINE.ante : 0,
    plan.breakLine * LINE.breakLine,
    plan.next * LINE.next,
  ].filter((part) => part > 0);
  return parts.reduce((sum, part) => sum + part, 0) + plan.gap * (parts.length - 1);
}

/** The clock's sizes for a column `width` wide and `room` tall: the countdown gives way first, then everything evenly. */
function planFace(face: FaceText, width: number, room: number, H: number, r: FaceRatios): FacePlan {
  const line = width * 0.98;
  const plan: FacePlan = {
    width,
    title: face.title ? fitText(face.title, line, r.title * H) : 0,
    note: face.note ? fitText(face.note, line, r.note * H) : 0,
    status: face.status ? (face.status.size === "big" ? fitText(face.status.text, line, r.statusBig * H) : r.statusSmall * H) : 0,
    timer: fitText(face.timer, line, r.timer * H),
    blinds: face.blinds ? fitText(face.blinds, line, r.blinds * H) : 0,
    ante: face.ante ? fitText(face.ante, line, r.ante * H) : 0,
    breakLine: fitText(face.breakLine, line, r.breakLine * H),
    // Never below the minimum: a long line is cut short instead.
    next: Math.max(r.nextMin * H, fitText(face.next, line, r.next * H)),
    gap: r.gap * H,
  };
  const over = faceHeight(face, plan) - room;
  if (over > 0) plan.timer = Math.max(r.timerMin * H, plan.timer - over);
  const height = faceHeight(face, plan);
  if (height > room) {
    const scale = room / height;
    for (const key of ["title", "note", "status", "timer", "blinds", "ante", "breakLine", "next", "gap"] as const) plan[key] *= scale;
  }
  return plan;
}

/** Lines `text` takes at `size` in `width` (uppercase labels run wider: `widen`). */
const linesOf = (text: string, size: number, width: number, widen = 0.92) => Math.max(1, Math.ceil((textEm(text) * size * widen) / Math.max(1, width)));

/** A tile's label takes one line, or two when it is long ("Re-buys & add-ons close in"). */
const labelLines = (tile: TileText, label: number, width: number) => Math.min(2, linesOf(tile.label.toUpperCase(), label, width, 1.1));

/** A face with nothing to draw: the centrepiece takes its place. */
const noFace = (width: number): FacePlan => ({ width, title: 0, note: 0, status: 0, timer: 0, blinds: 0, ante: 0, breakLine: 0, next: 0, gap: 0 });

interface CentreRatios {
  logo: number;
  logoMin: number;
  headline: number;
  status: number;
  timer: number;
  timerMin: number;
  note: number;
  line: number;
  lineMin: number;
  gap: number;
}

const LANDSCAPE_CENTRE: CentreRatios = { logo: 0.3, logoMin: 0.15, headline: 0.075, status: 0.06, timer: 0.22, timerMin: 0.14, note: 0.045, line: 0.04, lineMin: 0.03, gap: 0.016 };
const PORTRAIT_CENTRE: CentreRatios = { logo: 0.2, logoMin: 0.09, headline: 0.05, status: 0.045, timer: 0.14, timerMin: 0.09, note: 0.032, line: 0.03, lineMin: 0.022, gap: 0.012 };

/** The tallest a wrapped centre line runs. */
const MAX_ROWS = 3;

/** A logo's box is never wider than three times its height. */
const LOGO_ASPECT = 3;

export function centreHeight(plan: CentrePlan): number {
  const parts = [
    plan.logo,
    plan.headline * LINE.title,
    plan.status * LINE.status,
    plan.timer * LINE.timer,
    plan.note * LINE.note,
    ...plan.lines.map((line) => line.size * LINE.next * line.rows),
    plan.action,
  ].filter((part) => part > 0);
  return parts.reduce((sum, part) => sum + part, 0) + plan.gap * (parts.length - 1);
}

/** The centrepiece in a column `width` wide and `room` tall: the logo gives way first, then the countdown, then everything evenly. */
function planCentre(centre: CentreText, logo: boolean, width: number, room: number, H: number, r: CentreRatios): CentrePlan {
  const line = width * 0.98;
  const lines = centre.lines.map(({ text, wrap }) => {
    if (!wrap) return { size: Math.max(r.lineMin * H, fitText(text, line, r.line * H)), rows: 1 };
    const size = r.line * H;
    return { size, rows: Math.min(MAX_ROWS, linesOf(text, size, line, 1)) };
  });
  const plan: CentrePlan = {
    width,
    logo: logo ? r.logo * H : 0,
    logoWidth: 0,
    headline: fitText(centre.headline.toUpperCase(), line, r.headline * H),
    status: centre.status ? fitText(centre.status.toUpperCase(), line, r.status * H) : 0,
    timer: centre.timer ? fitText(centre.timer, line, r.timer * H) : 0,
    note: centre.note ? fitText(centre.note.toUpperCase(), line, r.note * H) : 0,
    lines,
    action: centre.action ? Math.max(44, 0.06 * H) : 0,
    gap: r.gap * H,
  };
  let over = centreHeight(plan) - room;
  if (over > 0 && plan.logo > 0) {
    const logoNow = plan.logo;
    plan.logo = Math.max(r.logoMin * H, logoNow - over);
    over -= logoNow - plan.logo;
  }
  if (over > 0 && plan.timer > 0) plan.timer = Math.max(Math.min(plan.timer, r.timerMin * H), plan.timer - over);
  const height = centreHeight(plan);
  if (height > room) {
    // The button keeps a thumb's height.
    const scale = Math.max(0, room - plan.action) / Math.max(1, height - plan.action);
    for (const key of ["logo", "headline", "status", "timer", "note", "gap"] as const) plan[key] *= scale;
    plan.lines = plan.lines.map((each) => ({ ...each, size: each.size * scale }));
  }
  plan.logoWidth = Math.min(plan.logo * LOGO_ASPECT, width);
  return plan;
}

/** Figure tiles stacked in a column (or rows of `columns`), as many as fit `room` in their order. */
function planTiles(tiles: readonly TileText[], width: number, room: number, H: number, columns: number, sizes: { label: number; value: number; lead: number }): TilePlan {
  const padY = 0.012 * H;
  const padX = Math.max(8, 0.018 * H);
  const gap = 0.012 * H;
  const label = sizes.label * H;
  const tileWidth = (width - gap * (columns - 1)) / columns - 2 * padX;
  const valueOf = (tile: TileText) => {
    const max = (tile.lead ? sizes.lead : sizes.value) * H;
    return fitText(tile.detail ? `${tile.value} ${tile.detail.replace(/./g, "0").slice(0, Math.ceil(tile.detail.length * 0.55))}` : tile.value, tileWidth, max);
  };
  const rowHeight = (row: readonly TileText[]) =>
    label * LINE.label * Math.max(...row.map((tile) => labelLines(tile, label, tileWidth))) + Math.max(...row.map((tile) => (tile.lead ? sizes.lead : sizes.value) * H)) * LINE.value + 2 * padY;
  let used = 0;
  let shown = 0;
  for (let at = 0; at < tiles.length; at += columns) {
    const row = tiles.slice(at, at + columns);
    const height = rowHeight(row) + (shown > 0 ? gap : 0);
    if (used + height > room) break;
    used += height;
    shown += row.length;
  }
  return { shown, columns, label, values: tiles.slice(0, shown).map(valueOf), padX, padY, gap, used };
}

interface ColumnPlan {
  money: MoneyPlan | null;
  qr: { size: number; caption: number } | null;
  used: number;
}

/**
 * The money and the QR code in a column `width` wide and `room` tall, by priority: the pool, the QR
 * code (at least 15% of the height, else left out), the places one by one, the money carried in, then
 * the note.
 */
function planMoneyColumn(money: MoneyText | null, qrCaption: string | null, width: number, room: number, H: number, qrMax: number, k = 1): ColumnPlan {
  const padY = 0.012 * H;
  const padX = Math.max(8, 0.018 * H * k);
  const gap = 0.015 * H;
  const inner = width - 2 * padX;
  // The pool's label with its "est." mark fits the column on one line.
  const label = fitText("PRIZE POOL  EST.", inner * 0.95, 0.03 * H * k);
  const small = 0.03 * H * k;
  const amount = money?.pool ? fitText(money.pool.amount, inner, 0.068 * H * k) : 0;
  const widestRow = money?.payouts.reduce((wide, row) => (textEm(`${row.place}  ${row.amount}`) > textEm(wide) ? `${row.place}  ${row.amount}` : wide), "") ?? "";
  const row = Math.max(0.03 * H * k, fitText(widestRow || "0", inner, 0.036 * H * k));
  let used = 0;
  const add = (height: number) => {
    used += (used > 0 ? gap : 0) + height;
  };
  const fits = (height: number) => used + (used > 0 ? gap : 0) + height <= room;

  const poolHeight = label * LINE.label + amount * 1.1 + 2 * padY;
  const pool = Boolean(money?.pool) && fits(poolHeight);
  if (pool) add(poolHeight);

  let qr: ColumnPlan["qr"] = null;
  if (qrCaption !== null) {
    const caption = 0.032 * H * k;
    const captionHeight = caption * LINE.label * Math.min(2, linesOf(qrCaption, caption, width));
    const left = room - used - (used > 0 ? gap : 0) - captionHeight - 0.01 * H;
    const size = Math.min(width, qrMax, left);
    if (size >= 0.15 * H) {
      qr = { size, caption };
      add(size + 0.01 * H + captionHeight);
    }
  }

  let payouts = 0;
  let carried = false;
  if (pool && money) {
    while (payouts < money.payouts.length && used + row * LINE.row <= room) {
      used += row * LINE.row;
      payouts++;
    }
    // Up to two rows: a longer one is cut short.
    const carriedHeight = money.carried ? small * LINE.row * Math.min(2, linesOf(money.carried, small, inner)) : 0;
    carried = money.carried !== null && used + carriedHeight <= room;
    if (carried) used += carriedHeight;
  }
  const noteHeight = money?.note ? small * LINE.row * Math.min(3, linesOf(money.note, small, inner)) + (pool ? 0 : 2 * padY) : 0;
  const note = Boolean(money?.note) && (pool ? used + noteHeight <= room : fits(noteHeight));
  if (note) used += pool ? noteHeight : (used > 0 ? gap : 0) + noteHeight;

  const shown = pool || note;
  return {
    money: money && shown ? { pool, payouts, carried, note, label, amount, row, small, padX, padY, gap } : null,
    qr,
    used,
  };
}

/** Room for the screen's corner buttons (44 px targets) beside the header. */
export const CORNER_BAND = 48;

/**
 * The event's name and the club's over the clock, the logo centred above both (round 5, items 19 and
 * 24; none here while the logo is the centrepiece). The corners hold the status and the screen's
 * buttons: the name keeps clear of them (landscape), or the logo's row does (portrait, where the name
 * has the full width under it).
 */
function planHeader(input: PlanInput, W: number, H: number, portrait: boolean) {
  const logo = input.logo && !input.centre ? Math.round((portrait ? 0.08 : 0.15) * H) : 0;
  const top = portrait ? Math.max(logo, CORNER_BAND) : logo;
  const gap = top > 0 ? 0.01 * H : 0;
  const name = Math.max((portrait ? 0.025 : 0.03) * H, fitText(input.name, (portrait ? 0.92 : 0.64) * W, (portrait ? 0.04 : 0.055) * H));
  const club = input.clubName && H >= (portrait ? 900 : 560) ? (portrait ? 0.022 : 0.03) * H : null;
  const height = top + gap + name * LINE.title + (club ? club * LINE.label : 0) + 0.02 * H;
  return { logo, top, name, club, gap, height };
}

export function planScreen(input: PlanInput): ScreenPlan {
  const W = Math.max(1, input.width);
  const H = Math.max(1, input.height) * (1 - 0.06 * Math.min(8, input.squeeze ?? 0));
  const portrait = W / H < 1.2;
  const header = planHeader(input, W, H, portrait);
  const body = H - header.height;

  if (!portrait) {
    const hasSides = input.tiles.length > 0 || input.money !== null || input.qrCaption !== null;
    const side = hasSides ? Math.round(Math.min(0.22 * W, 0.5 * H)) : 0;
    const gap = hasSides ? 0.015 * W : 0;
    const middle = W - 2 * side - 2 * gap;
    const centre = input.centre ? planCentre(input.centre, input.logo, middle, body, H, LANDSCAPE_CENTRE) : null;
    const face = centre ? noFace(middle) : planFace(input.face, middle, body, H, LANDSCAPE_FACE);
    const sizes = { label: 0.03, value: 0.05, lead: 0.064 };
    const tiles = planTiles(input.tiles, side, body, H, 1, sizes);
    const right = planMoneyColumn(input.money, input.qrCaption, side, body, H, 0.26 * H);
    return {
      layout: "landscape",
      width: W,
      height: H,
      header,
      face,
      centre,
      side,
      gap,
      tiles,
      money: right.money,
      qr: right.qr,
      used: { header: header.height, face: centre ? centreHeight(centre) : faceHeight(input.face, face), left: tiles.used, right: right.used, below: 0 },
    };
  }

  // Portrait (a phone held upright, a tablet on a stand): the clock, then the rest under it in their order.
  const gap = 0.015 * H;
  const centre = input.centre ? planCentre(input.centre, input.logo, W, body, H, PORTRAIT_CENTRE) : null;
  const face = centre ? noFace(W) : planFace(input.face, W, body, H, PORTRAIT_FACE);
  const faceUsed = centre ? centreHeight(centre) : faceHeight(input.face, face);
  let room = body - faceUsed - gap;
  let below = 0;
  const take = (height: number) => {
    below += (below > 0 ? gap : 0) + height;
    room -= height + gap;
  };
  const sizes = { label: 0.022, value: 0.036, lead: 0.042 };
  // The players and the average stack, side by side.
  const first = planTiles(input.tiles.slice(0, 2), W, room, H, 2, sizes);
  if (first.shown > 0) take(first.used);

  // The prize pool beside the QR code (each alone across the screen without the other).
  const twoUp = input.money !== null && input.qrCaption !== null;
  const columnWidth = twoUp ? (W - gap) / 2 : W;
  let qr: ScreenPlan["qr"] = null;
  let qrBlock = 0;
  if (input.qrCaption !== null) {
    const caption = 0.026 * H;
    const captionHeight = caption * LINE.label * Math.min(2, linesOf(input.qrCaption, caption, columnWidth));
    const size = Math.min(columnWidth, (twoUp ? 0.2 : 0.24) * H, room - captionHeight - 0.01 * H);
    if (size >= 0.12 * H) {
      qr = { size, caption };
      qrBlock = size + 0.01 * H + captionHeight;
    }
  }
  const column = planMoneyColumn(input.money, null, columnWidth, qr ? Math.min(room, Math.max(qrBlock, 0.12 * H)) : room, H, 0, 0.8);
  const pair = Math.max(qrBlock, column.used);
  if (pair > 0 && pair <= room) take(pair);
  else qr = null;

  const rest = planTiles(input.tiles.slice(first.shown), W, Math.max(0, room), H, 2, sizes);
  if (rest.shown > 0) take(rest.used);
  const tiles: TilePlan = { ...first, shown: first.shown + rest.shown, values: [...first.values, ...rest.values], used: first.used + (rest.shown > 0 ? gap + rest.used : 0) };
  return {
    layout: "portrait",
    width: W,
    height: H,
    header,
    face,
    centre,
    side: 0,
    gap,
    tiles,
    money: pair > 0 && pair <= body ? column.money : null,
    qr,
    used: { header: header.height, face: faceUsed, left: 0, right: 0, below },
  };
}
