/**
 * Prize pool, AP (rake) and payout maths for one tournament: the single source of truth for the client
 * and the server. PURE: no I/O, no Date, and no runtime imports outside shared/domain.
 *
 * `computePrizePool` returns two sets of figures:
 * - the top-level ones are exact integer cents. Payouts, stored amounts and totals come from these.
 * - `legacy` repeats today's float arithmetic, with the same expressions in the same order as the code
 *   at dddf8ad, so the gross, AP and net that today's screens show are reproduced bit for bit. It is for
 *   parity checks and for showing tournaments finalized before v2. Never pay from it.
 *
 * Precedence: a manual prize pool beats the manual AP total (`rakeOverride`), which beats the AP the
 * club's rates give. High-hand money is a separate pot and is never part of the AP override.
 */
import {
  isAmountSet,
  parseAmount,
  percentOfCents,
  toBasisPoints,
  toCents,
  type Cents,
  type MoneyInput,
} from "./money";
import {
  allocatePayouts,
  legacyPayouts,
  PAYOUT_ALGORITHM,
  resolvePayoutStructure,
  type LegacyPayout,
  type Payout,
  type PayoutAlgorithm,
  type ResolvedPayoutStructure,
} from "./payouts";

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
}

/** One registration's entries. A null count counts as 0, as it does today. */
export interface EntryInput {
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
  winners: number;
  /** The suggested award per winner: net split evenly, rounded down to the cent (0 when net <= 0). */
  perWinner: Cents;
  /** The cents an even split leaves over. */
  remainder: Cents;
}

/** Today's figures as float dollars. */
export interface LegacyFigures {
  gross: ComponentAmounts;
  rake: ComponentAmounts;
  /** gross.total - rake.total: what finalize and the public page pay from today. */
  calculatedNet: number;
  /** The admin page's pool: the manual prize pool if set, else calculatedNet. (No AP override today.) */
  net: number;
  /** legacyPayouts(net, payoutStructure) */
  payouts: LegacyPayout[];
  /** The admin page's high-hand figures: any non-percentage rake type deducts the amount as a flat fee. */
  highHand: { gross: number; rake: number; net: number; perWinner: number };
}

export interface PrizePoolBreakdown {
  algorithm: PayoutAlgorithm;
  counts: EntryCounts;
  /** In cents. */
  gross: ComponentAmounts;
  rake: RakeBreakdown;
  /** gross.total - rake.calculated */
  netFromRates: Cents;
  /** gross.total - rake.applied */
  netAfterAp: Cents;
  manualPrizePool: Cents | null;
  /** manualPrizePool ?? netAfterAp: the pool the payouts split. */
  net: Cents;
  netSource: NetSource;
  /** gross.total - net: what the club keeps (negative when it adds money to the pool). */
  impliedRake: Cents;
  structure: ResolvedPayoutStructure;
  /** allocatePayouts(net, structure): they add up to `net` exactly. Empty when net <= 0. */
  payouts: Payout[];
  highHand: HighHandBreakdown;
  legacy: LegacyFigures;
}

/**
 * Works out a tournament's pool from its settings and every registration passed in. Unpaid
 * registrations count, as they do today; pass a filtered list to change that.
 */
export function computePrizePool(tournament: PrizePoolInput, entries: readonly EntryInput[]): PrizePoolBreakdown {
  const counts = countEntries(entries);

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

  const manualPrizePool = isAmountSet(tournament.manualPrizePool) ? toCents(tournament.manualPrizePool) : null;
  const netAfterAp = gross.total - applied;
  const net = manualPrizePool ?? netAfterAp;
  const netSource: NetSource =
    manualPrizePool !== null ? "manual_pool" : override !== null ? "ap_override" : "calculated";

  const structure = resolvePayoutStructure(tournament.payoutStructure, tournament.customPayouts);

  return {
    algorithm: PAYOUT_ALGORITHM,
    counts,
    gross,
    rake: { buyIn: buyInRake, rebuy: rebuyRake, addon: addonRake, calculated, override, applied },
    netFromRates: gross.total - calculated,
    netAfterAp,
    manualPrizePool,
    net,
    netSource,
    impliedRake: gross.total - net,
    structure,
    payouts: allocatePayouts(net, structure.basisPoints),
    highHand: highHandCents(tournament, counts.highHandEntrants),
    legacy: legacyFigures(tournament, counts),
  };
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

function rakeCents(type: string | null | undefined, amount: MoneyInput, count: number, subtotal: Cents): Cents {
  if (type === "percentage") return percentOfCents(subtotal, toBasisPoints(amount));
  if (type === "fixed") return count * toCents(amount);
  return 0;
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
  const perWinner = net > 0 ? Math.floor(net / winners) : 0;
  return { entrants, gross, rake, net, winners, perWinner, remainder: net > 0 ? net - perWinner * winners : 0 };
}

/**
 * Today's float arithmetic. The expressions and their order match finalize (server/routes.ts:843-875),
 * the admin page (tournament-details.tsx:278-315 and 881-889), the public page
 * (public-tournament-view.tsx:200-232) and the calculator (prize-pool-calculator.tsx:56-63) at dddf8ad.
 * Do not reorder or simplify them: the parity tests compare them bit for bit.
 */
function legacyFigures(t: PrizePoolInput, counts: EntryCounts): LegacyFigures {
  const buyInTotal = counts.buyIns * parseAmount(t.buyInAmount);
  const rebuyTotal = counts.rebuys * parseAmount(t.rebuyAmount);
  const addonTotal = counts.addons * parseAmount(t.addonAmount);
  const grossTotal = buyInTotal + rebuyTotal + addonTotal;

  const buyInRake = legacyRake(t.rakeType, t.rakeAmount, counts.buyIns, buyInTotal);
  const rebuyRake = legacyRake(t.rebuyRakeType, t.rebuyRakeAmount, counts.rebuys, rebuyTotal);
  const addonRake = legacyRake(t.addonRakeType, t.addonRakeAmount, counts.addons, addonTotal);
  const rake = buyInRake + rebuyRake + addonRake;
  const calculatedNet = grossTotal - rake;
  const net = isAmountSet(t.manualPrizePool) ? parseAmount(t.manualPrizePool) : calculatedNet;

  const highHandGross = counts.highHandEntrants * parseAmount(t.highHandAmount);
  const highHandRake =
    t.highHandRakeType === "percentage"
      ? highHandGross * (parseAmount(t.highHandRakeAmount) / 100)
      : parseAmount(t.highHandRakeAmount);
  const highHandNet = highHandGross - highHandRake;
  const perWinner = t.highHandPayouts && t.highHandPayouts > 0 ? highHandNet / t.highHandPayouts : highHandNet;

  return {
    gross: { buyIn: buyInTotal, rebuy: rebuyTotal, addon: addonTotal, total: grossTotal },
    rake: { buyIn: buyInRake, rebuy: rebuyRake, addon: addonRake, total: rake },
    calculatedNet,
    net,
    payouts: legacyPayouts(net, t.payoutStructure),
    highHand: { gross: highHandGross, rake: highHandRake, net: highHandNet, perWinner },
  };
}

function legacyRake(type: string | null | undefined, amount: MoneyInput, count: number, subtotal: number): number {
  if (type === "percentage") return subtotal * (parseAmount(amount) / 100);
  if (type === "fixed") return count * parseAmount(amount);
  return 0;
}

/* ---------- what to show as a tournament's payouts ---------- */

/** A registration's stored result. A `TournamentRegistration` row fits as it is. */
export interface StoredResultInput {
  id: string;
  finalPosition?: number | null;
  prizeAmount?: MoneyInput;
}

/**
 * - "stored": a completed tournament's prizes as finalize recorded them, never recomputed (spec D20).
 *   A completed tournament with no recorded prize shows none.
 * - "live": any other tournament: the v2 payouts of the current pool.
 */
export type PayoutDisplaySource = "stored" | "live";

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
  totalCents: Cents;
}

export function payoutsForDisplay(
  tournament: { status?: string | null },
  prizePool: PrizePoolBreakdown,
  registrations: readonly StoredResultInput[],
): PayoutDisplay {
  if (tournament.status === "completed") {
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
    return { source: "stored", rows: stored, totalCents: sumAmounts(stored) };
  }
  const rows = prizePool.payouts.map((p) => ({
    position: p.position,
    amountCents: p.amountCents,
    percentage: p.percentage,
  }));
  return { source: "live", rows, totalCents: sumAmounts(rows) };
}

function sumAmounts(rows: readonly { amountCents: Cents }[]): Cents {
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

/** The club's name for rake, e.g. "AP". Null or blank shows "Rake". Display only; never used in maths. */
export function rakeLabel(club?: { rakeLabel?: string | null } | null): string {
  const label = club?.rakeLabel?.trim();
  return label ? label : DEFAULT_RAKE_LABEL;
}
