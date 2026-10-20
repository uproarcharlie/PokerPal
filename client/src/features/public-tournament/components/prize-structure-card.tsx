import { Lock, Trophy } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import type { PointsRules } from "@shared/domain/points";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { MoneyText } from "@/components/shared/money-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { FigureValue } from "@/components/shared/query-figure";
import { formatMoney, formatNumber, ordinal } from "@/lib/format";
import type { TournamentMoney } from "@/lib/prize-pool";
import { prizeTable } from "../standings";
import { PlaceName } from "@/components/shared/podium";
import { undistributedNote } from "@/lib/prize-pool";

/** The points rules once known, or where their requests stand. */
export type PointsRulesFigure = PointsRules | "loading" | "failed";

const NO_RULES: PointsRules = { trackPoints: false, pointsSystem: null, allocations: [] };

interface PrizeStructureCardProps {
  money: TournamentMoney;
  registrations: readonly PublicRegistration[];
  /** Whether points are shown: the tournament tracks them (`trackPoints`). */
  trackPoints: boolean;
  pointsRules: PointsRulesFigure;
  /** Asks for the points rules again, after they failed. */
  onRetryPoints: () => void;
  /** The TD has locked the pool: the amounts are final enough to show. */
  locked: boolean;
}

/** What each place pays (and scores), from the same shared functions finalize pays with. */
export function PrizeStructureCard({ money, registrations, trackPoints, pointsRules, onRetryPoints, locked }: PrizeStructureCardProps) {
  const { display, poolCents } = money;
  // Shown once the pool is locked, and always once the prizes have been paid.
  const revealed = locked || display.source !== "live";
  const cancelled = display.source === "cancelled";
  // Until the rules are known the table lists the paid places, each place's points a placeholder.
  const known = typeof pointsRules === "object";
  const table = prizeTable(display.rows, known ? pointsRules : NO_RULES);
  const showPoints = trackPoints;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center justify-between gap-2 text-lg sm:text-2xl">
          <span className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
            Prize Pool Structure
          </span>
          {revealed && !cancelled ? (
            <Badge variant="outline" className="text-xs">
              <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
              Locked
            </Badge>
          ) : null}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {display.source === "unrecorded" ? (
            <span data-testid="prizes-unrecorded">Prizes were not recorded for this tournament</span>
          ) : cancelled ? (
            <span data-testid="prizes-cancelled">Cancelled: no prizes are paid</span>
          ) : revealed ? (
            `Total prize pool: ${formatMoney(poolCents)}`
          ) : (
            <span className="inline-flex items-center gap-1">
              <Lock className="h-4 w-4" aria-hidden="true" />
              Prize pool will be revealed when locked
            </span>
          )}
        </p>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">
        <ScrollRegion label="Prize structure" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-3 text-left">Position</th>
                <th className="px-3 py-3 text-left">Player</th>
                <th className="px-3 py-3 text-right">Prize</th>
                {showPoints ? <th className="px-3 py-3 text-right">Points</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.rows.map(({ position, payout, points }) => {
                const finisher = registrations.find((registration) => registration.finalPosition === position);
                return (
                  <tr key={position}>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className="font-medium text-foreground">
                        <PlaceName place={position} suffix="Place" />
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {finisher?.player ? (
                        <span className="flex items-center gap-2">
                          <PlayerAvatar name={finisher.player.name} imageUrl={finisher.player.imageUrl} size="xs" />
                          <span className="font-medium text-foreground">{finisher.player.name}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-foreground">
                      {!payout ? <span className="font-normal text-muted-foreground">-</span> : revealed ? <MoneyText cents={payout.amountCents} /> : "TBD"}
                    </td>
                    {showPoints ? (
                      <td className="px-3 py-3 text-right">
                        {known ? (
                          <Badge variant="outline" className="whitespace-nowrap font-semibold" data-testid={`points-${position}`}>
                            {formatNumber(points)} pts
                          </Badge>
                        ) : (
                          <span data-testid={`points-${position}`}>
                            <FigureValue figure={pointsRules} loadingClassName="h-5 w-14" />
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {showPoints && known && table.others ? (
                <tr className="border-t-2 border-border bg-muted/20">
                  <td className="px-3 py-3">
                    <span className="font-medium text-muted-foreground">{ordinal(table.others.from)} place and below</span>
                    <span className="mt-1 block text-xs text-muted-foreground">All other finishers</span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">-</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">-</td>
                  <td className="px-3 py-3 text-right">
                    <Badge variant="secondary" className="whitespace-nowrap font-semibold" data-testid="points-others">
                      {formatNumber(table.others.points)} pts
                    </Badge>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </ScrollRegion>
        {showPoints && pointsRules === "failed" ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 px-3 pb-4 text-sm text-muted-foreground sm:px-0 sm:pb-0" role="status">
            <span data-testid="points-failed">The points for each place could not be loaded.</span>
            <Button variant="outline" size="sm" onClick={onRetryPoints}>
              Try again
            </Button>
          </div>
        ) : null}
        {revealed && undistributedNote(display, registrations.length) ? (
          <p className="mt-4 px-3 pb-4 text-sm text-muted-foreground sm:px-0 sm:pb-0" data-testid="undistributed">
            {undistributedNote(display, registrations.length)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
