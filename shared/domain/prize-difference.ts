/**
 * What happens to the money between the prizes as set and the money available for prizes. PURE: no
 * runtime imports outside shared/domain.
 *
 * The money available for prizes is the gross of the paid entries less the AP, plus what the club pays
 * in for free entries and anything carried into the pool from an earlier tournament. The prizes as set
 * are what the places pay (./payouts): each share of the pool rounded down to whole dollars and each
 * fixed place its amount, from a manual prize pool or from the money available.
 * - When they add up to LESS, the leftover is the club's: it goes to its fee, shown under the club's
 *   name for it ("Leftover $50 → AP"). That includes the dollars and cents the rounding leaves. The
 *   owner, 2026-10-26 (round 7): "any left over money should be taken as the fee". Nobody is asked
 *   where it goes.
 * - When they add up to MORE, the club adds the difference: a guarantee ("Added by the club").
 *
 * Before round 7 a TD could choose where a leftover went: added to 1st, shared across the places, or
 * carried over to a later tournament. Those choices are still stored in tournaments.prize_difference
 * and prize_carry_overs. Both are kept, but no pool reads them any more:
 * - a live tournament's leftover is the club's, whatever was stored;
 * - a completed tournament shows what its snapshot froze (LegacyDifference).
 * Money already carried in still counts in the pool it went to.
 * Every amount is whole cents. The words below are for the club's staff only: never on a public page,
 * the TV or a public response.
 */
import { formatMoney, type Cents } from "./money";

/**
 * What tournaments.prize_difference may hold: where a TD chose, before round 7, that a leftover would
 * go. Kept only so the stored column keeps its type; no pool reads it.
 */
export type PrizeDifferenceChoice = "club" | "first" | "pro_rata" | "carry";

export interface PrizeDifference {
  /** The money available for prizes: gross less the AP, plus what the club pays in for free entries and anything carried in. */
  availableCents: Cents;
  /** What the prizes add up to as set: a manual prize pool's places, or the places' own amounts. */
  setCents: Cents;
  /** availableCents − setCents: above 0 it is left over (the club's), below 0 the club adds it. */
  cents: Cents;
  /** The leftover, added to the club's fee (its AP). */
  keptByClubCents: Cents;
  /** The prizes as set are more than is available: the club adds this (a guarantee). */
  addedByClubCents: Cents;
}

/**
 * What a snapshot frozen before round 7 may also record about where a leftover went. Each field is set
 * only when it applied:
 * - `choice`: what the TD chose;
 * - `addedToPrizesCents`: added to the places ("first", "pro_rata");
 * - `carriedOverCents` and `carryTarget`: carried over ("carry") to a later tournament.
 * Read only to show those tournaments as they were paid.
 */
export interface LegacyDifference {
  choice?: string;
  addedToPrizesCents?: Cents;
  carriedOverCents?: Cents;
  carryTarget?: string;
}

/**
 * The difference between the prizes as set (`setCents`) and the money available (`availableCents`):
 * the leftover the club keeps as part of its fee, or what the club adds. Throws a RangeError for
 * amounts that are not whole cents.
 */
export function settleDifference(setCents: Cents, availableCents: Cents): PrizeDifference {
  if (!Number.isSafeInteger(setCents) || !Number.isSafeInteger(availableCents)) {
    throw new RangeError("Prizes and the money available must be whole cents");
  }
  const cents = availableCents - setCents;
  return { availableCents, setCents, cents, keptByClubCents: Math.max(cents, 0), addedByClubCents: Math.max(-cents, 0) };
}

/* ---------- carried over into a pool ---------- */

/** Money carried over from an earlier tournament and added to this one's pool (an entry of tournaments.carried_in). */
export interface CarriedIn {
  /** The prize_carry_overs row. */
  carryOverId: string;
  fromTournamentId: string | null;
  /** The earlier tournament's name, as it was when its money was carried over. */
  fromName: string;
  amountCents: Cents;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** tournaments.carried_in as the maths reads it: each well-formed entry with a positive whole amount; anything else is left out. */
export function readCarriedIn(value: unknown): CarriedIn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CarriedIn[] => {
    if (!isRecord(entry)) return [];
    const { carryOverId, fromTournamentId, fromName, amountCents } = entry;
    if (typeof carryOverId !== "string" || typeof fromName !== "string") return [];
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) return [];
    return [{ carryOverId, fromTournamentId: typeof fromTournamentId === "string" ? fromTournamentId : null, fromName, amountCents }];
  });
}

export const carriedInCents = (carriedIn: readonly CarriedIn[]): Cents => carriedIn.reduce((total, entry) => total + entry.amountCents, 0);

/* ---------- words ---------- */

type DifferenceFigures = Pick<PrizeDifference, "cents" | "setCents" | "availableCents">;

/** "Leftover $50 → AP": the leftover and where it goes, in the club's name for its fee. */
export const leftoverText = (cents: Cents, rakeLabel: string): string => `Leftover ${formatMoney(cents)} → ${rakeLabel}`;

/**
 * The difference in a few words, for the activity feed, a toast and the payout editor's sum line:
 * "Leftover $50 → AP", "Added by the club: $200". Null when there is none.
 */
export function differenceNote(difference: Pick<PrizeDifference, "cents">, rakeLabel: string): string | null {
  if (difference.cents === 0) return null;
  if (difference.cents < 0) return `Added by the club: ${formatMoney(-difference.cents)}`;
  return leftoverText(difference.cents, rakeLabel);
}

/**
 * The difference in one plain sentence, for the AP preview, finalize's warnings and its activity entry.
 * Null when there is none. Examples:
 * - "Leftover $50 → AP: the prizes add up to $950 of the $1,000 available for prizes."
 * - "The prizes add up to $1,200, $200 more than the $1,000 available for prizes: the club adds $200."
 */
export function differenceSentence(difference: DifferenceFigures, rakeLabel: string): string | null {
  const { cents, setCents, availableCents } = difference;
  if (cents === 0) return null;
  const available = `the ${formatMoney(Math.max(availableCents, 0))} available for prizes`;
  if (cents < 0) return `The prizes add up to ${formatMoney(setCents)}, ${formatMoney(-cents)} more than ${available}: the club adds ${formatMoney(-cents)}.`;
  return `${leftoverText(cents, rakeLabel)}: the prizes add up to ${formatMoney(setCents)} of ${available}.`;
}

/** The label of what the club pays into the pool for free entries (round 7, item 6). */
export const FREE_ENTRIES_ADDED_LABEL = "Added by the club for free entries";

/** One line of a pool's breakdown beside the prize pool and the AP. */
export interface DifferenceLine {
  /**
   * - "carried_in": money carried in from an earlier tournament;
   * - "added_for_free_entries": the buy-ins the club pays in for free entries (round 7);
   * - "kept_by_club": the leftover, added to the club's fee;
   * - "added_by_club": what the club adds to pay the prizes as set;
   * - "carried_over" and "added_to_prizes": only from a snapshot frozen before round 7.
   */
  kind: "carried_in" | "added_for_free_entries" | "kept_by_club" | "added_by_club" | "carried_over" | "added_to_prizes";
  /** What the line is, beside its amount in a column ("Leftover → AP"). */
  label: string;
  cents: Cents;
  /** The line in one phrase, for a summary ("Leftover $50 → AP", "Added by the club $200"). */
  text: string;
}

/** The parts of a pool `differenceLines` reads: a live breakdown, or what finalize froze (perhaps before round 7). */
export interface DifferenceLinesInput {
  difference?: (Pick<PrizeDifference, "keptByClubCents" | "addedByClubCents"> & LegacyDifference) | null;
  carriedIn?: readonly CarriedIn[] | null;
  /** What the club pays into the pool for free entries (round 7). */
  freeEntries?: { addedCents: Cents } | null;
}

const line = (kind: DifferenceLine["kind"], label: string, cents: Cents): DifferenceLine => ({ kind, label, cents, text: `${label} ${formatMoney(cents)}` });

/**
 * The lines the staff's screens show beside the prize pool. Each appears only when it has money:
 * - money carried in from earlier tournaments;
 * - what the club pays in for free entries;
 * - the leftover added to the club's fee ("Leftover $50 → AP");
 * - for a snapshot frozen before round 7, money carried over or added to the places;
 * - what the club added.
 * Empty when the prizes are exactly what was available and nothing came in but the entries.
 */
export function differenceLines(pool: DifferenceLinesInput, rakeLabel: string): DifferenceLine[] {
  const lines = (pool.carriedIn ?? []).map((entry) => line("carried_in", `Carried over from ${entry.fromName}`, entry.amountCents));
  const freeEntries = pool.freeEntries?.addedCents ?? 0;
  if (freeEntries > 0) lines.push(line("added_for_free_entries", FREE_ENTRIES_ADDED_LABEL, freeEntries));
  const { difference } = pool;
  if (!difference) return lines;
  if (difference.keptByClubCents > 0) {
    lines.push({ kind: "kept_by_club", label: `Leftover → ${rakeLabel}`, cents: difference.keptByClubCents, text: leftoverText(difference.keptByClubCents, rakeLabel) });
  }
  const carriedOver = difference.carriedOverCents ?? 0;
  if (carriedOver > 0) lines.push(line("carried_over", `Carried over to ${difference.carryTarget ?? "a later tournament"}`, carriedOver));
  const addedToPrizes = difference.addedToPrizesCents ?? 0;
  if (addedToPrizes > 0) {
    const label = difference.choice === "pro_rata" ? "Left over, shared across the paid places" : "Left over, added to 1st";
    lines.push(line("added_to_prizes", label, addedToPrizes));
  }
  if (difference.addedByClubCents > 0) lines.push(line("added_by_club", "Added by the club", difference.addedByClubCents));
  return lines;
}
