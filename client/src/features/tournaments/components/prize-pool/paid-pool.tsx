import { formatMoney, type Cents } from "@/lib/format";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { describeDeal, type SnapshotDeal } from "@shared/domain/deal";
import { nextHighHandAward, type PayoutDisplay, type PrizePoolBreakdown } from "@shared/domain/prize-pool";
import { frozenSummary } from "@/features/prize-pool/components/public/pool-summary";
import { DifferenceRows, LeftoverNote, PoolCard, PoolLine } from "./pool-lines";
import { undistributedNote } from "@/lib/prize-pool";

type FrozenPool = NonNullable<TournamentDetailDto["prizePoolSnapshot"]>["pool"];

interface PaidPoolProps {
  pool: FrozenPool;
  display: PayoutDisplay;
  rakeLabel: string;
  /** The deal the players still in made, when finalize paid one. */
  deal?: SnapshotDeal;
}

/**
 * A finalized tournament's pool exactly as finalize froze it, its lines adding up to the net pool (money
 * carried in, kept by the club, carried over or added by the club: round 5, item 16), and any deal it paid.
 */
export function PaidPool({ pool, display, rakeLabel, deal }: PaidPoolProps) {
  const ap = pool.rakeOverrideCents ?? pool.rakeCalculatedCents;
  const { lines } = frozenSummary(pool, rakeLabel);
  return (
    <PoolCard title="Prize Pool" description="As finalized: what was taken in and paid out">
      <PoolLine label="Gross Total" value={formatMoney(pool.grossCents)} testId="gross-total" tone="total" />
      {ap > 0 ? (
        <PoolLine
          label={`${rakeLabel}${pool.rakeOverrideCents !== null ? " (manual total)" : ""}`}
          value={`-${formatMoney(ap)}`}
          testId="rake-amount"
          tone="deduction"
        />
      ) : null}
      <DifferenceRows lines={lines} />
      <div className="border-t-2 border-primary pt-3">
        <PoolLine label="Net Prize Pool" value={formatMoney(pool.netCents)} testId="net-prize-pool" tone="result" />
        <LeftoverNote lines={lines} />
        {pool.netSource === "manual_pool" ? (
          <p className="text-right text-xs text-muted-foreground" data-testid="manual-pool-note">
            Set manually (calculated: {formatMoney(pool.difference?.availableCents ?? pool.grossCents - ap)})
          </p>
        ) : null}
        <div data-testid="paid-out">
          <PoolLine label="Paid out" value={formatMoney(display.totalCents)} tone="total" />
        </div>
        {display.undistributedCents > 0 ? (
          <p className="text-right text-xs text-muted-foreground" data-testid="undistributed">
            {undistributedNote(display, 0)}
          </p>
        ) : null}
        {deal ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="paid-deal">
            Deal: {describeDeal(deal)} ({deal.reason}). The {deal.players.length} players still in shared the {formatMoney(deal.totalCents)} their
            places paid.
          </p>
        ) : null}
      </div>
    </PoolCard>
  );
}

/**
 * The high-hand prizes: how many, what has been awarded, and what the next winner gets, worked out
 * exactly as the server awards it (nextHighHandAward: what is left over the winners still to come, the
 * last taking the remainder), so the figure the TD reads out is the one paid (P2REV1-07).
 */
export function HighHandAwards({ highHand, awardedCents }: { highHand: PrizePoolBreakdown["highHand"]; awardedCents: readonly Cents[] }) {
  const next = nextHighHandAward(highHand, awardedCents);
  const awarded = awardedCents.reduce((sum, cents) => sum + cents, 0);
  return (
    <>
      <PoolLine label="Number of Winners" value={highHand.winners} />
      {awardedCents.length > 0 ? (
        <PoolLine label={`Awarded So Far (${awardedCents.length} of ${highHand.winners})`} value={formatMoney(awarded)} testId="high-hand-awarded" />
      ) : null}
      <PoolLine
        label="Next Winner Gets"
        value={next === null ? "All prizes awarded" : formatMoney(next)}
        testId="high-hand-next-award"
        tone="accent"
      />
    </>
  );
}
