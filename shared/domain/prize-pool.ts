/**
 * Prize pool, AP (rake) and payout maths for one tournament: the single source of truth for the client
 * and the server. PURE: no I/O, no Date, and no runtime imports outside shared/domain.
 *
 * Every figure is exact integer cents: payouts, stored amounts and totals all come from these. (The
 * float arithmetic the app ran before Phase 2 lives only in the parity tests' helper,
 * test/helpers/legacy-money.ts.)
 *
 * Precedence: a manual prize pool beats the manual AP total (`rakeOverride`), which beats the AP the
 * club's rates give. High-hand money is a separate pot and is never part of the AP override. Each place
 * is paid its share rounded down to whole dollars (or its fixed amount); whatever the prizes as set
 * leave of the money available for prizes, the rounding included, goes to the club's fee, and whatever
 * they need beyond it the club adds (./prize-difference, round 7).
 *
 * Only accepted players are in the pool: those who have paid (owner, 2026-10-26: "prize pool should
 * only show confirmed players that have paid") and those given a free entry (round 7, item 6), whose
 * buy-ins bring in nothing unless the club pays them in. See poolEntries.
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
  outOfOrderPlaces,
  PAYOUT_ALGORITHM,
  prizesAsSet,
  resolvePayoutStructure,
  sharesOfAmounts,
  type Payout,
  type PayoutAlgorithm,
  type ResolvedPayoutStructure,
} from "./payouts";
import { carriedInCents, readCarriedIn, settleDifference, type CarriedIn, type LegacyDifference, type PrizeDifference } from "./prize-difference";
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
  /** Round 7 (item 6): given a free entry. Its buy-ins bring in nothing; it is accepted as a paid entry is. */
  freeEntry?: boolean | null;
  /** Round 7: the club pays the free entry's buy-ins into the prize pool, in full and with no AP taken. */
  freeEntryFunded?: boolean | null;
  /**
   * How many registrations the entry stands for: 1 (a registration), unless it is a row of totals (the
   * dashboard's). The places paid are counted from it.
   */
  registrationCount?: number;
}

export interface EntryCounts {
  registrations: number;
  /** Every buy-in, free entries' included: the chips in play count them all. */
  buyIns: number;
  rebuys: number;
  addons: number;
  highHandEntrants: number;
  /** Round 7: how many of the registrations have a free entry. */
  freeEntries: number;
  /** Round 7: how many of those the club pays in for. */
  fundedFreeEntries: number;
  /** Round 7: the free entries' buy-ins (part of `buyIns`), which nobody paid. */
  freeBuyIns: number;
  /** Round 7: the free buy-ins the club pays into the pool (part of `freeBuyIns`). */
  fundedBuyIns: number;
}

/** What the free entries in a pool bring (round 7, item 6): staff-only, like the AP. */
export interface FreeEntriesBreakdown {
  /** How many registrations have a free entry. */
  entries: number;
  /** How many of them the club pays in for. */
  funded: number;
  /** What the club pays into the pool for them: their buy-ins at the buy-in price, with no AP taken ("Added by the club for free entries"). */
  addedCents: Cents;
}

/** The money paid in: a free entry's buy-ins are not part of it. */
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
  /** gross.total + carriedInCents + freeEntries.addedCents - rake.applied: the money available for prizes. */
  netAfterAp: Cents;
  manualPrizePool: Cents | null;
  /**
   * What the payouts add up to: the prizes as set from manualPrizePool ?? netAfterAp (a share table's
   * shares rounded down to whole dollars, or the custom places' own amounts), for the places with an
   * accepted player in them. The prize pool every screen shows (round 7).
   */
  net: Cents;
  netSource: NetSource;
  /**
   * gross.total + carriedInCents - net: what the club keeps in all (its AP and the leftover, less what
   * it adds and pays in for free entries); negative when it puts more into the pool than it takes.
   */
  impliedRake: Cents;
  structure: ResolvedPayoutStructure;
  /**
   * What each place with an accepted player in it pays (places beyond them are not paid: legacy D28):
   * they add up to `net` exactly. Empty when net <= 0.
   */
  payouts: Payout[];
  /**
   * The difference between what the places pay (`net`) and netAfterAp: the leftover (the rounding, a
   * pool set below what came in, and what places with no player in them would pay) goes to the club's
   * fee, a shortfall the club adds. Only a correction's plan (./finalize) may also record money carried
   * over before round 7 that another pool holds (LegacyDifference: carriedOverCents, carryTarget).
   */
  difference: PrizeDifference & LegacyDifference;
  /** What free entries bring (round 7). */
  freeEntries: FreeEntriesBreakdown;
  /** Money carried over into this pool from earlier tournaments, each named. */
  carriedIn: CarriedIn[];
  carriedInCents: Cents;
  highHand: HighHandBreakdown;
}

/** Whether the TD has confirmed the entry's payment at the desk: only then is its money in the prize pool. */
export function hasPaid(entry: Pick<EntryInput, "paymentConfirmed">): boolean {
  return entry.paymentConfirmed === true;
}

/** Whether the entry has a free entry (round 7): its buy-ins are nobody's money, unless the club pays them in. */
export function isFreeEntry(entry: Pick<EntryInput, "freeEntry">): boolean {
  return entry.freeEntry === true;
}

/**
 * Whether the entry is accepted into the field: paid, or given a free entry (round 7, which also stores
 * it as paid). Only accepted entries are in the prize pool, are paid and are ranked.
 */
export function isAccepted(entry: Pick<EntryInput, "paymentConfirmed" | "freeEntry">): boolean {
  return hasPaid(entry) || isFreeEntry(entry);
}

/** A whole game free to enter (round 7, item 8: a $0 buy-in): the pool is whatever the club puts up (a manual prize pool). */
export function isFreeTournament(tournament: Pick<PrizePoolInput, "buyInAmount">): boolean {
  return toCents(tournament.buyInAmount) === 0;
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
 * The registrations a prize pool counts: only the accepted ones (isAccepted: the payment confirmed, the
 * owner's decision of 2026-10-26, or a free entry, round 7), with all their buy-ins, re-buys, add-ons
 * and their high-hand entry (a free entry's buy-ins bring in money only when the club pays them in:
 * computePrizePool). A sign-up that has not paid, whether it has played or not, and the waiting list
 * (./waiting-list) add nothing until the TD accepts them. Admin, public, TV, dashboard and finalize all
 * count through here, so they agree. An entry that carries no payment status (a public registration)
 * counts nothing: the server works out a pool for anyone who cannot see who paid. An accepted entry is
 * never on the waiting list (accepting it takes it off), but a list that carries its places is read as
 * it is. A tournament completed before snapshots counts its field as it always has
 * (completedBeforeSnapshots).
 */
export function poolEntries<T extends EntryInput>(
  tournament: Pick<PrizePoolInput, "maxPlayers" | "status" | "prizePoolSnapshot">,
  entries: readonly T[],
): T[] {
  const field = fieldEntries(entries, tournament.maxPlayers);
  return completedBeforeSnapshots(tournament) ? field : field.filter(isAccepted);
}

/**
 * The players in the field (everyone but the waiting list) not accepted yet (neither paid nor given a
 * free entry): they play, and their chips count on the table, but their money is not in the prize pool
 * until the TD confirms it. What the TD's screens and finalize warn about.
 */
export function unpaidEntries<T extends EntryInput>(tournament: Pick<PrizePoolInput, "maxPlayers">, entries: readonly T[]): T[] {
  return fieldEntries(entries, tournament.maxPlayers).filter((entry) => !isAccepted(entry));
}

/**
 * Every entry recorded in the field (the waiting list left out), paid or not: what a new price would
 * re-price, since the desk asks every player for their entries at today's prices and the pool counts
 * each one once paid. The prize pool itself counts only accepted entries (computePrizePool's `counts`).
 */
export function recordedEntryCounts(tournament: Pick<PrizePoolInput, "maxPlayers">, entries: readonly EntryInput[]): EntryCounts {
  return countEntries(fieldEntries(entries, tournament.maxPlayers));
}

/**
 * Works out a tournament's pool from its settings and the registrations passed in, as poolEntries
 * counts them: accepted players only. A free entry's buy-ins are not in the gross and take no AP; the
 * club's payment for a funded one is added to the money available as it is.
 */
export function computePrizePool(tournament: PrizePoolInput, entries: readonly EntryInput[]): PrizePoolBreakdown {
  const counts = countEntries(poolEntries(tournament, entries));

  const buyInPrice = toCents(tournament.buyInAmount);
  const paidBuyIns = counts.buyIns - counts.freeBuyIns;
  const buyIn = paidBuyIns * buyInPrice;
  const rebuy = counts.rebuys * toCents(tournament.rebuyAmount);
  const addon = counts.addons * toCents(tournament.addonAmount);
  const gross = { buyIn, rebuy, addon, total: buyIn + rebuy + addon };
  const freeEntries = { entries: counts.freeEntries, funded: counts.fundedFreeEntries, addedCents: counts.fundedBuyIns * buyInPrice };

  const buyInRake = rakeCents(tournament.rakeType, tournament.rakeAmount, paidBuyIns, buyIn);
  const rebuyRake = rakeCents(tournament.rebuyRakeType, tournament.rebuyRakeAmount, counts.rebuys, rebuy);
  const addonRake = rakeCents(tournament.addonRakeType, tournament.addonRakeAmount, counts.addons, addon);
  const calculated = buyInRake + rebuyRake + addonRake;
  const override = isAmountSet(tournament.rakeOverride) ? toCents(tournament.rakeOverride) : null;
  const applied = override ?? calculated;

  const carriedIn = readCarriedIn(tournament.carriedIn);
  const carriedInTotal = carriedInCents(carriedIn);
  const manualPrizePool = isAmountSet(tournament.manualPrizePool) ? toCents(tournament.manualPrizePool) : null;
  const netAfterAp = gross.total + carriedInTotal + freeEntries.addedCents - applied;
  // The pool the prizes are set from: a percentage place is a share of it.
  const setPool = manualPrizePool ?? netAfterAp;
  const netSource: NetSource =
    manualPrizePool !== null ? "manual_pool" : override !== null ? "ap_override" : "calculated";

  const resolved = resolvePayoutStructure(tournament.payoutStructure, tournament.customPayouts, setPool);
  const { structure, payouts, net } = paidPlaces(resolved, prizesAsSet(setPool, resolved), counts.registrations);
  // A stored prize_difference (round 5) is not read: whatever the prizes leave is the club's (round 7).
  const difference = settleDifference(net, netAfterAp);

  return {
    algorithm: PAYOUT_ALGORITHM,
    counts,
    gross,
    rake: { buyIn: buyInRake, rebuy: rebuyRake, addon: addonRake, calculated, override, applied },
    netAfterAp,
    manualPrizePool,
    net,
    netSource,
    impliedRake: gross.total + carriedInTotal - net,
    structure,
    payouts,
    difference,
    freeEntries,
    carriedIn,
    carriedInCents: carriedInTotal,
    highHand: highHandCents(tournament, counts.highHandEntrants),
  };
}

/**
 * What is paid of the prizes as set (`asSet`: every place's amount, and what they add up to), and the
 * structure as set: a share table keeps its shares; custom places are each given their share of what
 * they pay as set, and places that pay more than the place above them are named in `structure.warning`.
 * Only the places with a player in them are paid (`players`: places beyond the accepted players are not,
 * legacy D28), so `net` is what those places add up to and what the rest would pay is left for the
 * club's fee with the rest of the leftover (round 7). Nothing is paid from a pool of zero or less: its
 * prizes "add up to" the pool as it is.
 */
function paidPlaces(
  resolved: ResolvedPayoutStructure,
  asSet: { amounts: readonly Cents[]; setCents: Cents },
  players: number,
): { structure: ResolvedPayoutStructure; payouts: Payout[]; net: Cents } {
  const { amounts, setCents } = asSet;
  const custom = resolved.places !== undefined;
  const [outOfOrder] = custom && setCents > 0 ? outOfOrderPlaces(amounts) : [];
  const structure: ResolvedPayoutStructure = {
    ...resolved,
    basisPoints: custom && setCents > 0 ? sharesOfAmounts(amounts) : resolved.basisPoints,
    ...(outOfOrder ? { warning: outOfOrder.message } : {}),
  };
  if (setCents <= 0) return { structure, payouts: [], net: setCents };
  const paid = amounts.slice(0, Math.max(0, players));
  const net = paid.reduce((sum, amount) => sum + amount, 0);
  if (net <= 0) return { structure, payouts: [], net };
  const payouts = paid.map((amountCents, i) => ({
    position: i + 1,
    basisPoints: structure.basisPoints[i],
    percentage: structure.basisPoints[i] / 100,
    amountCents,
    ...(resolved.places ? { kind: resolved.places[i].kind } : {}),
  }));
  return { structure, payouts, net };
}

/** What taking back one entry's payment takes out (paymentDropCents). */
export interface PaymentDrop {
  /** Out of the prize pool, what the places pay: 0 when it is set by hand. */
  poolCents: Cents;
  /** Out of the high-hand pot. */
  highHandCents: Cents;
  /** The prize pool as set by hand, which a payment taken back leaves as it is; null when it is worked out. */
  manualPoolCents: Cents | null;
}

/**
 * What marking an entry as not paid (round 9, the desk's Fix menu) takes out of the prize pool and the
 * high-hand pot, as the server will work them out: each with the entry paid, less each with it not
 * paid (only paid entries are in either; the places paid and the AP follow). `entries` are every
 * registration with its payment status, as the club's staff are sent them.
 */
export function paymentDropCents(tournament: PrizePoolInput, entries: readonly (EntryInput & { id: string })[], registrationId: string): PaymentDrop {
  const before = computePrizePool(tournament, entries);
  const after = computePrizePool(
    tournament,
    entries.map((entry) => (entry.id === registrationId ? { ...entry, paymentConfirmed: false } : entry)),
  );
  return {
    poolCents: before.net - after.net,
    highHandCents: before.highHand.net - after.highHand.net,
    manualPoolCents: before.manualPrizePool,
  };
}

/**
 * What the places with no accepted player in them would pay as set (0 when every place has one, or
 * nothing is paid): part of the leftover the club keeps (round 7), which the staff's screens name so the
 * TD knows why the leftover is what it is.
 */
export function unfilledPlacesCents(pool: Pick<PrizePoolBreakdown, "manualPrizePool" | "netAfterAp" | "structure" | "counts">): Cents {
  const { amounts, setCents } = prizesAsSet(pool.manualPrizePool ?? pool.netAfterAp, pool.structure);
  if (setCents <= 0) return 0;
  return amounts.slice(pool.counts.registrations).reduce((sum, amount) => sum + amount, 0);
}

function countEntries(entries: readonly EntryInput[]): EntryCounts {
  const counts = { registrations: 0, buyIns: 0, rebuys: 0, addons: 0, highHandEntrants: 0, freeEntries: 0, fundedFreeEntries: 0, freeBuyIns: 0, fundedBuyIns: 0 };
  for (const entry of entries) {
    const registrations = entry.registrationCount ?? 1;
    const buyIns = entry.buyIns ?? 0;
    counts.registrations += registrations;
    counts.buyIns += buyIns;
    counts.rebuys += entry.rebuys ?? 0;
    counts.addons += entry.addons ?? 0;
    if (entry.enteringHighHands) counts.highHandEntrants += registrations;
    if (isFreeEntry(entry)) {
      counts.freeEntries += registrations;
      counts.freeBuyIns += buyIns;
      if (entry.freeEntryFunded === true) {
        counts.fundedFreeEntries += registrations;
        counts.fundedBuyIns += buyIns;
      }
    }
  }
  return counts;
}

/**
 * What one registration owes (or paid): every buy-in, re-buy and add-on at the tournament's prices,
 * plus the high-hand entry when it entered the high hand (money-18). An entry counts in the high hand
 * exactly when the pot counts it (`enteringHighHands`), so the payment desk asks for what the pot holds.
 * A free entry (round 7) owes nothing for its buy-ins, only for the rest.
 */
export function amountDueCents(
  tournament: Pick<PrizePoolInput, "buyInAmount" | "rebuyAmount" | "addonAmount" | "highHandAmount">,
  entry: EntryInput,
): Cents {
  return (
    (isFreeEntry(entry) ? 0 : toCents(tournament.buyInAmount) * (entry.buyIns ?? 0)) +
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
 * - "live": any other tournament: what finalize would pay now, the payouts of the current pool for as
 *   many places as there are accepted players (places beyond them are not paid: legacy D28; what they
 *   would pay is the club's, with the rest of the leftover: round 7).
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
   * What a snapshot frozen before round 7 left unpaid of its pool (places beyond the number of
   * entrants). 0 otherwise: since round 7 the pool is what the places pay (a live pool, and every
   * snapshot since), and stored prizes recorded no pool.
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
  const rows = prizePool.payouts.map((p) => ({ position: p.position, amountCents: p.amountCents, percentage: p.percentage }));
  return { source: "live", rows, totalCents: sumAmounts(rows), undistributedCents: 0 };
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
 * `entries` may be per registration, or rows of totals (marked paid or not, with no id, each with the
 * `registrationCount` it sums): only the sums, and how many players are in the pool, matter.
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
