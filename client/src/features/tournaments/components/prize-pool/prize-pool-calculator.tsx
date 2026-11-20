import { formatAmount, formatMoney } from "@/lib/format";
import { EmptyState } from "@/components/shared/query-state";
import { Calculator } from "lucide-react";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { differenceLines } from "@shared/domain/prize-difference";
import { DEFAULT_RAKE_LABEL, type PayoutDisplay, type PrizePoolBreakdown, type PrizePoolInput } from "@shared/domain/prize-pool";
import { highHandLabel, highHandsOf, highHandStandings, type HighHandAward, type HighHandSettings, type HighHandStanding } from "@shared/domain/high-hands";
import { describeApRates, rateText } from "@shared/domain/rake-rates";
import { bountyCents, hasBounty } from "@shared/domain/bounty";
import { HighHandAwards, PaidPool } from "./paid-pool";
import { DifferenceRows, LeftoverNote, PoolCard, PoolLine } from "./pool-lines";
import { offersAddons, offersRebuys } from "@shared/domain/player-actions";

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
  /** The high-hand prizes already awarded (highHandAwardsOf): what each pot's next winner gets is worked out from them. */
  highHandAwards?: readonly HighHandAward[];
}

const NO_AWARDS: readonly HighHandAward[] = [];

const amount = (value: PrizePoolInput["buyInAmount"]) => formatAmount(value, { forceCents: true });

/** Under the free entries (round 7): their buy-ins bring nothing, unless the club pays them in (its own line below the AP). */
function freeEntriesNote(entries: number, funded: number): string {
  if (funded === 0) return "No buy-in paid: they add nothing to the pool";
  if (funded === entries) return "The club pays their buy-ins into the pool";
  return `The club pays ${funded} of their buy-ins into the pool`;
}

/**
 * The prize pool worked out line by line, the lines always adding up to the net pool: the paid buy-ins,
 * re-buys and add-ons, the free entries (round 7: nothing, unless the club pays their buy-ins in), the
 * AP, and what came in or went beside them (differenceLines: the leftover to the club's fee); in a
 * bounty game (round 11) the bounties beside it, never in it. While the tournament runs it is the
 * live calculation; once it is completed it shows what finalize froze (D20),
 * or for a tournament finalized before snapshots the stored prizes, with the recalculation clearly
 * marked as one; a cancelled one pays nothing. The club's staff only.
 */
export function PrizePoolCalculator({
  tournament,
  breakdown,
  display,
  rakeLabel = DEFAULT_RAKE_LABEL,
  highHandAwards = NO_AWARDS,
}: PrizePoolCalculatorProps) {
  const snapshot = display.source === "snapshot" ? tournament.prizePoolSnapshot : null;
  if (snapshot) return <PaidPool pool={snapshot.pool} display={display} rakeLabel={rakeLabel} deal={snapshot.deal} />;
  if (display.source === "cancelled") {
    return (
      <PoolCard title="Prize Pool">
        <p className="text-center text-sm text-muted-foreground" data-testid="pool-cancelled">
          Cancelled: no prizes are paid
        </p>
      </PoolCard>
    );
  }

  const { counts, gross, rake } = breakdown;
  const recalculated = display.source === "stored" || display.source === "unrecorded";
  const rates = describeApRates(tournament);
  const rakeDescription = rake.override !== null ? " (manual total)" : rates ? ` (${rates})` : "";
  const lines = differenceLines(breakdown, rakeLabel);
  const settings = highHandsOf(tournament);
  // Each pot with players in it (round 10: one block per high hand).
  const pots = highHandStandings(breakdown.highHands, highHandAwards).filter(({ pot }) => pot.entrants > 0);
  const paidBuyIns = counts.buyIns - counts.freeBuyIns;

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
      {/* A manual pool or fixed prizes with nothing taken in (a freeroll, a guarantee) are still a pool finalize pays. */}
      {gross.total > 0 || breakdown.manualPrizePool !== null || breakdown.net > 0 ? (
        <>
          <div className="space-y-1">
            <PoolLine label={`Buy-ins (${paidBuyIns} × ${amount(tournament.buyInAmount)})`} value={formatMoney(gross.buyIn)} testId="buyins-total" />
            {counts.freeEntries > 0 ? (
              <PoolLine
                label={`Free entries (${counts.freeEntries})`}
                note={freeEntriesNote(counts.freeEntries, counts.fundedFreeEntries)}
                value={formatMoney(0)}
                testId="free-entries"
              />
            ) : null}
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
            <DifferenceRows lines={lines} />
          </div>

          <div className="border-t-2 border-primary pt-3">
            <PoolLine
              label={recalculated ? "Net Prize Pool (recalculated)" : "Net Prize Pool"}
              value={formatMoney(breakdown.net)}
              testId="net-prize-pool"
              tone="result"
            />
            <LeftoverNote lines={lines} />
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

          {/* Round 11: every counted buy-in (a free entry's too) pays a bounty, never into the pool. */}
          {hasBounty(tournament) ? (
            <p className="text-sm text-muted-foreground" data-testid="bounties-line">
              Bounties: {counts.buyIns} × {formatMoney(bountyCents(tournament))} = {formatMoney(counts.buyIns * bountyCents(tournament))} — not in the prize pool,
              collected on knockouts
            </p>
          ) : null}

          {pots.map((standing) => (
            <HighHandPotLines
              key={standing.pot.highHandId}
              standing={standing}
              settings={settings.find((highHand) => highHand.id === standing.pot.highHandId)}
              named={breakdown.highHands.length > 1}
              rakeLabel={rakeLabel}
            />
          ))}
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

interface HighHandPotLinesProps {
  standing: HighHandStanding;
  settings: HighHandSettings | undefined;
  /** The game runs more than one high hand (round 10): each block says whose pot it is. */
  named: boolean;
  rakeLabel: string;
}

/** One high hand's pot, apart from the prize pool: its entries, its AP, what its winners share and where its awards stand. */
function HighHandPotLines({ standing, settings, named, rakeLabel }: HighHandPotLinesProps) {
  const { pot } = standing;
  const label = named ? highHandLabel(pot.name) : "High Hand";
  const suffix = named ? `-${pot.highHandId}` : "";
  const rateShown = (settings?.rakeType === "percentage" || settings?.rakeType === "fixed") && pot.rake > 0;
  return (
    <div className="border-t border-border pt-3" data-testid={`high-hand-pot${suffix}`}>
      <PoolLine label={`${label} ${named ? "entries" : "Entries"} (${pot.entrants} × ${formatMoney(pot.feeCents, { forceCents: true })})`} value={formatMoney(pot.gross)} />
      {rateShown ? (
        <PoolLine label={`${label} ${rakeLabel} (${rateText(settings?.rakeType, settings?.rakeAmount, true)})`} value={`-${formatMoney(pot.rake)}`} tone="deduction" />
      ) : null}
      <PoolLine label={named ? `Net ${label} pot` : "Net High Hand Pool"} value={formatMoney(pot.net)} testId={`high-hand-net${suffix}`} tone="accent" />
      {pot.winners > 1 || standing.awards.length > 0 ? <HighHandAwards standing={standing} testIdSuffix={suffix} /> : null}
    </div>
  );
}
