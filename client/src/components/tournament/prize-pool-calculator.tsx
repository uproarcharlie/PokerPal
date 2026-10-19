import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator } from "lucide-react";
import type { PrizePoolSnapshot } from "@shared/api/finalize";
import { formatMoney, toCents, type Cents } from "@shared/domain/money";
import { DEFAULT_RAKE_LABEL, nextHighHandAward, type PayoutDisplay, type PrizePoolBreakdown } from "@shared/domain/prize-pool";
import { describeApRates, type RakeRates } from "@shared/domain/rake-rates";

interface Tournament extends RakeRates {
  buyInAmount: string;
  rebuyAmount?: string | null;
  addonAmount?: string | null;
  enableHighHand?: boolean | null;
  highHandAmount?: string | null;
  highHandRakeType?: string | null;
  highHandRakeAmount?: string | null;
  prizePoolSnapshot?: PrizePoolSnapshot | null;
}

interface PrizePoolCalculatorProps {
  tournament: Tournament;
  /** computePrizePool(tournament, registrations): the same figures finalize pays from. */
  breakdown: PrizePoolBreakdown;
  /** payoutsForDisplay: for a completed tournament, what was paid (the card then shows that, never a recalculation). */
  display: PayoutDisplay;
  /** The club's name for rake, e.g. "AP". */
  rakeLabel?: string;
  /** The high-hand prizes already awarded, in cents: what the next winner gets is worked out from them. */
  highHandAwardsCents?: readonly Cents[];
}

const amount = (value: string | null | undefined) => formatMoney(toCents(value), { forceCents: true });

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
  if (display.source === "cancelled") return <CancelledPool />;

  const { counts, gross, rake, highHand } = breakdown;
  const recalculated = display.source === "stored" || display.source === "unrecorded";

  const rakeDescription = () => {
    if (rake.override !== null) return " (manual total)";
    const rates = describeApRates(tournament);
    return rates ? ` (${rates})` : "";
  };

  const highHandRakeShown =
    (tournament.highHandRakeType === "percentage" || tournament.highHandRakeType === "fixed") && highHand.rake > 0;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          Prize Pool Calculator
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {display.source === "unrecorded"
            ? "Estimated from today's settings: this tournament's prizes were never recorded"
            : recalculated
              ? "Recalculated from today's settings: this tournament was finalized before payouts were recorded in full"
              : "Real-time prize pool calculation"}
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {/* A manual pool with nothing taken in (a freeroll or a guaranteed pool) is still a pool finalize pays. */}
        {gross.total > 0 || breakdown.manualPrizePool !== null ? (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">
                  Buy-ins ({counts.buyIns} × {amount(tournament.buyInAmount)})
                </span>
                <span className="text-sm font-semibold text-foreground" data-testid="buyins-total">
                  {formatMoney(gross.buyIn)}
                </span>
              </div>

              {tournament.rebuyAmount && counts.rebuys > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    Re-buys ({counts.rebuys} × {amount(tournament.rebuyAmount)})
                  </span>
                  <span className="text-sm font-semibold text-foreground" data-testid="rebuys-total">
                    {formatMoney(gross.rebuy)}
                  </span>
                </div>
              )}

              {tournament.addonAmount && counts.addons > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    Add-ons ({counts.addons} × {amount(tournament.addonAmount)})
                  </span>
                  <span className="text-sm font-semibold text-foreground" data-testid="addons-total">
                    {formatMoney(gross.addon)}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-foreground">Gross Total</span>
                <span className="text-sm font-bold text-foreground" data-testid="gross-total">
                  {formatMoney(gross.total)}
                </span>
              </div>

              {rake.applied > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    {rakeLabel}
                    {rakeDescription()}
                  </span>
                  <span className="text-sm text-destructive" data-testid="rake-amount">
                    -{formatMoney(rake.applied)}
                  </span>
                </div>
              )}
              {breakdown.netSource === "manual_pool" && <ManualAdjustment cents={breakdown.net - breakdown.netAfterAp} />}
            </div>

            <div className="border-t-2 border-primary pt-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-base font-bold text-foreground">{recalculated ? "Net Prize Pool (recalculated)" : "Net Prize Pool"}</span>
                <span className="text-2xl font-bold text-primary" data-testid="net-prize-pool">
                  {formatMoney(breakdown.net)}
                </span>
              </div>
              {breakdown.netSource === "manual_pool" && (
                <p className="text-xs text-muted-foreground text-right" data-testid="manual-pool-note">
                  Set manually (calculated: {formatMoney(breakdown.netAfterAp)})
                </p>
              )}
              {recalculated && (
                <div className="flex items-center justify-between py-2" data-testid="paid-out">
                  <span className="text-sm font-medium text-foreground">Paid out</span>
                  <span className="text-sm font-bold text-foreground">{formatMoney(display.totalCents)}</span>
                </div>
              )}
            </div>

            {tournament.enableHighHand && tournament.highHandAmount && highHand.entrants > 0 && (
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    High Hand Entries ({highHand.entrants} × {amount(tournament.highHandAmount)})
                  </span>
                  <span className="text-sm font-semibold text-foreground">{formatMoney(highHand.gross)}</span>
                </div>

                {highHandRakeShown && (
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">
                      High Hand {rakeLabel} (
                      {tournament.highHandRakeType === "percentage"
                        ? `${tournament.highHandRakeAmount}%`
                        : amount(tournament.highHandRakeAmount)}
                      )
                    </span>
                    <span className="text-sm text-destructive">-{formatMoney(highHand.rake)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-foreground">Net High Hand Pool</span>
                  <span className="text-sm font-bold text-accent" data-testid="high-hand-net">
                    {formatMoney(highHand.net)}
                  </span>
                </div>

                {(highHand.winners > 1 || highHandAwardsCents.length > 0) && (
                  <HighHandAwards highHand={highHand} awardedCents={highHandAwardsCents} />
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <Calculator className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Prize pool will be calculated</p>
            <p className="text-xs text-muted-foreground mt-1">as players register and make entries</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * How far a manual prize pool is from what the rates give: taken off (negative) or added by the club
 * (positive), so the lines above the net pool always add up to it (P2REV1-MONEY-03).
 */
function ManualAdjustment({ cents }: { cents: Cents }) {
  if (cents === 0) return null;
  return (
    <div className="flex items-center justify-between py-2" data-testid="manual-adjustment">
      <span className="text-sm text-muted-foreground">{cents > 0 ? "Added by the club" : "Manual adjustment"}</span>
      <span className={cents > 0 ? "text-sm text-foreground" : "text-sm text-destructive"}>
        {cents > 0 ? "+" : "-"}
        {formatMoney(Math.abs(cents))}
      </span>
    </div>
  );
}

/** A cancelled tournament pays nothing (finalize refuses it), so there is no pool to work out. */
function CancelledPool() {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          Prize Pool
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground text-center" data-testid="pool-cancelled">
          Cancelled: no prizes are paid
        </p>
      </CardContent>
    </Card>
  );
}

/** A finalized tournament's pool exactly as finalize froze it, its lines adding up to the net pool. */
function PaidPool({ pool, display, rakeLabel }: { pool: PrizePoolSnapshot["pool"]; display: PayoutDisplay; rakeLabel: string }) {
  const ap = pool.rakeOverrideCents ?? pool.rakeCalculatedCents;
  const adjustment = pool.netSource === "manual_pool" ? pool.netCents - (pool.grossCents - ap) : 0;
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          Prize Pool
        </CardTitle>
        <p className="text-sm text-muted-foreground">As finalized: what was taken in and paid out</p>
      </CardHeader>
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-medium text-foreground">Gross Total</span>
          <span className="text-sm font-bold text-foreground" data-testid="gross-total">
            {formatMoney(pool.grossCents)}
          </span>
        </div>
        {ap > 0 && (
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted-foreground">
              {rakeLabel}
              {pool.rakeOverrideCents !== null ? " (manual total)" : ""}
            </span>
            <span className="text-sm text-destructive" data-testid="rake-amount">
              -{formatMoney(ap)}
            </span>
          </div>
        )}
        <ManualAdjustment cents={adjustment} />
        <div className="border-t-2 border-primary pt-3">
          <div className="flex items-center justify-between py-2">
            <span className="text-base font-bold text-foreground">Net Prize Pool</span>
            <span className="text-2xl font-bold text-primary" data-testid="net-prize-pool">
              {formatMoney(pool.netCents)}
            </span>
          </div>
          {pool.netSource === "manual_pool" && (
            <p className="text-xs text-muted-foreground text-right" data-testid="manual-pool-note">
              Set manually (calculated: {formatMoney(pool.grossCents - ap)})
            </p>
          )}
          <div className="flex items-center justify-between py-2" data-testid="paid-out">
            <span className="text-sm font-medium text-foreground">Paid out</span>
            <span className="text-sm font-bold text-foreground">{formatMoney(display.totalCents)}</span>
          </div>
          {display.undistributedCents > 0 && (
            <p className="text-xs text-muted-foreground text-right" data-testid="undistributed">
              {formatMoney(display.undistributedCents)} of the pool was not paid out: there were fewer players than paid places
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The high-hand prizes: how many, what has been awarded, and what the next winner gets, worked out
 * exactly as the server awards it (nextHighHandAward: what is left over the winners still to come, the
 * last taking the remainder), so the figure the TD reads out is the one paid (P2REV1-07).
 */
function HighHandAwards({
  highHand,
  awardedCents,
}: {
  highHand: PrizePoolBreakdown["highHand"];
  awardedCents: readonly Cents[];
}) {
  const next = nextHighHandAward(highHand, awardedCents);
  const awarded = awardedCents.reduce((sum, amount) => sum + amount, 0);
  return (
    <>
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-muted-foreground">Number of Winners</span>
        <span className="text-sm font-semibold text-foreground">{highHand.winners}</span>
      </div>
      {awardedCents.length > 0 && (
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-muted-foreground">
            Awarded So Far ({awardedCents.length} of {highHand.winners})
          </span>
          <span className="text-sm font-semibold text-foreground" data-testid="high-hand-awarded">
            {formatMoney(awarded)}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between py-2">
        <span className="text-sm font-medium text-foreground">Next Winner Gets</span>
        <span className="text-sm font-bold text-accent" data-testid="high-hand-next-award">
          {next === null ? "All prizes awarded" : formatMoney(next)}
        </span>
      </div>
    </>
  );
}
