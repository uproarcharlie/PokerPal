import { Award, Medal, Trophy } from "lucide-react";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { cn } from "@/lib/utils";
import { formatNumber, plural } from "@/lib/format";
import { isPodium } from "@/components/shared/podium";
import { RankBadge } from "./rank-badge";

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />;
  if (rank === 2) return <Medal className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  if (rank === 3) return <Award className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return null;
}

/**
 * The season's players, ranked by the server: tied players share a rank (1, 2, 2, 4) and are listed
 * by name. The top three are highlighted.
 */
export function LeaderboardList({ entries }: { entries: readonly LeaderboardEntryDto[] }) {
  return (
    <ol role="list" aria-label="Season leaderboard" className="space-y-3">
      {entries.map((entry, index) => {
        const topThree = isPodium(entry.rank);
        return (
          <li
            key={entry.player.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-accent/40 sm:gap-4 sm:p-4",
              topThree ? "border-accent/20 bg-accent/5" : "border-border",
            )}
            data-testid={`leaderboard-entry-${index + 1}`}
          >
            <RankBadge rank={entry.rank} labelled />
            <PlayerAvatar name={entry.player.name} imageUrl={entry.player.imageUrl} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <p className="min-w-0 break-words font-semibold text-foreground">{entry.player.name}</p>
                <RankIcon rank={entry.rank} />
              </div>
              <p className="text-sm text-muted-foreground">{plural(entry.tournaments, "tournament")}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-xl font-bold", topThree ? "text-accent-text" : "text-foreground")}>{formatNumber(entry.points)}</p>
              <p className="text-xs text-muted-foreground">points</p>
            </div>
            <div className="hidden shrink-0 text-right sm:block" aria-hidden="true">
              <p className={cn("text-xl font-bold", topThree ? "text-accent-text" : "text-foreground")}>{entry.tournaments}</p>
              <p className="text-xs text-muted-foreground">tournaments</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
