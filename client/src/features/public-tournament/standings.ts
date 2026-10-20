/**
 * The public page's prize structure: which places it lists and what each pays and scores. Display only:
 * finalize pays from shared/domain. The standings order is shared/domain/standings' `standingsFor`.
 */
import { allocationFor, pointsForFinish, type PointsRules } from "@shared/domain/points";
import type { PayoutDisplayRow } from "@shared/domain/prize-pool";

export interface PrizeRow {
  position: number;
  /** What the place pays, when it is paid. */
  payout: PayoutDisplayRow | undefined;
  /** The points finalize awards the place (no knockouts), 0 without a points system. */
  points: number;
}

export interface PrizeTable {
  rows: PrizeRow[];
  /** "Every other finisher" from this place on, and what they score; null when they score nothing. */
  others: { from: number; points: number } | null;
}

/**
 * The prize structure's rows: every place that is paid, has a points allocation or scores
 * participation points, up to the last paid or allocated place; then one row for everyone after,
 * when they still score (finalize's participation points). The payouts come from payoutsForDisplay.
 */
export function prizeTable(payouts: readonly PayoutDisplayRow[], rules: PointsRules): PrizeTable {
  const placePoints = (position: number) => pointsForFinish(rules, position, 0) ?? 0;
  const lastPaid = payouts[payouts.length - 1]?.position ?? 0;
  const lastAllocated = Math.max(0, ...rules.allocations.map((allocation) => allocation.positionEnd || allocation.position));
  const last = Math.max(lastPaid, lastAllocated);

  const rows: PrizeRow[] = [];
  for (let position = 1; position <= last; position++) {
    const payout = payouts.find((row) => row.position === position);
    const points = placePoints(position);
    if (payout || allocationFor(position, rules.allocations) || points > 0) rows.push({ position, payout, points });
  }

  const othersPoints = placePoints(last + 1);
  return { rows, others: othersPoints > 0 ? { from: last + 1, points: othersPoints } : null };
}
