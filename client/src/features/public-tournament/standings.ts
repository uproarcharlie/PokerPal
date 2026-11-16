/**
 * The public page's prize structure: which places it lists and what each pays and scores, and whether
 * it shows points at all. Display only: finalize pays from shared/domain. The standings order is
 * shared/domain/standings' `standingsFor`.
 */
import type { PublicPayoutDto } from "@shared/api/live-display";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { allocationFor, pointsForFinish, type PointsRules } from "@shared/domain/points";

export interface PrizeRow {
  position: number;
  /** What the place pays, when it is paid. */
  payout: PublicPayoutDto | undefined;
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
 * when they still score (finalize's participation points). The payouts are the server's (PublicPrizesDto).
 */
export function prizeTable(payouts: readonly PublicPayoutDto[], rules: PointsRules): PrizeTable {
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

/**
 * Whether the public page shows points: the tournament tracks them and something scores them. A game
 * with no points system scores none (a one-off game, round 7; a tournament made before round 7 may
 * still say trackPoints with no system, and its standings were a column of zeros), unless points were
 * awarded before its system was deleted.
 */
export function showsPoints(
  tournament: Pick<TournamentDetailDto, "trackPoints" | "pointsSystemId">,
  registrations: readonly Pick<PublicRegistration, "pointsAwarded">[],
): boolean {
  if (tournament.trackPoints !== true) return false;
  return tournament.pointsSystemId !== null || registrations.some((entry) => (entry.pointsAwarded ?? 0) > 0);
}
