/**
 * Prize pool, AP (rake) and payout maths for one tournament: the single source of truth for the client
 * and the server. PURE: no I/O, no Date, and no runtime imports outside shared/domain.
 *
 * Every figure is exact integer cents: payouts, stored amounts and totals all come from these. (The
 * float arithmetic the app ran before Phase 2 lives only in the parity tests' helper,
 * test/helpers/legacy-money.ts.)
 *
 * Precedence: a manual prize pool beats the manual AP total (`rakeOverride`), which beats the AP the
 * club's rates give. High-hand money is a separate pot and is never part of the AP override. When the
 * prizes as set (a manual pool, or custom places) are not exactly the money available for prizes, the
 * tournament's choice says where the difference goes (./prize-difference, round 5 item 16).
 *
 * Only paid players are in the pool (owner, 2026-10-26: "prize pool should only show confirmed players
 * that have paid"): see poolEntries.
 */
import {
  isAmountSet,
  percentOfCents,
  toBasisPoints,
  toCents,
  type Cents,
  type MoneyInput,
} from "./money";
import {
  allocatePayouts,
  outOfOrderPlaces,
  PAYOUT_ALGORITHM,
  placeAmounts,
  resolvePayoutStructure,
  sharesOfAmounts,
  undistributedCents,
  type Payout,
  type PayoutAlgorithm,
  type ResolvedPayoutStructure,
} from "./payouts";
import {
  carriedInCents,
  readCarriedIn,
  readPrizeDifference,
  settleDifference,
  type CarriedIn,
  type PrizeDifference,
} from "./prize-difference";
import { fieldEntries, type WaitingListEntry } from "./waiting-list";

export const DEFAULT_RAKE_LABEL = "Rake";

export type NetSource = "calculated" | "ap_override" | "manual_pool";

/** The tournament fields the maths reads. A `Tournament` row from shared/schema fits as it is. */
export interface PrizePoolInput {
  buyInAmount: MoneyInput;
  rebuyAmount?: MoneyInput;
  addonAmount?: MoneyInput;
  /** "none" | "percentage" | "fixed" (fixed = per entry). Anything else takes no AP. */
  rakeType?: string | null;
  /** A percentage or a per-entry amount, depending on the type. */
  rakeAmount?: MoneyInput;
  rebuyRakeType?: string | null;
  rebuyRakeAmount?: MoneyInput;
  addonRakeType?: string | null;
  addonRakeAmount?: MoneyInput;
  payoutStructure?: string | null;
  customPayouts?: string | null;
  manualPrizePool?: MoneyInput;
  /** Manual AP total: replaces the buy-in, re-buy and add-on AP together, and does not grow with entries. */
  rakeOverride?: MoneyInput;
  highHandAmount?: MoneyInput;
  /** "percentage" of the pot, or "fixed" (one flat amount). Anything else takes nothing. */
  highHandRakeType?: string | null;
  highHandRakeAmount?: MoneyInput;
  highHandPayouts?: number | null;
  /** Round 5 (item 15): who is on the waiting list behind a full field (unpaidEntries leaves them out). */
  maxPlayers?: number | null;
  /** Round 5 (item 16): where a difference between the prizes as set and the money available goes (null: the club keeps it). */
  prizeDifference?: string | null;
  /** Round 5 (item 16): money carried over into this pool from earlier tournaments (tournaments.carried_in). */
  carriedIn?: unknown;
  /** With prizePoolSnapshot: whether the tournament was completed before finalize kept snapshots (poolEntries). */
  status?: string | null;
  /** Only whether there is one is read here. */
  prizePoolSnapshot?: PaidSnapshotInput | null;
}

/**
 * One registration's entries. A null count counts as 0, as it does today. The waiting list (round 5)
 * reads the rest: a registration row, or a registration as the API lists it, fits as it is.
 */
export interface EntryInput extends WaitingListEntry {
  buyIns?: number | null;
  rebuys?: number | null;
  addons?: number | null;
  enteringHighHands?: boolean | null;
}

export interface EntryCounts {
  registrations: number;
  buyIns: number;
  rebuys: number;
  addons: number;
  highHandEntrants: number;
}

export interface ComponentAmounts {
  buyIn: number;
  rebuy: number;
  addon: number;
  total: number;
}

export interface RakeBreakdown {
  buyIn: Cents;
  rebuy: Cents;
  addon: Cents;
  /** buyIn + rebuy + addon: the AP the club's rates give. */
  calculated: Cents;
  /** The manual AP total, or null when none is set. */
  override: Cents | null;
  /** override ?? calculated */
  applied: Cents;
}

export interface HighHandBreakdown {
  entrants: number;
  gross: Cents;
  rake: Cents;
  net: Cents;
  /** How many prizes the pot is split into; what each winner gets is nextHighHandAward's. */
  winners: number;
}

export interface PrizePoolBreakdown {
  algorithm: PayoutAlgorithm;
  counts: EntryCounts;
  /** In cents. */
  gross: ComponentAmounts;
  rake: RakeBreakdown;
  /** gross.total + carriedInCents - rake.applied: the money available for prizes. */
  netAfterAp: Cents;
  manualPrizePool: Cents | null;
  /**
   * What the payouts add up to: the prizes as set (manualPrizePool ?? netAfterAp for a share table, or
   * the custom places' own amounts) plus any difference added to them.
   */
  net: Cents;
  netSource: NetSource;
  /**
   * gross.total + carriedInCents - net - difference.carriedOverCents: what the club keeps (its AP and
   * any difference it keeps); negative when it adds money to the pool.
   */
  impliedRake: Cents;
  structure: ResolvedPayoutStructure;
  /** What each place pays: they add up to `net` exactly. Empty when net <= 0. */
  payouts: Payout[];
  /** Where a difference between the prizes as set and netAfterAp goes (round 5, item 16). */
  difference: PrizeDifference;
  /** Money carried over into this pool from earlier tournaments, each named. */
  carriedIn: CarriedIn[];
  carriedInCents: Cents;
  highHand: HighHandBreakdown;
}

/** Whether the TD has confirmed the entry's payment at the desk: only then is its money in the prize pool. */
export function hasPaid(entry: Pick<EntryInput, "paymentConfirmed">): boolean {
  return entry.paymentConfirmed === true;
}

/**
 * A tournament completed before finalize kept a snapshot (before Phase 2; only finalize completes a
 * tournament, and it always keeps one now): its prizes were worked out from every entry in the field,
 * paid or not, and that is still how it is shown and totalled. Counting only paid players came later
 * and changes no tournament already completed.
 */
function completedBeforeSnapshots(tournament: Pick<PrizePoolInput, "status" | "prizePoolSnapshot">): boolean {
  return tournament.status === "completed" && !tournament.prizePoolSnapshot;
}

/**
 * The registrations a prize pool counts: only those whose payment is confirmed (the owner's decision,
 * 2026-10-26), with all their buy-ins, re-buys, add-ons and their high-hand entry. A sign-up that has
 * not paid, whether it has played or not, and the waiting list (./waiting-list) add nothing until the TD
 * confirms the payment. Admin, public, TV, dashboard and finalize all count through here, so they agree.
 * An entry that carries no payment status (a public registration) counts nothing: the server works out
 * a pool for anyone who cannot see who paid. A paid entry is never on the waiting list (paying accepts
 * it), but a list that carries its places is read as it is. A tournament completed before snapshots
 * counts its field as it always has (completedBeforeSnapshots).
 */
export function poolEntries<T extends EntryInput>(
  tournament: Pick<PrizePoolInput, "maxPlayers" | "status" | "prizePoolSnapshot">,
  entries: readonly T[],
): T[] {
  const field = fieldEntries(entries, tournament.maxPlayers);
  return completedBeforeSnapshots(tournament) ? field : field.filter(hasPaid);
}

/**
 * The players in the field (everyone but the waiting list) whose payment is not confirmed yet: they
 * play, and their chips count on the table, but their money is not in the prize pool until the TD
 * confirms it. What the TD's screens and finalize warn about.
 */
export function unpaidEntries<T extends EntryInput>(tournament: Pick<PrizePoolInput, "maxPlayers">, entries: readonly T[]): T[] {
  return fieldEntries(entries, tournament.maxPlayers).filter((entry) => !hasPaid(entry));
}

/**
 * Every entry recorded in the field (the waiting list left out), paid or not: what a new price would
 * re-price, since the desk asks every player for their entries at today's prices and the pool counts
 * each one once paid. The prize pool itself counts only paid entries (computePrizePool's `counts`).
 */
export function recordedEntryCounts(tournament: Pick<PrizePoolInput, "maxPlayers">, entries: readonly EntryInput[]): EntryCounts {
  return countEntries(fieldEntries(entries, tournament.maxPlayers));
}

/**
 * Works out a tournament's pool from its settings and the registrations passed in, as poolEntries
 * counts them: paid players only.
 */
export function computePrizePool(tournament: PrizePoolInput, entries: readonly EntryInput[]): PrizePoolBreakdown {
  const counts = countEntries(poolEntries(tournament, entries));

  const buyIn = counts.buyIns * toCents(tournament.buyInAmount);
  const rebuy = counts.rebuys * toCents(tournament.rebuyAmount);
  const addon = counts.addons * toCents(tournament.addonAmount);
  const gross = { buyIn, rebuy, addon, total: buyIn + rebuy + addon };

  const buyInRake = rakeCents(tournament.rakeType, tournament.rakeAmount, counts.buyIns, buyIn);
  const rebuyRake = rakeCents(tournament.rebuyRakeType, tournament.rebuyRakeAmount, counts.rebuys, rebuy);
  const addonRake = rakeCents(tournament.addonRakeType, tournament.addonRakeAmount, counts.addons, addon);
  const calculated = buyInRake + rebuyRake + addonRake;
  const override = isAmountSet(tournament.rakeOverride) ? toCents(tournament.rakeOverride) : null;
  const applied = override ?? calculated;

  const carriedIn = readCarriedIn(tournament.carriedIn);
  const carriedInTotal = carriedInCents(carriedIn);
  const manualPrizePool = isAmountSet(tournament.manualPrizePool) ? toCents(tournament.manualPrizePool) : null;
  const netAfterAp = gross.total + carriedInTotal - applied;
  // The pool the prizes are set from: a percentage place is a share of it.
  const setPool = manualPrizePool ?? netAfterAp;
  const netSource: NetSource =
    manualPrizePool !== null ? "manual_pool" : override !== null ? "ap_override" : "calculated";

  const resolved = resolvePayoutStructure(tournament.payoutStructure, tournament.customPayouts, setPool);
  const prizes = prizesAsSet(setPool, resolved);
  const settled = settleDifference(prizes.amounts, prizes.setCents, netAfterAp, readPrizeDifference(tournament.prizeDifference));
  const { difference } = settled;
  const net = prizes.setCents + difference.addedToPrizesCents;
  const { structure, payouts } = paidPlaces(resolved, settled.amounts, net, difference.addedToPrizesCents > 0);

  return {
    algorithm: PAYOUT_ALGORITHM,
    counts,
    gross,
    rake: { buyIn: buyInRake, rebuy: rebuyRake, addon: addonRake, calculated, override, applied },
    netAfterAp,
    manualPrizePool,
    net,
    netSource,
    impliedRake: gross.total + carriedInTotal - net - difference.carriedOverCents,
    structure,
    payouts,
    difference,
    carriedIn,
    carriedInCents: carriedInTotal,
    highHand: highHandCents(tournament, counts.highHandEntrants),
  };
}

/**
 * The prizes as the tournament sets them from `setPool`: a share table splits the pool (each share
 * floored to whole dollars, the rest to 1st, so they add up to it exactly; a pool of zero or less pays
 * nothing), custom places pay their own amounts (placeAmounts). `setCents` is what they add up to: the
 * pool itself for a share table, whatever its sign, so a pool that came out below zero stays as it is.
 */
function prizesAsSet(setPool: Cents, structure: ResolvedPayoutStructure): { amounts: Cents[]; setCents: Cents } {
  if (structure.places) {
    const amounts = placeAmounts(setPool, structure.places);
    return { amounts, setCents: amounts.reduce((sum, amount) => sum + amount, 0) };
  }
  const amounts = setPool > 0 ? allocatePayouts(setPool, structure.basisPoints).map((payout) => payout.amountCents) : structure.basisPoints.map(() => 0);
  return { amounts, setCents: setPool };
}

/**
 * The payouts of `amounts` (adding up to `net`), and the structure as paid: a share table keeps its
 * shares while nothing was added to its places; otherwise each place's share is its share of what is
 * paid. Places that, as paid, pay more than the place above them are named in `structure.warning`.
 */
function paidPlaces(
  resolved: ResolvedPayoutStructure,
  amounts: readonly Cents[],
  net: Cents,
  added: boolean,
): { structure: ResolvedPayoutStructure; payouts: Payout[] } {
  const custom = resolved.places !== undefined;
  const basisPoints = custom || added ? sharesOfAmounts(amounts) : resolved.basisPoints;
  const [outOfOrder] = custom && net > 0 ? outOfOrderPlaces(net, amounts) : [];
  const structure: ResolvedPayoutStructure = {
    ...resolved,
    basisPoints: custom && net <= 0 ? resolved.basisPoints : basisPoints,
    ...(outOfOrder ? { warning: outOfOrder.message } : {}),
  };
  if (net <= 0) return { structure, payouts: [] };
  const payouts = amounts.map((amountCents, i) => ({
    position: i + 1,
    basisPoints: structure.basisPoints[i],
    percentage: structure.basisPoints[i] / 100,
    amountCents,
    ...(resolved.places ? { kind: resolved.places[i].kind } : {}),
  }));
  return { structure, payouts };
}

function countEntries(entries: readonly EntryInput[]): EntryCounts {
  const counts = { registrations: entries.length, buyIns: 0, rebuys: 0, addons: 0, highHandEntrants: 0 };
  for (const entry of entries) {
    counts.buyIns += entry.buyIns ?? 0;
    counts.rebuys += entry.rebuys ?? 0;
    counts.addons += entry.addons ?? 0;
    if (entry.enteringHighHands) counts.highHandEntrants += 1;
  }
  return counts;
}

/**
 * What one registration owes (or paid): every buy-in, re-buy and add-on at the tournament's prices,
 * plus the high-hand entry when it entered the high hand (money-18). An entry counts in the high hand
 * exactly when the pot counts it (`enteringHighHands`), so the payment desk asks for what the pot holds.
 */
export function amountDueCents(
  tournament: Pick<PrizePoolInput, "buyInAmount" | "rebuyAmount" | "addonAmount" | "highHandAmount">,
  entry: EntryInput,
): Cents {
  return (
    toCents(tournament.buyInAmount) * (entry.buyIns ?? 0) +
    toCents(tournament.rebuyAmount) * (entry.rebuys ?? 0) +
    toCents(tournament.addonAmount) * (entry.addons ?? 0) +
    (entry.enteringHighHands ? toCents(tournament.highHandAmount) : 0)
  );
}

function rakeCents(type: string | null | undefined, amount: MoneyInput, count: number, subtotal: Cents): Cents {
  if (type === "percentage") return percentOfCents(subtotal, toBasisPoints(amount));
  if (type === "fixed") return count * toCents(amount);
  return 0;
}

/**
 * The most high-hand prizes a tournament can have, ties included: one rule for what may be set and
 * what a tie may add, so a stored count is always one the API accepts back (CQ-P2-04).
 */
export const HIGH_HAND_PRIZES_MAX = 20;

/**
 * A tie for a high hand (TN2-04): a new winner shares the prize an earlier winner was awarded. The new
 * winner gets half, rounded down to the cent; the earlier winner keeps the rest (any odd cent), so the
 * two still add up to the original award. The one copy of the rule for the award dialog and the server.
 */
export function splitHighHandAward(awardedCents: Cents): { shareCents: Cents; keepCents: Cents } {
  const shareCents = Math.floor(Math.max(awardedCents, 0) / 2);
  return { shareCents, keepCents: awardedCents - shareCents };
}

/**
 * The next high-hand award (MONEY-36): what is left of the pot after the awards already made, split
 * over the winners still to come and rounded down to the cent, the last winner taking everything left.
 * So however the pot grew between awards, the awards add up to the pot exactly. Null once every
 * prize has been awarded; 0 when nothing is left.
 */
export function nextHighHandAward(highHand: Pick<HighHandBreakdown, "net" | "winners">, awardedCents: readonly Cents[]): Cents | null {
  const winnersLeft = highHand.winners - awardedCents.length;
  if (winnersLeft <= 0) return null;
  const left = highHand.net - awardedCents.reduce((sum, amount) => sum + amount, 0);
  if (left <= 0) return 0;
  return winnersLeft === 1 ? left : Math.floor(left / winnersLeft);
}

/**
 * What of the high-hand pot no award pays once every prize has been awarded: money paid in after the
 * last award, such as a payment confirmed late (only paid entries are in the pot: round 6), which the TD
 * adds to a winner's prize (R6REV0-MONEY-01). 0 while prizes are still to come (nextHighHandAward gives
 * the rest out) and when the awards add up to the pot.
 */
export function unawardedHighHandCents(highHand: Pick<HighHandBreakdown, "net" | "winners">, awardedCents: readonly Cents[]): Cents {
  if (awardedCents.length === 0 || awardedCents.length < highHand.winners) return 0;
  return Math.max(0, highHand.net - awardedCents.reduce((sum, amount) => sum + amount, 0));
}

export type HighHandAwardsProblem = {
  /** HIGH_HAND_OVER_POOL: more awarded than the pot holds; HIGH_HAND_AWARDED: every prize is awarded, so the pot is spoken for. */
  code: "HIGH_HAND_OVER_POOL" | "HIGH_HAND_AWARDED";
  awardedCents: Cents;
  potCents: Cents;
};

/**
 * Whether the high-hand awards already made still fit the pot after a change to it (an entry ticked
 * or unticked, the fee, its rake or the number of prizes): the awards may never add up to more than
 * the pot, there may never be more winners than prizes, and once every prize is awarded the awards
 * must add up to the pot exactly, so no money is left that nobody can win (MONEY-P2REV-05). Null when
 * they fit, or when nothing has been awarded yet.
 */
export function highHandAwardsProblem(
  highHand: Pick<HighHandBreakdown, "net" | "winners">,
  awardedCents: readonly Cents[],
): HighHandAwardsProblem | null {
  if (awardedCents.length === 0) return null;
  const awarded = awardedCents.reduce((sum, amount) => sum + amount, 0);
  const pot = Math.max(highHand.net, 0);
  if (awarded > pot) return { code: "HIGH_HAND_OVER_POOL", awardedCents: awarded, potCents: pot };
  if (awardedCents.length > highHand.winners || (awardedCents.length === highHand.winners && awarded !== pot)) {
    return { code: "HIGH_HAND_AWARDED", awardedCents: awarded, potCents: pot };
  }
  return null;
}

function highHandCents(tournament: PrizePoolInput, entrants: number): HighHandBreakdown {
  const gross = entrants * toCents(tournament.highHandAmount);
  let rake = 0;
  if (tournament.highHandRakeType === "percentage") {
    rake = percentOfCents(gross, toBasisPoints(tournament.highHandRakeAmount));
  } else if (tournament.highHandRakeType === "fixed") {
    rake = toCents(tournament.highHandRakeAmount);
  }
  const net = gross - rake;
  const winners = tournament.highHandPayouts && tournament.highHandPayouts > 0 ? tournament.highHandPayouts : 1;
  return { entrants, gross, rake, net, winners };
}

/* ---------- what to show as a tournament's payouts ---------- */

/** A registration's stored result. A `TournamentRegistration` row fits as it is. */
export interface StoredResultInput {
  id: string;
  finalPosition?: number | null;
  prizeAmount?: MoneyInput;
}

/** The part of a finalize snapshot (shared/domain/finalize.ts) the displays read. */
export interface PaidSnapshotInput {
  pool: { netCents: Cents };
  paid: ReadonlyArray<{ position: number; registrationId: string; basisPoints: number; amountCents: Cents }>;
}

/** The tournament fields `payoutsForDisplay` reads. A `Tournament` row fits as it is. */
export interface PayoutDisplayTournament {
  status?: string | null;
  prizePoolSnapshot?: PaidSnapshotInput | null;
}

/**
 * - "snapshot": a completed tournament's payouts as finalize froze them (spec D20).
 * - "stored": a completed tournament finalized before snapshots: its prizes as finalize recorded
 *   them, never recomputed.
 * - "unrecorded": a completed tournament with no snapshot and no stored prize although its pool had
 *   money in it: its results were entered by hand before Phase 2, so what was paid is not known.
 *   Screens say the prizes were not recorded rather than showing $0 (P2-PRODDATA-01).
 * - "cancelled": a cancelled tournament pays nothing (finalize refuses it, the dashboard counts it as
 *   $0), so screens say so and show no places (P2REV1-MONEY-04).
 * - "live": any other tournament: what finalize would pay now, the v2 payouts of the current pool for
 *   as many places as there are paid players (places beyond them are not paid: legacy D28).
 */
export type PayoutDisplaySource = "snapshot" | "stored" | "unrecorded" | "cancelled" | "live";

export interface PayoutDisplayRow {
  position: number;
  amountCents: Cents;
  /** Null for stored prizes, whose share was not recorded. */
  percentage: number | null;
  registrationId?: string;
}

export interface PayoutDisplay {
  source: PayoutDisplaySource;
  rows: PayoutDisplayRow[];
  /** What the rows pay, together. */
  totalCents: Cents;
  /**
   * The part of the pool nobody is paid: places beyond the number of entrants (live), or what the
   * snapshot's pool left unpaid. 0 for stored prizes, whose pool was not recorded.
   */
  undistributedCents: Cents;
}

/** The share of the pool the rows pay together, in percent (100 unless places go unpaid); null for stored prizes. */
export function paidPercentage(rows: readonly PayoutDisplayRow[]): number | null {
  let basisPoints = 0;
  for (const row of rows) {
    if (row.percentage === null) return null;
    basisPoints += Math.round(row.percentage * 100);
  }
  return basisPoints / 100;
}

export function payoutsForDisplay(
  tournament: PayoutDisplayTournament,
  prizePool: PrizePoolBreakdown,
  registrations: readonly StoredResultInput[],
): PayoutDisplay {
  if (tournament.status === "cancelled") return { source: "cancelled", rows: [], totalCents: 0, undistributedCents: 0 };
  if (tournament.status === "completed") {
    const snapshot = tournament.prizePoolSnapshot;
    if (snapshot) {
      const rows = snapshot.paid
        .filter((place) => place.amountCents > 0)
        .map((place) => ({
          position: place.position,
          amountCents: place.amountCents,
          percentage: place.basisPoints / 100,
          registrationId: place.registrationId,
        }))
        .sort((a, b) => a.position - b.position);
      const totalCents = sumAmounts(rows);
      return { source: "snapshot", rows, totalCents, undistributedCents: Math.max(0, snapshot.pool.netCents - totalCents) };
    }
    const stored: PayoutDisplayRow[] = [];
    for (const registration of registrations) {
      const amountCents = toCents(registration.prizeAmount);
      if (registration.finalPosition != null && amountCents > 0) {
        stored.push({
          position: registration.finalPosition,
          amountCents,
          percentage: null,
          registrationId: registration.id,
        });
      }
    }
    stored.sort((a, b) => a.position - b.position);
    if (stored.length === 0 && prizePool.net > 0) return { source: "unrecorded", rows: [], totalCents: 0, undistributedCents: 0 };
    return { source: "stored", rows: stored, totalCents: sumAmounts(stored), undistributedCents: 0 };
  }
  const entrants = prizePool.counts.registrations;
  const rows = prizePool.payouts
    .filter((p) => p.position <= entrants)
    .map((p) => ({ position: p.position, amountCents: p.amountCents, percentage: p.percentage }));
  return { source: "live", rows, totalCents: sumAmounts(rows), undistributedCents: undistributedCents(prizePool.payouts, entrants) };
}

function sumAmounts(rows: readonly { amountCents: Cents }[]): Cents {
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

/**
 * What one tournament adds to a total of prize money, such as the dashboard's (spec §5.6):
 * - cancelled: nothing;
 * - completed: what it paid: its snapshot, else `storedPrizesCents` (the sum of the prizes finalize
 *   recorded), else, when no prize was recorded at all ("unrecorded"), its calculated pool, as the
 *   dashboard counted it before Phase 2;
 * - anything else: its current pool, never below zero.
 * `entries` may be per registration, or one row of totals of the paid entries (marked paid, with no
 * id): only the sums matter.
 */
export function prizeMoneyCents(
  tournament: PrizePoolInput & PayoutDisplayTournament,
  entries: readonly EntryInput[],
  storedPrizesCents: Cents,
): Cents {
  if (tournament.status === "cancelled") return 0;
  if (tournament.status === "completed") {
    const snapshot = tournament.prizePoolSnapshot;
    if (snapshot) return snapshot.paid.reduce((sum, place) => sum + place.amountCents, 0);
    if (storedPrizesCents > 0) return storedPrizesCents;
  }
  return Math.max(0, computePrizePool(tournament, entries).net);
}

/** The club's name for rake, e.g. "AP". Null or blank shows "Rake". Display only; never used in maths. */
export function rakeLabel(club?: { rakeLabel?: string | null } | null): string {
  const label = club?.rakeLabel?.trim();
  return label ? label : DEFAULT_RAKE_LABEL;
}
