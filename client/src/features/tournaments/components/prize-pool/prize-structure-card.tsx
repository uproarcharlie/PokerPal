import { Trophy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/shared/money-text";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { PlaceName } from "@/components/shared/podium";
import { formatMoney, ordinal } from "@/lib/format";
import { undistributedNote } from "@/lib/prize-pool";
import { cn } from "@/lib/utils";
import { EditPayoutsButton } from "@/features/prize-pool/components/payout-editor-sheet";
import { frozenSummary, liveSummary, PoolSummary } from "@/features/prize-pool/components/pool-summary";
import { usePrizePool } from "@/features/prize-pool/hooks";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { describeDeal } from "@shared/domain/deal";
import { DEFAULT_RAKE_LABEL, paidPercentage, type PayoutDisplay, type PayoutDisplayRow } from "@shared/domain/prize-pool";

interface PrizeStructureCardProps {
  display: PayoutDisplay;
  /**
   * The players in the field, paid or not. Places beyond the paid players are not paid while the game
   * runs (round 6), and the places listed are then one per paid player.
   */
  entrants: number;
  /** The high-hand entry fee, when the tournament has a high hand. */
  highHandAmount: string | null;
  /**
   * The tournament the payouts are for: its staff get "Edit payouts" while it is open, the card says
   * where any difference between the prizes and the money available went (round 5, item 16), and once
   * it is finalized with a deal the card says so.
   */
  tournament?: TournamentDetailDto;
}

/**
 * "Prize pool $1,000 · AP $200 · Kept by the club $50": live from the server's pool, or as finalize froze
 * it. The club's staff only (round 6): nobody else is sent the breakdown or the snapshot.
 */
function useSummary(display: PayoutDisplay, tournament: TournamentDetailDto | undefined) {
  const prizePool = usePrizePool(tournament?.id ?? "", { follow: tournament, enabled: tournament?.viewer.canManage === true });
  const snapshot = display.source === "snapshot" ? tournament?.prizePoolSnapshot : null;
  if (snapshot) return frozenSummary(snapshot.pool, prizePool.data?.rakeLabel ?? DEFAULT_RAKE_LABEL);
  if (display.source !== "live" || !prizePool.data) return null;
  return liveSummary(prizePool.data.breakdown, prizePool.data.rakeLabel, prizePool.data.carryTarget);
}

function cardDescription(source: PayoutDisplay["source"]): string {
  if (source === "live") return "Payout distribution for top finishers";
  if (source === "unrecorded") return "Prizes were not recorded for this tournament";
  if (source === "cancelled") return "Cancelled: no prizes are paid";
  return "What was paid out";
}

function noPayoutsText(source: PayoutDisplay["source"]): string {
  if (source === "unrecorded") return "This tournament's results were entered by hand, so what each place was paid was never recorded.";
  if (source === "cancelled") return "This tournament was cancelled, so no prizes are paid.";
  return "Prize pool will be calculated once players register";
}

/**
 * A paid place's share of the pool ("35%"), or "Deal" for a player a deal paid (its place's share is
 * not what it got); null when nothing is known (stored prizes, or a deal player below the paid places).
 */
function shareText(payout: PayoutDisplayRow, dealt: ReadonlySet<string>): string | null {
  if (payout.registrationId && dealt.has(payout.registrationId)) return "Deal";
  return payout.percentage ? `${payout.percentage}%` : null;
}

/** Under a top place's prize: its share of the pool, or that a deal paid it. */
function ShareNote({ payout, dealt }: { payout: PayoutDisplayRow; dealt: ReadonlySet<string> }) {
  const share = shareText(payout, dealt);
  if (!share) return null;
  return <p className="mt-1 text-xs text-muted-foreground">{share === "Deal" ? "Paid by the deal" : `${share} of prize pool`}</p>;
}

/** The places paid: the top three as cards, every place in a table, and what is left unpaid. */
export function PrizeStructureCard({ display, entrants, highHandAmount, tournament }: PrizeStructureCardProps) {
  const rows = display.rows;
  const paidShare = paidPercentage(rows);
  const undistributed = undistributedNote(display, { paid: display.rows.length, field: entrants }, tournament?.viewer.canManage ? "staff" : "room");
  const deal = display.source === "snapshot" ? tournament?.prizePoolSnapshot?.deal : undefined;
  const dealt = new Set(deal?.players.map((player) => player.registrationId) ?? []);
  const summary = useSummary(display, tournament);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 border-b border-border sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" aria-hidden="true" />
            Prize Structure
          </CardTitle>
          <p className="text-sm text-muted-foreground">{cardDescription(display.source)}</p>
          {summary ? <PoolSummary figures={summary} /> : null}
          {deal ? (
            <p className="text-sm text-foreground" data-testid="payout-deal">
              <Badge variant="secondary" className="mr-2">
                Deal
              </Badge>
              {describeDeal(deal)} ({deal.reason})
            </p>
          ) : null}
        </div>
        {tournament ? <EditPayoutsButton tournament={tournament} className="w-full sm:w-auto" /> : null}
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        {rows.length === 0 ? (
          <div className="py-8 text-center">
            <Trophy className="mx-auto mb-4 h-12 w-12 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground" data-testid="no-payouts">
              {noPayoutsText(display.source)}
            </p>
          </div>
        ) : (
          <>
            <ul role="list" className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Top places">
              {rows.slice(0, 3).map((payout, index) => (
                <li
                  key={payout.position}
                  className={cn(
                    "rounded-lg p-4",
                    index === 0 ? "border-2 border-accent bg-gradient-to-br from-accent/10 to-accent/5" : "border border-border bg-muted/30",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">{ordinal(payout.position)} Place</span>
                    <Trophy className={cn("h-5 w-5", index === 0 ? "text-accent" : "text-muted-foreground")} aria-hidden="true" />
                  </div>
                  <p className="text-3xl font-bold text-foreground tabular-nums" data-testid={`payout-${payout.position}`}>
                    {formatMoney(payout.amountCents)}
                  </p>
                  <ShareNote payout={payout} dealt={dealt} />
                </li>
              ))}
            </ul>

            {rows.length > 3 ? (
              <div className="border-t border-border pt-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground">Complete Payout Structure</h3>
                <ScrollRegion label="Every place paid" className="overflow-x-auto">
                  <table className="w-full">
                    <caption className="sr-only">Every place paid</caption>
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Position</th>
                        <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Percentage</th>
                        <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Prize</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((payout) => (
                        <tr key={payout.position} className="hover:bg-muted/20">
                          <td className="px-3 py-3 font-medium text-foreground">
                            <PlaceName place={payout.position} />
                          </td>
                          <td className="px-3 py-3 text-right text-sm text-muted-foreground">{shareText(payout, dealt) ?? "-"}</td>
                          <td className="px-3 py-3 text-right font-bold text-foreground">
                            <MoneyText cents={payout.amountCents} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border font-bold">
                        <th scope="row" className="px-3 py-3 text-left text-foreground">Total</th>
                        <td className="px-3 py-3 text-right text-muted-foreground">{paidShare !== null ? `${paidShare}%` : ""}</td>
                        <td className="px-3 py-3 text-right text-lg text-primary">
                          <MoneyText cents={display.totalCents} />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ScrollRegion>
              </div>
            ) : null}

            {undistributed ? (
              <Alert className="mt-4" data-testid="undistributed">
                <AlertDescription>{undistributed}</AlertDescription>
              </Alert>
            ) : null}

            {highHandAmount ? (
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <div>
                  <p className="text-sm font-medium text-foreground">High Hand Bonus</p>
                  <p className="text-xs text-muted-foreground">Entry fee for the high-hand pot</p>
                </div>
                <MoneyText amount={highHandAmount} className="text-xl font-bold text-accent-text" />
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
