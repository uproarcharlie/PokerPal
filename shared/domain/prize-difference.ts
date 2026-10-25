/**
 * Where the difference goes when the prizes as set do not add up to the money available for prizes
 * (round 5, item 16). PURE: no runtime imports outside shared/domain.
 *
 * The money available for prizes is the gross less the AP, plus anything carried over into this pool
 * from an earlier tournament. The prizes as set are a manual prize pool split by a share table, or
 * custom places (fixed amounts, or percentages adding up to less than 100%). When they add up to LESS,
 * the tournament director chooses where the difference goes, and it is never silent:
 * - "club": the club keeps it (it becomes part of its take, like the AP): the default, and what a
 *   reduced manual pool has always done;
 * - "first": it is added to 1st's prize;
 * - "pro_rata": it is shared across the paid places in proportion to what each pays;
 * - "carry": it is carried over to the season's next tournament (or the club's), which can add it to
 *   its own pool ("carried over from …"): finalize records it in prize_carry_overs.
 * When they add up to MORE, the club adds the difference: a guarantee ("Added by the club").
 * Every amount is whole cents; a share of the difference is whole dollars, the rest to 1st, as the
 * v2 payout rule does.
 */
import { formatMoney, type Cents } from "./money";

export const PRIZE_DIFFERENCE_CHOICES = ["club", "first", "pro_rata", "carry"] as const;
export type PrizeDifferenceChoice = (typeof PRIZE_DIFFERENCE_CHOICES)[number];

/** What a tournament with no choice stored does (every tournament before round 5: a reduced manual pool's difference was always the club's). */
export const DEFAULT_PRIZE_DIFFERENCE: PrizeDifferenceChoice = "club";

/** The choices as the editors offer them. */
export const PRIZE_DIFFERENCE_LABELS: Readonly<Record<PrizeDifferenceChoice, string>> = Object.freeze({
  club: "Club keeps it",
  first: "Add it to 1st",
  pro_rata: "Share it across the paid places",
  carry: "Carry it over",
});

export const isPrizeDifferenceChoice = (value: unknown): value is PrizeDifferenceChoice =>
  typeof value === "string" && (PRIZE_DIFFERENCE_CHOICES as readonly string[]).includes(value);

/** A stored choice (tournaments.prize_difference) as the maths uses it: anything not a choice is the default. */
export const readPrizeDifference = (value: unknown): PrizeDifferenceChoice => (isPrizeDifferenceChoice(value) ? value : DEFAULT_PRIZE_DIFFERENCE);

export interface PrizeDifference {
  choice: PrizeDifferenceChoice;
  /** The money available for prizes: gross less the AP, plus anything carried in. */
  availableCents: Cents;
  /** What the prizes add up to as set: a manual prize pool, or the custom places' own amounts. */
  setCents: Cents;
  /** availableCents − setCents: above 0 is left over (`choice` says where it goes), below 0 the club adds it. */
  cents: Cents;
  /** "club": the club keeps what is left over. */
  keptByClubCents: Cents;
  /** "first" or "pro_rata": added to the prizes. */
  addedToPrizesCents: Cents;
  /** "carry": carried over to a later tournament. */
  carriedOverCents: Cents;
  /** The prizes as set are more than is available: the club adds this (a guarantee). */
  addedByClubCents: Cents;
}

export interface SettledPrizes {
  /** What each place pays: as set, plus its part of a difference added to the prizes. */
  amounts: Cents[];
  difference: PrizeDifference;
}

const sum = (amounts: readonly Cents[]) => amounts.reduce((total, amount) => total + amount, 0);

/**
 * `cents` shared in proportion to `amounts` (each share whole dollars, rounded down; the dollars and
 * cents left go to 1st), or all of it to 1st when no place pays anything yet. Exact for any amounts:
 * the products are worked out in BigInt.
 */
export function shareProRata(cents: Cents, amounts: readonly Cents[]): Cents[] {
  const shares = amounts.map(() => 0);
  if (shares.length === 0) return shares;
  const [zero, dollar] = [BigInt(0), BigInt(100)];
  const weights = amounts.map((amount) => BigInt(Math.max(0, amount)));
  const total = weights.reduce((all, weight) => all + weight, zero);
  if (total > zero) {
    weights.forEach((weight, i) => {
      shares[i] = Number(((BigInt(cents) * weight) / total / dollar) * dollar);
    });
  }
  shares[0] += cents - sum(shares);
  return shares;
}

/**
 * Pays the prizes as set (`amountsAsSet`, one per place, adding up to `setCents` once the pool has
 * money) from `availableCents`, with the difference handled by `choice`: added to 1st or shared
 * across the places (only while there is a place to add it to: else the club keeps it), carried
 * over, or kept by the club. A shortfall is always the club's to add. Throws a RangeError for amounts
 * that are not whole cents.
 */
export function settleDifference(amountsAsSet: readonly Cents[], setCents: Cents, availableCents: Cents, choice: PrizeDifferenceChoice): SettledPrizes {
  if (![...amountsAsSet, setCents, availableCents].every(Number.isSafeInteger)) {
    throw new RangeError("Prizes and the money available must be whole cents");
  }
  const cents = availableCents - setCents;
  const amounts = [...amountsAsSet];
  const difference: PrizeDifference = {
    choice,
    availableCents,
    setCents,
    cents,
    keptByClubCents: 0,
    addedToPrizesCents: 0,
    carriedOverCents: 0,
    addedByClubCents: cents < 0 ? -cents : 0,
  };
  if (cents > 0) {
    if ((choice === "first" || choice === "pro_rata") && amounts.length > 0) {
      const shares = choice === "first" ? amounts.map((_, i) => (i === 0 ? cents : 0)) : shareProRata(cents, amounts);
      shares.forEach((share, i) => {
        amounts[i] += share;
      });
      difference.addedToPrizesCents = cents;
    } else if (choice === "carry") {
      difference.carriedOverCents = cents;
    } else {
      difference.keptByClubCents = cents;
    }
  }
  return { amounts, difference };
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

export const carriedInCents = (carriedIn: readonly CarriedIn[]): Cents => sum(carriedIn.map((entry) => entry.amountCents));

/* ---------- words ---------- */

/**
 * Where carried-over money goes, as the screens name it: the season ("Winter League"), whose next
 * tournament can add it to its pool, or the club's next tournament when there is no season.
 */
export const carryTargetName = (seasonName: string | null | undefined): string => seasonName?.trim() || "the next tournament";

type DifferenceFigures = Pick<PrizeDifference, "cents" | "setCents" | "availableCents" | "choice">;

/**
 * The difference in one plain sentence, for the editors and finalize ("The prizes add up to $950,
 * $50 less than the $1,000 available for prizes: the club keeps it."); null when there is none.
 */
export function differenceSentence(difference: DifferenceFigures, carryTarget: string): string | null {
  const { cents, setCents, availableCents } = difference;
  if (cents === 0) return null;
  const prizes = `The prizes add up to ${formatMoney(setCents)}`;
  const available = `the ${formatMoney(Math.max(availableCents, 0))} available for prizes`;
  if (cents < 0) return `${prizes}, ${formatMoney(-cents)} more than ${available}: the club adds ${formatMoney(-cents)}.`;
  return `${prizes}, ${formatMoney(cents)} less than ${available}: ${choiceOutcome(difference.choice, carryTarget)}.`;
}

/** What the choice does with the money left over, as the end of a sentence. */
export function choiceOutcome(choice: PrizeDifferenceChoice, carryTarget: string): string {
  switch (choice) {
    case "club":
      return "the club keeps it";
    case "first":
      return "it goes to 1st";
    case "pro_rata":
      return "it is shared across the paid places";
    case "carry":
      return `it is carried over to ${carryTarget}`;
  }
}

/**
 * The difference as the activity feed words it after a change ("$150 left over: the club keeps it",
 * "$200 added by the club"); null when there is none.
 */
export function differenceNote(difference: DifferenceFigures, carryTarget: string): string | null {
  if (difference.cents === 0) return null;
  if (difference.cents < 0) return `${formatMoney(-difference.cents)} added by the club`;
  return `${formatMoney(difference.cents)} left over: ${choiceOutcome(difference.choice, carryTarget)}`;
}

/** One line of a pool's honest breakdown beside the prize pool and the AP. */
export interface DifferenceLine {
  kind: "carried_in" | "kept_by_club" | "carried_over" | "added_to_prizes" | "added_by_club";
  label: string;
  cents: Cents;
}

/** The parts of a pool `differenceLines` reads: a live breakdown, or what finalize froze. */
export interface DifferenceLinesInput {
  difference?: Pick<PrizeDifference, "choice" | "keptByClubCents" | "addedToPrizesCents" | "carriedOverCents" | "addedByClubCents"> | null;
  carriedIn?: readonly CarriedIn[] | null;
}

/**
 * The lines every screen shows beside the prize pool (the admin page, the public page, the TV): what
 * was carried in from earlier tournaments, what the club kept of the difference, what was carried
 * over and where, what was added to the prizes, and what the club added. Empty when the prizes are
 * exactly what was available and nothing was carried in.
 */
export function differenceLines(pool: DifferenceLinesInput, carryTarget: string): DifferenceLine[] {
  const lines: DifferenceLine[] = (pool.carriedIn ?? []).map((entry) => ({
    kind: "carried_in",
    label: `Carried over from ${entry.fromName}`,
    cents: entry.amountCents,
  }));
  const { difference } = pool;
  if (!difference) return lines;
  if (difference.keptByClubCents > 0) lines.push({ kind: "kept_by_club", label: "Kept by the club", cents: difference.keptByClubCents });
  if (difference.carriedOverCents > 0) lines.push({ kind: "carried_over", label: `Carried over to ${carryTarget}`, cents: difference.carriedOverCents });
  if (difference.addedToPrizesCents > 0) {
    const label = difference.choice === "pro_rata" ? "Left over, shared across the paid places" : "Left over, added to 1st";
    lines.push({ kind: "added_to_prizes", label, cents: difference.addedToPrizesCents });
  }
  if (difference.addedByClubCents > 0) lines.push({ kind: "added_by_club", label: "Added by the club", cents: difference.addedByClubCents });
  return lines;
}
