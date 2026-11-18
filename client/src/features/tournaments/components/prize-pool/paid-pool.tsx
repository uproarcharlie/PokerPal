import { formatMoney } from "@/lib/format";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { describeDeal, type SnapshotDeal } from "@shared/domain/deal";
import type { HighHandStanding } from "@shared/domain/high-hands";
import type { PayoutDisplay } from "@shared/domain/prize-pool";
import { frozenSummary } from "@/features/prize-pool/components/pool-summary";
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
 * carried in, added for free entries, the leftover to the club's fee, added by the club, or, before
 * round 7, carried over), and any deal it paid.
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
            {/* What finalize paid: nobody is still to pay or enter. */}
            {undistributedNote(display)}
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
 * One pot's high-hand prizes: how many, what has been awarded, and what the next winner gets, worked
 * out exactly as the server awards it (highHandStandings: what is left over the winners still to come,
 * the last taking the remainder), so the figure the TD reads out is the one paid (P2REV1-07). Money paid
 * in after the last prize was awarded (a payment confirmed late) is said, with where to give it out
 * (R6REV0-MONEY-01). `testIdSuffix` tells the pots of a game with several high hands apart.
 */
export function HighHandAwards({ standing, testIdSuffix = "" }: { standing: HighHandStanding; testIdSuffix?: string }) {
  const { pot, awards, awardedCents, nextAwardCents, unawardedCents } = standing;
  return (
    <>
      <PoolLine label="Number of Winners" value={pot.winners} />
      {awards.length > 0 ? (
        <PoolLine label={`Awarded So Far (${awards.length} of ${pot.winners})`} value={formatMoney(awardedCents)} testId={`high-hand-awarded${testIdSuffix}`} />
      ) : null}
      <PoolLine
        label="Next Winner Gets"
        value={nextAwardCents === null ? "All prizes awarded" : formatMoney(nextAwardCents)}
        testId={`high-hand-next-award${testIdSuffix}`}
        tone="accent"
      />
      {unawardedCents > 0 ? (
        <PoolLine
          label="Not Awarded Yet"
          note="Paid in after the last award: add it to a winner's prize from Award High Hand."
          value={formatMoney(unawardedCents)}
          testId={`high-hand-unawarded${testIdSuffix}`}
          tone="total"
        />
      ) : null}
    </>
  );
}
