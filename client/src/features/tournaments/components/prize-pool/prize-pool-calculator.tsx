import { formatAmount, formatMoney, type Cents } from "@/lib/format";
import { EmptyState } from "@/components/shared/query-state";
import { Calculator } from "lucide-react";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { DEFAULT_RAKE_LABEL, type PayoutDisplay, type PrizePoolBreakdown, type PrizePoolInput } from "@shared/domain/prize-pool";
import { describeApRates, rateText } from "@shared/domain/rake-rates";
import { HighHandAwards, PaidPool } from "./paid-pool";
import { ManualAdjustment, PoolCard, PoolLine } from "./pool-lines";
import { offersAddons, offersHighHand, offersRebuys } from "@shared/domain/player-actions";

/** What the calculator reads of a tournament: its money settings, and what finalize froze. */
export type CalculatorTournament = PrizePoolInput & Partial<Pick<TournamentDetailDto, "enableHighHand" | "prizePoolSnapshot">>;

interface PrizePoolCalculatorProps {
  tournament: CalculatorTournament;
  /** computePrizePool(tournament, registrations): the same figures finalize pays from. */
  breakdown: PrizePoolBreakdown;
  /** payoutsForDisplay: for a completed tournament, what was paid (the card then shows that, never a recalculation). */
  display: PayoutDisplay;
  /** The club's name for rake, e.g. "AP". */
  rakeLabel?: string;
  /** The high-hand prizes already awarded, in cents: what the next winner gets is worked out from them. */
  highHandAwardsCents?: readonly Cents[];
}

const amount = (value: PrizePoolInput["buyInAmount"]) => formatAmount(value, { forceCents: true });

/**
 * The prize pool worked out line by line, the lines always adding up to the net pool. While the
 * tournament runs it is the live calculation; once it is completed it shows what finalize froze
 * (D20), or for a tournament finalized before snapshots the stored prizes, with the recalculation
 * clearly marked as one; a cancelled one pays nothing.
 */
export function PrizePoolCalculator({
  tournament,
  breakdown,
  display,
  rakeLabel = DEFAULT_RAKE_LABEL,
  highHandAwardsCents = [],
}: PrizePoolCalculatorProps) {
  const snapshot = display.source === "snapshot" ? tournament.prizePoolSnapshot : null;
  if (snapshot) return <PaidPool pool={snapshot.pool} display={display} rakeLabel={rakeLabel} />;
  if (display.source === "cancelled") {
    return (
      <PoolCard title="Prize Pool">
        <p className="text-center text-sm text-muted-foreground" data-testid="pool-cancelled">
          Cancelled: no prizes are paid
        </p>
      </PoolCard>
    );
  }

  const { counts, gross, rake, highHand } = breakdown;
  const recalculated = display.source === "stored" || display.source === "unrecorded";
  const rates = describeApRates(tournament);
  const rakeDescription = rake.override !== null ? " (manual total)" : rates ? ` (${rates})` : "";
  const highHandRakeShown = (tournament.highHandRakeType === "percentage" || tournament.highHandRakeType === "fixed") && highHand.rake > 0;

  return (
    <PoolCard
      title="Prize Pool Calculator"
      description={
        display.source === "unrecorded"
          ? "Estimated from today's settings: this tournament's prizes were never recorded"
          : recalculated
            ? "Recalculated from today's settings: this tournament was finalized before payouts were recorded in full"
            : "Real-time prize pool calculation"
      }
    >
      {/* A manual pool with nothing taken in (a freeroll or a guaranteed pool) is still a pool finalize pays. */}
      {gross.total > 0 || breakdown.manualPrizePool !== null ? (
        <>
          <div className="space-y-1">
            <PoolLine label={`Buy-ins (${counts.buyIns} × ${amount(tournament.buyInAmount)})`} value={formatMoney(gross.buyIn)} testId="buyins-total" />
            {offersRebuys(tournament) && counts.rebuys > 0 ? (
              <PoolLine label={`Re-buys (${counts.rebuys} × ${amount(tournament.rebuyAmount)})`} value={formatMoney(gross.rebuy)} testId="rebuys-total" />
            ) : null}
            {offersAddons(tournament) && counts.addons > 0 ? (
              <PoolLine label={`Add-ons (${counts.addons} × ${amount(tournament.addonAmount)})`} value={formatMoney(gross.addon)} testId="addons-total" />
            ) : null}
          </div>

          <div className="border-t border-border pt-3">
            <PoolLine label="Gross Total" value={formatMoney(gross.total)} testId="gross-total" tone="total" />
            {rake.applied > 0 ? (
              <PoolLine label={`${rakeLabel}${rakeDescription}`} value={`-${formatMoney(rake.applied)}`} testId="rake-amount" tone="deduction" />
            ) : null}
            {breakdown.netSource === "manual_pool" ? <ManualAdjustment cents={breakdown.net - breakdown.netAfterAp} /> : null}
          </div>

          <div className="border-t-2 border-primary pt-3">
            <PoolLine
              label={recalculated ? "Net Prize Pool (recalculated)" : "Net Prize Pool"}
              value={formatMoney(breakdown.net)}
              testId="net-prize-pool"
              tone="result"
            />
            {breakdown.netSource === "manual_pool" ? (
              <p className="text-right text-xs text-muted-foreground" data-testid="manual-pool-note">
                Set manually (calculated: {formatMoney(breakdown.netAfterAp)})
              </p>
            ) : null}
            {recalculated ? (
              <div data-testid="paid-out">
                <PoolLine label="Paid out" value={formatMoney(display.totalCents)} tone="total" />
              </div>
            ) : null}
          </div>

          {offersHighHand(tournament) && highHand.entrants > 0 ? (
            <div className="border-t border-border pt-3">
              <PoolLine
                label={`High Hand Entries (${highHand.entrants} × ${amount(tournament.highHandAmount)})`}
                value={formatMoney(highHand.gross)}
              />
              {highHandRakeShown ? (
                <PoolLine
                  label={`High Hand ${rakeLabel} (${rateText(tournament.highHandRakeType, tournament.highHandRakeAmount, true)})`}
                  value={`-${formatMoney(highHand.rake)}`}
                  tone="deduction"
                />
              ) : null}
              <PoolLine label="Net High Hand Pool" value={formatMoney(highHand.net)} testId="high-hand-net" tone="accent" />
              {highHand.winners > 1 || highHandAwardsCents.length > 0 ? (
                <HighHandAwards highHand={highHand} awardedCents={highHandAwardsCents} />
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={<Calculator className="h-8 w-8" />}
          title="Prize pool will be calculated"
          description="as players register and make entries"
          className="border-0"
        />
      )}
    </PoolCard>
  );
}
