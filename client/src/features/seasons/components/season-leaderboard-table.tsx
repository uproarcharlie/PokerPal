import { Trophy } from "lucide-react";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { formatNumber, ordinal, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isPodium } from "@/components/shared/podium";
import { RankBadge } from "./rank-badge";

/**
 * A season's standings on the public pages (the club page and a tournament's Standings tab): place
 * (ties share one), player, tournaments played and points. On a phone the tournaments count moves
 * under the player's name, so the points (what players look for) always fit beside them (MA-05).
 */
export function SeasonLeaderboardTable({ entries, seasonName }: { entries: readonly LeaderboardEntryDto[]; seasonName: string }) {
  return (
    <ScrollRegion label={`${seasonName} leaderboard`} className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{seasonName} leaderboard</caption>
        <thead>
          <tr className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
            <th scope="col" className="px-2 py-3 text-left font-semibold sm:px-4">
              Rank
            </th>
            <th scope="col" className="px-2 py-3 text-left font-semibold sm:px-4">
              Player
            </th>
            <th scope="col" className="hidden px-3 py-3 text-center font-semibold sm:table-cell sm:px-4">
              Tournaments
            </th>
            <th scope="col" className="px-2 py-3 text-right font-semibold sm:px-4">
              Points
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry) => {
            const podium = isPodium(entry.rank);
            return (
              <tr key={entry.player.id} className={cn("hover:bg-muted/20", podium && "bg-accent/5")} data-testid={`leaderboard-row-${entry.player.id}`}>
                <td className="px-2 py-3 sm:px-4">
                  <RankBadge rank={entry.rank} size="sm" />
                </td>
                <td className="px-2 py-3 sm:px-4">
                  <div className="flex items-center gap-3">
                    <PlayerAvatar name={entry.player.name} imageUrl={entry.player.imageUrl} size="md" />
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-foreground">{entry.player.name}</p>
                      <p className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground", !podium && "sm:hidden")}>
                        {podium ? (
                          <span className="flex items-center gap-1">
                            <Trophy className="h-3 w-3 text-accent" aria-hidden="true" />
                            {ordinal(entry.rank)} Place
                          </span>
                        ) : null}
                        <span className="sm:hidden">{plural(entry.tournaments, "tournament")}</span>
                      </p>
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-3 text-center sm:table-cell sm:px-4">
                  <span className="inline-flex min-w-[2rem] justify-center rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                    {entry.tournaments}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4">
                  <span className={cn("text-lg font-bold sm:text-xl", podium ? "text-accent-text" : "text-foreground")}>{formatNumber(entry.points)}</span>
                  <span className="ml-1 text-xs text-muted-foreground">pts</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
