/**
 * Payout structures and how a prize pool is split between places. PURE: no runtime imports outside
 * shared/domain.
 *
 * Shares are integer basis points (10000 = 100%). `allocatePayouts` is the v2 split that finalize, the
 * preview and every screen use from Phase 2 onwards. A custom structure may also set each place as a
 * percentage of the pool or a fixed amount (round 5, the payout editor): `placeAmounts` gives what
 * each such place pays as set (shares floored to whole dollars); where any difference from the money
 * available goes is ./prize-difference's (round 5, item 16).
 */
import { formatMoney, type Cents } from "./money";
import { DEFAULT_PRIZE_DIFFERENCE, settleDifference, type PrizeDifference, type PrizeDifferenceChoice } from "./prize-difference";

export const PAYOUT_ALGORITHM = "v2-floor-remainder-first" as const;
export type PayoutAlgorithm = typeof PAYOUT_ALGORITHM;

export type StandardPayoutKey = "standard" | "top3" | "top5" | "top8" | "top9";
export type PayoutStructureKey = StandardPayoutKey | "custom";

const FULL_POOL_BP = 10_000;
const MAX_CUSTOM_PLACES = 50;

export const PAYOUT_PLACE_LIMITS = {
  maxPlaces: MAX_CUSTOM_PLACES,
  /** The most one fixed place may pay: $1,000,000. */
  maxAmountCents: 100_000_000,
} as const;

/**
 * The tables every tournament has been paid from (server/routes.ts:878-884 at dddf8ad), in basis
 * points. Never change a row: historical payouts were worked out from them.
 */
export const PAYOUT_STRUCTURES: Readonly<Record<StandardPayoutKey, readonly number[]>> = Object.freeze({
  standard: Object.freeze([5000, 3000, 2000]),
  top3: Object.freeze([5000, 3000, 2000]),
  top5: Object.freeze([4000, 2500, 2000, 1000, 500]),
  top8: Object.freeze([3500, 2200, 1500, 1200, 800, 400, 200, 200]),
  top9: Object.freeze([3000, 2000, 1500, 1200, 900, 600, 400, 200, 200]),
});

/**
 * Every structure a tournament may use, in menu order: the tables above, then custom. Built from the
 * tables, so a structure added there is accepted by the API and offered by the create form at once.
 */
export const PAYOUT_STRUCTURE_KEYS = [
  ...(Object.keys(PAYOUT_STRUCTURES) as StandardPayoutKey[]),
  "custom",
] as PayoutStructureKey[] as [PayoutStructureKey, ...PayoutStructureKey[]];

function percentList(basisPoints: readonly number[]): string {
  return basisPoints.map((bp) => String(bp / 100)).join("/");
}

/** Option labels built from the tables themselves, so a label can never disagree with what is paid. */
export const PAYOUT_STRUCTURE_LABELS: Readonly<Record<PayoutStructureKey, string>> = Object.freeze({
  standard: `Standard (${percentList(PAYOUT_STRUCTURES.standard)})`,
  top3: `Top 3 (${percentList(PAYOUT_STRUCTURES.top3)})`,
  top5: `Top 5 (${percentList(PAYOUT_STRUCTURES.top5)})`,
  top8: `Top 8 (${percentList(PAYOUT_STRUCTURES.top8)})`,
  top9: `Top 9 (${percentList(PAYOUT_STRUCTURES.top9)})`,
  custom: `Custom (pays Standard ${percentList(PAYOUT_STRUCTURES.standard)} until set up)`,
});

function isStandardKey(key: string | null | undefined): key is StandardPayoutKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(PAYOUT_STRUCTURES, key);
}

/**
 * One paid place of a custom structure: a share of the pool (basis points) or a fixed amount. A place
 * set as a percentage is paid that share of the whole pool rounded down to whole dollars; a fixed
 * place is paid its amount; where whatever is left over goes is the tournament's choice
 * (./prize-difference).
 */
export type PayoutPlace = { kind: "percent"; basisPoints: number } | { kind: "amount"; amountCents: Cents };

/** The `v` of the per-place form `tournaments.custom_payouts` holds when a place is fixed (round 5). */
export const CUSTOM_PAYOUTS_VERSION = 2 as const;

/** A problem with a custom structure: `place` is 1-based, or null for the structure as a whole. */
export interface PayoutPlaceProblem {
  place: number | null;
  message: string;
}

export type CustomPayoutsResult = { ok: true; places: PayoutPlace[] } | { ok: false; error: string };

const percentText = (basisPoints: number) => `${basisPoints / 100}%`;

/**
 * What is wrong with a custom structure, whatever the pool: 1 to 50 places; a percentage above 0 and
 * at most 100 with at most 2 decimal places (whole basis points); a fixed amount of whole cents above
 * 0 and at most PAYOUT_PLACE_LIMITS.maxAmountCents; the percentages adding up to at most 100%; and,
 * among the places of each kind, none paying more than one above it. (Fixed amounts may add up to more
 * than a pool: the club adds the rest.) Empty when the structure can be paid.
 */
export function payoutPlacesProblems(places: readonly PayoutPlace[]): PayoutPlaceProblem[] {
  const problems: PayoutPlaceProblem[] = [];
  if (places.length === 0 || places.length > MAX_CUSTOM_PLACES) {
    problems.push({ place: null, message: `Pay 1 to ${MAX_CUSTOM_PLACES} places` });
  }
  let percentTotal = 0;
  let lastPercent: number | null = null;
  let lastAmount: number | null = null;
  places.forEach((place, index) => {
    const number = index + 1;
    if (place.kind === "percent") {
      const bp = place.basisPoints;
      if (!Number.isSafeInteger(bp) || bp <= 0 || bp > FULL_POOL_BP) {
        problems.push({ place: number, message: `Place ${number} must be a percentage above 0 and at most 100, with at most 2 decimal places` });
        return;
      }
      if (lastPercent !== null && bp > lastPercent) problems.push({ place: number, message: `Place ${number} pays a bigger share than a place above it` });
      lastPercent = bp;
      percentTotal += bp;
    } else {
      const cents = place.amountCents;
      if (!Number.isSafeInteger(cents) || cents <= 0 || cents > PAYOUT_PLACE_LIMITS.maxAmountCents) {
        problems.push({ place: number, message: `Place ${number} must be an amount above $0 and at most ${formatMoney(PAYOUT_PLACE_LIMITS.maxAmountCents)}` });
        return;
      }
      if (lastAmount !== null && cents > lastAmount) problems.push({ place: number, message: `Place ${number} pays more than a place above it` });
      lastAmount = cents;
    }
  });
  if (percentTotal > FULL_POOL_BP) problems.push({ place: null, message: `The percentages add up to ${percentText(percentTotal)}, over 100%` });
  return problems;
}

function parseLegacyList(parsed: unknown[]): CustomPayoutsResult {
  const basisPoints: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const percent: unknown = parsed[i];
    const place = i + 1;
    if (typeof percent !== "number" || !(percent > 0) || percent > 100) {
      return { ok: false, error: `Place ${place} must be a percentage above 0 and at most 100` };
    }
    const bp = Math.round(percent * 100);
    if (Math.abs(percent * 100 - bp) > 1e-6) {
      return { ok: false, error: `Place ${place} has more than 2 decimal places` };
    }
    if (i > 0 && bp > basisPoints[i - 1]) {
      return { ok: false, error: `Place ${place} pays more than place ${place - 1}` };
    }
    basisPoints.push(bp);
  }
  const total = basisPoints.reduce((sum, bp) => sum + bp, 0);
  if (total !== FULL_POOL_BP) {
    return { ok: false, error: `Custom payouts add up to ${total / 100}%, not 100%` };
  }
  return { ok: true, places: basisPoints.map((bp) => ({ kind: "percent", basisPoints: bp })) };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** One stored place of the per-place form: `{ "percent": 50 }` or `{ "amountCents": 30000 }`, nothing else. */
function storedPlace(value: unknown): PayoutPlace | null {
  if (!isObject(value) || Object.keys(value).length !== 1) return null;
  if (typeof value.percent === "number" && Number.isFinite(value.percent)) {
    // More than 2 decimal places stays a fraction of a basis point, which payoutPlacesProblems refuses.
    const bp = Math.round(value.percent * 100);
    return { kind: "percent", basisPoints: Math.abs(value.percent * 100 - bp) > 1e-6 ? value.percent * 100 : bp };
  }
  if (typeof value.amountCents === "number") return { kind: "amount", amountCents: value.amountCents };
  return null;
}

/**
 * Reads `tournaments.custom_payouts`, in either form:
 * - a JSON array of percentages for 1st place onwards, e.g. "[50,30,20]" (every structure stored
 *   before round 5, and still what an all-percentage structure adding up to 100% is stored as): each
 *   above 0 with at most 2 decimal places, none more than the one above it, adding up to exactly 100;
 * - the per-place form, `{"v":2,"places":[{"percent":50},{"amountCents":30000},...]}`, checked by
 *   `payoutPlacesProblems` (the percentages may add up to less than 100%: the rest goes to 1st).
 */
export function parseCustomPayouts(raw: string | null | undefined): CustomPayoutsResult {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ok: false, error: "Custom payouts are not set up" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Custom payouts are not valid JSON" };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || parsed.length > MAX_CUSTOM_PLACES) {
      return { ok: false, error: `Custom payouts must be a list of 1 to ${MAX_CUSTOM_PLACES} percentages` };
    }
    return parseLegacyList(parsed);
  }
  if (!isObject(parsed) || parsed.v !== CUSTOM_PAYOUTS_VERSION || !Array.isArray(parsed.places)) {
    return { ok: false, error: `Custom payouts must be a list of 1 to ${MAX_CUSTOM_PLACES} percentages` };
  }
  const places: PayoutPlace[] = [];
  for (let i = 0; i < parsed.places.length; i++) {
    const place = storedPlace(parsed.places[i]);
    if (!place) return { ok: false, error: `Place ${i + 1} must be a percentage or an amount` };
    places.push(place);
  }
  const [problem] = payoutPlacesProblems(places);
  return problem ? { ok: false, error: problem.message } : { ok: true, places };
}

/** Every place a percentage, never increasing, adding up to exactly 100%: a classic share table. */
function sharesOf(places: readonly PayoutPlace[]): number[] | null {
  const shares: number[] = [];
  for (const place of places) {
    if (place.kind !== "percent") return null;
    shares.push(place.basisPoints);
  }
  const total = shares.reduce((sum, bp) => sum + bp, 0);
  return total === FULL_POOL_BP && shares.every((bp, i) => i === 0 || bp <= shares[i - 1]) ? shares : null;
}

/**
 * What `tournaments.custom_payouts` stores for `places` (already checked with payoutPlacesProblems):
 * the classic array of percentages ("[50,30,20]") when every place is a percentage, never increasing,
 * adding up to 100%, which every build since Phase 2 reads; the per-place form otherwise.
 */
export function serializeCustomPayouts(places: readonly PayoutPlace[]): string {
  const shares = sharesOf(places);
  if (shares) return JSON.stringify(shares.map((bp) => bp / 100));
  return JSON.stringify({
    v: CUSTOM_PAYOUTS_VERSION,
    places: places.map((place) => (place.kind === "percent" ? { percent: place.basisPoints / 100 } : { amountCents: place.amountCents })),
  });
}

export interface ResolvedPayoutStructure {
  /** The stored `payout_structure`, or "standard" when it is empty. */
  requested: string;
  /** The structure actually paid. */
  used: PayoutStructureKey;
  /**
   * Each place's share of the pool. For a structure of percentages adding up to 100% (every standard
   * table, most custom ones) these are the shares as set. For `places`, each place's share of what the
   * places pay as set from the pool resolved against (1st's taking what rounding leaves, adding up to
   * 10000); computePrizePool replaces them with each place's share of what is finally paid.
   */
  basisPoints: readonly number[];
  /**
   * Only for a custom structure with a fixed place, or percentages adding up to less than 100%: each
   * place as it was set. What each pays as set is `placeAmounts(pool, places)`.
   */
  places?: readonly PayoutPlace[];
  /** Set when the requested structure could not be used and Standard is paid instead. */
  error?: string;
  /**
   * Set when `places` mix percentages and fixed amounts so that, from this pool, a place pays more
   * than the one above it ("From the $1,000 prize pool 2nd pays $600, more than 1st ($400)"). They are
   * paid as set; the payout editor and finalize say so first.
   */
  warning?: string;
}

/**
 * The shares a tournament pays out of a pool of `poolCents`. A valid custom structure is honoured; an
 * invalid one, or an unknown key, pays Standard and says why. (Before Phase 2, "custom" always paid
 * Standard.) The pool matters only to a custom structure with `places`: its fixed places are paid as
 * set even when they add up to more than the pool (the club adds the rest: ./prize-difference), and
 * computePrizePool works out the `warning` from what each place is finally paid.
 */
export function resolvePayoutStructure(
  structure: string | null | undefined,
  customPayouts: string | null | undefined,
  poolCents: Cents = 0,
): ResolvedPayoutStructure {
  const requested = structure || "standard";
  if (isStandardKey(requested)) {
    return { requested, used: requested, basisPoints: PAYOUT_STRUCTURES[requested] };
  }
  const standard = { requested, used: "standard" as const, basisPoints: PAYOUT_STRUCTURES.standard };
  if (requested !== "custom") {
    return { ...standard, error: `Unknown payout structure "${requested}", so Standard is paid instead` };
  }
  const custom = parseCustomPayouts(customPayouts);
  if (!custom.ok) return { ...standard, error: `${custom.error}, so Standard is paid instead` };
  const shares = sharesOf(custom.places);
  if (shares) return { requested, used: "custom", basisPoints: shares };
  return { requested, used: "custom", basisPoints: sharesOfAmounts(placeAmounts(poolCents, custom.places)), places: custom.places };
}

/**
 * The places that, paid `amounts` from `poolCents`, pay more than the place above them. Within each
 * kind payoutPlacesProblems keeps the order whatever the pool; a percentage beside a fixed amount can
 * swap it (30% and $600 from $1,000 pay 1st $300 and 2nd $600), so it is checked against the real pool.
 */
export function outOfOrderPlaces(poolCents: Cents, amounts: readonly Cents[]): PayoutPlaceProblem[] {
  const problems: PayoutPlaceProblem[] = [];
  for (let i = 1; i < amounts.length; i++) {
    if (amounts[i] <= amounts[i - 1]) continue;
    problems.push({
      place: i + 1,
      message: `From the ${formatMoney(poolCents)} prize pool ${placeName(i + 1)} pays ${formatMoney(amounts[i])}, more than ${placeName(i)} (${formatMoney(amounts[i - 1])})`,
    });
  }
  return problems;
}

/**
 * Each amount's share of their total in whole basis points, 1st's taking what rounding leaves so they
 * add up to 10000; all of it to 1st when they add up to nothing.
 */
export function sharesOfAmounts(amounts: readonly Cents[]): number[] {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const shares = amounts.map((amount) => (total > 0 ? Math.round((amount * FULL_POOL_BP) / total) : 0));
  if (shares.length > 0) shares[0] += FULL_POOL_BP - shares.reduce((sum, bp) => sum + bp, 0);
  return shares;
}

export interface Payout {
  /** 1 for 1st place. */
  position: number;
  basisPoints: number;
  /** basisPoints / 100, e.g. 35 for 35%. */
  percentage: number;
  amountCents: Cents;
  /** Only for custom places: how the place was set (its basisPoints are then its share of what is paid). */
  kind?: PayoutPlace["kind"];
}

/**
 * The v2 split: each place gets its share of the pool rounded down to whole dollars, and the dollars
 * and cents left over go to 1st, so the places add up to the pool exactly and never overpay. A pool of
 * zero or less pays nothing.
 *
 * Throws a RangeError if the pool is not a whole number of cents, or the shares are not positive whole
 * basis points that never increase and add up to 10000.
 */
export function allocatePayouts(poolCents: Cents, basisPoints: readonly number[]): Payout[] {
  assertShares(basisPoints);
  if (!Number.isSafeInteger(poolCents) || !Number.isSafeInteger(poolCents * FULL_POOL_BP)) {
    throw new RangeError(`Cannot split a pool of ${poolCents} cents exactly`);
  }
  if (poolCents <= 0) return [];
  // pool * bp / 10000 is the share in cents; dividing by a further 100 floors it to whole dollars.
  const amounts = basisPoints.map((bp) => Math.floor((poolCents * bp) / (FULL_POOL_BP * 100)) * 100);
  amounts[0] += poolCents - amounts.reduce((sum, amount) => sum + amount, 0);
  return basisPoints.map((bp, i) => ({
    position: i + 1,
    basisPoints: bp,
    percentage: bp / 100,
    amountCents: amounts[i],
  }));
}

/**
 * What each place of a custom structure pays as set from a pool: a percentage place its share of the
 * whole pool rounded down to whole dollars (nothing from a pool of zero or less), a fixed place its
 * amount. Nothing is added to 1st here: where whatever is left over goes is the tournament's choice
 * (./prize-difference). Throws a RangeError for places payoutPlacesProblems refuses, or a pool that is
 * not a safe whole number of cents.
 */
export function placeAmounts(poolCents: Cents, places: readonly PayoutPlace[]): Cents[] {
  if (payoutPlacesProblems(places).length > 0) throw new RangeError("Invalid payout places");
  if (!Number.isSafeInteger(poolCents) || !Number.isSafeInteger(poolCents * FULL_POOL_BP)) {
    throw new RangeError(`Cannot split a pool of ${poolCents} cents exactly`);
  }
  return places.map((place) => (place.kind === "amount" ? place.amountCents : percentOfPool(poolCents, place.basisPoints)));
}

/** A share of the pool rounded down to whole dollars; nothing from a pool of zero or less. */
const percentOfPool = (poolCents: Cents, basisPoints: number): Cents =>
  poolCents > 0 ? Math.floor((poolCents * basisPoints) / (FULL_POOL_BP * 100)) * 100 : 0;

/* ---------- the payout editor (round 5, item 1) ---------- */

/** "1st", "2nd", "3rd", "4th", ..., "11th", "21st". */
export function placeName(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${position}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[position % 10] ?? "th";
  return `${position}${suffix}`;
}

/** "50%", "$300". */
export function placeValueText(place: PayoutPlace): string {
  return place.kind === "percent" ? percentText(place.basisPoints) : formatMoney(place.amountCents);
}

/** "1st 50%, 2nd 30%, 3rd $200": the activity feed's wording of a custom structure. */
export function describePayoutPlaces(places: readonly PayoutPlace[]): string {
  return places.map((place, i) => `${placeName(i + 1)} ${placeValueText(place)}`).join(", ");
}

/** A share table (a standard structure, or a classic custom list) as places, to start the editor from. */
export function placesFromShares(basisPoints: readonly number[]): PayoutPlace[] {
  return basisPoints.map((bp) => ({ kind: "percent", basisPoints: bp }));
}

/**
 * "Add a place": one more place below the last, of the same kind, at half of it rounded down to a whole
 * percent or whole dollars (at least 1% or $1). The other places are left alone: the editor's sum line
 * shows what the new one takes from 1st. No change at PAYOUT_PLACE_LIMITS.maxPlaces.
 */
export function addPayoutPlace(places: readonly PayoutPlace[]): PayoutPlace[] {
  if (places.length >= MAX_CUSTOM_PLACES) return [...places];
  const last = places[places.length - 1];
  if (!last) return [{ kind: "percent", basisPoints: FULL_POOL_BP }];
  if (last.kind === "percent") return [...places, { kind: "percent", basisPoints: Math.max(100, Math.floor(last.basisPoints / 200) * 100) }];
  return [...places, { kind: "amount", amountCents: Math.max(100, Math.floor(last.amountCents / 200) * 100) }];
}

/** "Remove": drops the place at `index` (0-based); the places below move up. The last place is never removed. */
export function removePayoutPlace(places: readonly PayoutPlace[], index: number): PayoutPlace[] {
  if (places.length <= 1 || index < 0 || index >= places.length) return [...places];
  return places.filter((_, i) => i !== index);
}

/**
 * Switches the place at `index` between a percentage and a fixed amount, keeping what it pays from
 * `poolCents` as near as the new kind allows: a share becomes that share of the pool in whole dollars
 * (at least $1); an amount becomes its share of the pool to 2 decimal places (at least 0.01%, at most
 * 100%). With no pool yet, a share becomes $1 per 1% and an amount 1% per $1, capped at 100%.
 */
export function changePlaceKind(places: readonly PayoutPlace[], index: number, kind: PayoutPlace["kind"], poolCents: Cents): PayoutPlace[] {
  const place = places[index];
  if (!place || place.kind === kind) return [...places];
  const pool = Number.isSafeInteger(poolCents) && poolCents > 0 ? poolCents : null;
  let next: PayoutPlace;
  if (place.kind === "percent") {
    const cents = pool === null ? place.basisPoints : Math.floor((pool * place.basisPoints) / (FULL_POOL_BP * 100)) * 100;
    next = { kind: "amount", amountCents: Math.min(PAYOUT_PLACE_LIMITS.maxAmountCents, Math.max(100, cents)) };
  } else {
    const bp = pool === null ? Math.round(place.amountCents / 100) * 100 : Math.round((place.amountCents * FULL_POOL_BP) / pool);
    next = { kind: "percent", basisPoints: Math.min(FULL_POOL_BP, Math.max(1, bp)) };
  }
  return places.map((current, i) => (i === index ? next : current));
}

export interface PayoutPlacesPreviewRow {
  position: number;
  place: PayoutPlace;
  /** What the place pays (with its part of any difference added to the prizes); null while the structure has a problem. */
  amountCents: Cents | null;
  /** What the place pays as set, before any difference is added; null while the structure has a problem. */
  setCents: Cents | null;
}

/** The payout editor's live view of `places` against the current pool and the money available. */
export interface PayoutPlacesPreview {
  rows: PayoutPlacesPreviewRow[];
  /** Every place's own amount as set (shares rounded down), before any difference is added. */
  placedCents: Cents;
  /** How much of the money available the places leave over; 0 when they pay it all or more. */
  leftoverCents: Cents;
  /** How much more than the money available the places pay (the club adds it); 0 when they fit. */
  overCents: Cents;
  /** Where the difference goes, worked out as finalize would; null while there are problems. */
  difference: PrizeDifference | null;
  /** payoutPlacesProblems. */
  problems: PayoutPlaceProblem[];
  /**
   * Places that, from this pool, pay more than the place above them (a percentage beside a fixed
   * amount); empty while there are problems. They can be saved and are paid as set: the editor warns.
   */
  warnings: PayoutPlaceProblem[];
}

export interface PreviewMoney {
  /** The money available for prizes (gross less the AP, plus anything carried in); default: the pool. */
  availableCents?: Cents;
  /** Where any difference goes; default: the club keeps it. */
  choice?: PrizeDifferenceChoice;
}

/**
 * The editor's sum check: what each place pays as set from `poolCents` (the pool its percentages are
 * of), how far that is from the money available, and where the difference goes. Works on a structure
 * with problems too (each still-valid place's own amount is counted), so the editor can show the sum
 * while the TD types.
 */
export function previewPayoutPlaces(poolCents: Cents, places: readonly PayoutPlace[], money: PreviewMoney = {}): PayoutPlacesPreview {
  const problems = payoutPlacesProblems(places);
  const ready = problems.length === 0;
  const pool = Number.isSafeInteger(poolCents) ? Math.max(poolCents, 0) : 0;
  const available = money.availableCents !== undefined && Number.isSafeInteger(money.availableCents) ? money.availableCents : pool;
  // Percentages adding up to 100% are stored and paid as a share table: the rounding goes to 1st, nothing is left over.
  const shares = ready ? sharesOf(places) : null;
  const own =
    shares && pool > 0
      ? allocatePayouts(pool, shares).map((payout) => payout.amountCents)
      : places.map((place) => {
          if (place.kind === "percent") return Number.isSafeInteger(place.basisPoints) && place.basisPoints > 0 ? percentOfPool(pool, place.basisPoints) : 0;
          return Number.isSafeInteger(place.amountCents) && place.amountCents > 0 ? place.amountCents : 0;
        });
  const placedCents = own.reduce((sum, amount) => sum + amount, 0);
  const settled = ready ? settleDifference(own, placedCents, available, money.choice ?? DEFAULT_PRIZE_DIFFERENCE) : null;
  return {
    rows: places.map((place, i) => ({ position: i + 1, place, amountCents: settled ? settled.amounts[i] : null, setCents: settled ? own[i] : null })),
    placedCents,
    leftoverCents: Math.max(0, available - placedCents),
    overCents: Math.max(0, placedCents - available),
    difference: settled?.difference ?? null,
    problems,
    warnings: settled && pool > 0 ? outOfOrderPlaces(pool, settled.amounts) : [],
  };
}

/**
 * The editor's view of a share table (a standard structure, or a classic custom list) from `poolCents`
 * (a manual pool, or what is available): each place's v2 share, settled against the money available as
 * finalize settles it (computePrizePool). Nothing is paid from a pool of zero or less.
 */
export function previewShares(poolCents: Cents, basisPoints: readonly number[], money: PreviewMoney = {}): { amounts: Cents[]; difference: PrizeDifference } {
  const pool = Number.isSafeInteger(poolCents) ? poolCents : 0;
  const asSet = pool > 0 ? allocatePayouts(pool, basisPoints).map((payout) => payout.amountCents) : basisPoints.map(() => 0);
  const available = money.availableCents !== undefined && Number.isSafeInteger(money.availableCents) ? money.availableCents : pool;
  return settleDifference(asSet, pool, available, money.choice ?? DEFAULT_PRIZE_DIFFERENCE);
}

function assertShares(basisPoints: readonly number[]): void {
  let total = 0;
  for (let i = 0; i < basisPoints.length; i++) {
    const bp = basisPoints[i];
    if (!Number.isSafeInteger(bp) || bp <= 0 || (i > 0 && bp > basisPoints[i - 1])) {
      throw new RangeError(`Invalid payout shares: ${basisPoints.join(", ")}`);
    }
    total += bp;
  }
  if (total !== FULL_POOL_BP) {
    throw new RangeError(`Payout shares add up to ${total} bp, not ${FULL_POOL_BP}`);
  }
}

/**
 * What no one is paid when fewer players entered than there are paid places. Finalize only pays
 * positions up to the number of entrants, as it always has.
 */
export function undistributedCents(payouts: readonly Payout[], entrants: number): Cents {
  return payouts.filter((p) => p.position > entrants).reduce((sum, p) => sum + p.amountCents, 0);
}
