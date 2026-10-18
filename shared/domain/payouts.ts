/**
 * Payout structures and how a prize pool is split between places. PURE: no runtime imports.
 *
 * Shares are integer basis points (10000 = 100%). `allocatePayouts` is the v2 split that finalize
 * moves to from Phase 2 onwards. `legacyPayouts` reproduces the split that finalize and both tournament
 * pages compute today, for parity checks and for showing tournaments finalized before v2.
 */
import type { Cents } from "./money";

export const PAYOUT_ALGORITHM = "v2-floor-remainder-first" as const;
export type PayoutAlgorithm = typeof PAYOUT_ALGORITHM;

export type StandardPayoutKey = "standard" | "top3" | "top5" | "top8" | "top9";
export type PayoutStructureKey = StandardPayoutKey | "custom";

const FULL_POOL_BP = 10_000;
const MAX_CUSTOM_PLACES = 50;

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

export type CustomPayoutsResult = { ok: true; basisPoints: number[] } | { ok: false; error: string };

/**
 * Reads `tournaments.custom_payouts`: a JSON array of percentages for 1st place onwards, e.g.
 * "[50,30,20]". Each must be above 0 with at most 2 decimal places, no place may pay more than the one
 * above it, and they must add up to exactly 100.
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
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_CUSTOM_PLACES) {
    return { ok: false, error: `Custom payouts must be a list of 1 to ${MAX_CUSTOM_PLACES} percentages` };
  }
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
  return { ok: true, basisPoints };
}

export interface ResolvedPayoutStructure {
  /** The stored `payout_structure`, or "standard" when it is empty. */
  requested: string;
  /** The structure actually paid. */
  used: PayoutStructureKey;
  basisPoints: readonly number[];
  /** Set when the requested structure could not be used and Standard is paid instead. */
  error?: string;
}

/**
 * The shares a tournament pays. A valid custom list is honoured; an invalid one, or an unknown key,
 * pays Standard and says why. (Today "custom" always pays Standard: see `legacyPayouts`.)
 */
export function resolvePayoutStructure(
  structure: string | null | undefined,
  customPayouts: string | null | undefined,
): ResolvedPayoutStructure {
  const requested = structure || "standard";
  if (isStandardKey(requested)) {
    return { requested, used: requested, basisPoints: PAYOUT_STRUCTURES[requested] };
  }
  const standard = { requested, used: "standard" as const, basisPoints: PAYOUT_STRUCTURES.standard };
  if (requested === "custom") {
    const custom = parseCustomPayouts(customPayouts);
    if (custom.ok) return { requested, used: "custom", basisPoints: custom.basisPoints };
    return { ...standard, error: `${custom.error}, so Standard is paid instead` };
  }
  return { ...standard, error: `Unknown payout structure "${requested}", so Standard is paid instead` };
}

export interface Payout {
  /** 1 for 1st place. */
  position: number;
  basisPoints: number;
  /** basisPoints / 100, e.g. 35 for 35%. */
  percentage: number;
  amountCents: Cents;
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

/** A place as today's code shows it: `amount` is whole dollars. */
export interface LegacyPayout {
  position: number;
  percentage: number;
  amount: number;
}

/**
 * Today's split, as finalize (server/routes.ts:886-897), the admin page (tournament-details.tsx:318-336)
 * and the public page (public-tournament-view.tsx:238-256) compute it at dddf8ad: each place is
 * Math.round(pool × share) whole dollars, so the places can add up to more or less than the pool.
 * "custom" and unknown structures pay Standard. A pool of zero or less pays nothing.
 */
export function legacyPayouts(pool: number, structure: string | null | undefined): LegacyPayout[] {
  if (!(pool > 0)) return [];
  const basisPoints = isStandardKey(structure) ? PAYOUT_STRUCTURES[structure] : PAYOUT_STRUCTURES.standard;
  return basisPoints.map((bp, i) => {
    // bp / 10000 is the same double as the literal in today's tables (0.35 for 3500).
    const fraction = bp / FULL_POOL_BP;
    return { position: i + 1, percentage: fraction * 100, amount: Math.round(pool * fraction) };
  });
}

/**
 * What no one is paid when fewer players entered than there are paid places. Finalize only pays
 * positions up to the number of entrants, as it does today.
 */
export function undistributedCents(payouts: readonly Payout[], entrants: number): Cents {
  return payouts.filter((p) => p.position > entrants).reduce((sum, p) => sum + p.amountCents, 0);
}
