import { Target, Trophy } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import { toCents } from "@shared/domain/money";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { EmptyState } from "@/components/shared/query-state";
import { MoneyText } from "@/components/shared/money-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { PlaceBadge, StandingStatus } from "@/components/shared/podium";
import { cn } from "@/lib/utils";
import { standingsFor } from "@shared/domain/standings";
import { formatNumber, plural } from "@/lib/format";

const CELL = "px-2 py-3 sm:px-4";
const HEAD = cn(CELL, "text-xs font-semibold uppercase text-muted-foreground");
/**
 * The columns a phone has no room for (they pushed Knockouts off a 375 px screen): from `md` up only.
 * On a phone what they say sits under the player's name instead, so only Place, Player and Prize take
 * the width, as in the season leaderboard (MA-05).
 */
const WIDE = "hidden md:table-cell";
const BADGE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground";

interface StandingsTableProps {
  registrations: readonly PublicRegistration[];
  completed: boolean;
  trackPoints: boolean;
}

/** Everyone in the tournament: who is still in, who went out in what place, knockouts, points and prizes. */
export function StandingsTable({ registrations, completed, trackPoints }: StandingsTableProps) {
  if (registrations.length === 0) {
    return <EmptyState icon={<Trophy className="h-10 w-10" />} title="No players registered yet" />;
  }
  const standings = standingsFor(registrations, completed);
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
          <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
          {completed ? "Final Results" : "Current Standings"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollRegion label={completed ? "Final results" : "Current standings"} className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className={cn(HEAD, "text-left")}>Place</th>
                <th className={cn(HEAD, "text-left")}>Player</th>
                <th className={cn(HEAD, WIDE, "text-left")}>Status</th>
                <th className={cn(HEAD, WIDE, "text-center")}>Knockouts</th>
                {trackPoints ? <th className={cn(HEAD, WIDE, "text-right")}>Points</th> : null}
                <th className={cn(HEAD, "text-right")}>Prize</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {standings.map((standing) => {
                const { registration } = standing;
                const name = registration.player?.name ?? "Unknown Player";
                const knockouts = registration.knockouts ?? 0;
                const points = registration.pointsAwarded ?? 0;
                const status = <StandingStatus place={standing.place} eliminated={registration.isEliminated === true} completed={completed} />;
                return (
                  <tr key={registration.id}>
                    <td className={CELL}>
                      <PlaceBadge place={standing.place} finished={completed} />
                    </td>
                    <td className={CELL}>
                      <span className="flex items-center gap-3" data-testid={`standing-player-${registration.id}`}>
                        <PlayerAvatar name={name} imageUrl={registration.player?.imageUrl} size="sm" />
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block break-words font-semibold",
                              registration.isEliminated && !completed ? "text-muted-foreground" : "text-foreground",
                            )}
                          >
                            {name}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 md:hidden" data-testid="standing-summary">
                            {status}
                            {knockouts > 0 ? (
                              <span className={BADGE}>
                                <Target className="h-3 w-3" aria-hidden="true" />
                                {plural(knockouts, "knockout")}
                              </span>
                            ) : null}
                            {trackPoints && (completed || points > 0) ? <span className={BADGE}>{formatNumber(points)} pts</span> : null}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={cn(CELL, WIDE, "whitespace-nowrap")}>{status}</td>
                    <td className={cn(CELL, WIDE, "text-center")}>
                      <span className="inline-flex items-center gap-1 text-sm text-foreground">
                        <Target className="h-4 w-4" aria-hidden="true" />
                        {knockouts}
                      </span>
                    </td>
                    {trackPoints ? <td className={cn(CELL, WIDE, "text-right font-semibold text-foreground")}>{formatNumber(points)}</td> : null}
                    <td className={cn(CELL, "text-right")}>
                      {toCents(registration.prizeAmount) > 0 ? (
                        <MoneyText amount={registration.prizeAmount} className="font-bold text-accent-text" />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      </CardContent>
    </Card>
  );
}
