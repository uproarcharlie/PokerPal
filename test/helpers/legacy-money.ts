/**
 * The money arithmetic the app ran before Phase 2 (commit dddf8ad), kept only for the parity tests:
 * shared/domain's exact-cents figures are checked against it, and it against reference copies of the
 * old code. Nothing in the app pays or shows from it any more (P2REV4-CQ-02).
 */
import { isAmountSet, parseAmount, type MoneyInput } from "@shared/domain/money";
import { PAYOUT_STRUCTURES, type StandardPayoutKey } from "@shared/domain/payouts";
import type { EntryInput, PrizePoolInput } from "@shared/domain/prize-pool";

/** A place as the old code showed it: `amount` is whole dollars. */
export interface LegacyPayout {
  position: number;
  percentage: number;
  amount: number;
}

const FULL_POOL_BP = 10_000;

function isStandardKey(key: string | null | undefined): key is StandardPayoutKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(PAYOUT_STRUCTURES, key);
}

/**
 * The old split, as finalize (server/routes.ts:886-897), the admin page (tournament-details.tsx:318-336)
 * and the public page (public-tournament-view.tsx:238-256) computed it at dddf8ad: each place is
 * Math.round(pool × share) whole dollars, so the places can add up to more or less than the pool.
 * "custom" and unknown structures pay Standard. A pool of zero or less pays nothing.
 */
export function legacyPayouts(pool: number, structure: string | null | undefined): LegacyPayout[] {
  if (!(pool > 0)) return [];
  const basisPoints = isStandardKey(structure) ? PAYOUT_STRUCTURES[structure] : PAYOUT_STRUCTURES.standard;
  return basisPoints.map((bp, i) => {
    // bp / 10000 is the same double as the literal in the old tables (0.35 for 3500).
    const fraction = bp / FULL_POOL_BP;
    return { position: i + 1, percentage: fraction * 100, amount: Math.round(pool * fraction) };
  });
}

interface ComponentAmounts {
  buyIn: number;
  rebuy: number;
  addon: number;
  total: number;
}

/** The old figures as float dollars. */
export interface LegacyFigures {
  gross: ComponentAmounts;
  rake: ComponentAmounts;
  /** gross.total - rake.total: what finalize and the public page paid from. */
  calculatedNet: number;
  /** The admin page's pool: the manual prize pool if set, else calculatedNet. (No AP override then.) */
  net: number;
  /** legacyPayouts(net, payoutStructure) */
  payouts: LegacyPayout[];
  /** The admin page's high-hand figures: any non-percentage rake type deducted the amount as a flat fee. */
  highHand: { gross: number; rake: number; net: number; perWinner: number };
}

function legacyRake(type: string | null | undefined, amount: MoneyInput, count: number, subtotal: number): number {
  if (type === "percentage") return subtotal * (parseAmount(amount) / 100);
  if (type === "fixed") return count * parseAmount(amount);
  return 0;
}

/**
 * The old float arithmetic. The expressions and their order match finalize (server/routes.ts:843-875),
 * the admin page (tournament-details.tsx:278-315 and 881-889), the public page
 * (public-tournament-view.tsx:200-232) and the calculator (prize-pool-calculator.tsx:56-63) at dddf8ad.
 * Do not reorder or simplify them: the parity tests compare them bit for bit.
 */
export function legacyFigures(t: PrizePoolInput, entries: readonly EntryInput[]): LegacyFigures {
  const counts = { buyIns: 0, rebuys: 0, addons: 0, highHandEntrants: 0 };
  for (const entry of entries) {
    counts.buyIns += entry.buyIns ?? 0;
    counts.rebuys += entry.rebuys ?? 0;
    counts.addons += entry.addons ?? 0;
    if (entry.enteringHighHands) counts.highHandEntrants += 1;
  }
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
