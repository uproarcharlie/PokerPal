import { useId } from "react";
import { Link } from "wouter";
import { ChartLine } from "lucide-react";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import { routes } from "@/app/routes";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { RankBadge } from "@/features/seasons/components/rank-badge";
import { useSeasonLeaderboard } from "@/features/seasons/hooks";
import { useScopedSeasons } from "../hooks";
import { currentSeason } from "../scope";

const TOP = 5;

const chartIcon = <ChartLine className="h-8 w-8" />;

function TopFive({ season }: { season: PublicSeason }) {
  const leaderboard = useSeasonLeaderboard(season.id);
  return (
    <QueryState
      query={leaderboard}
      errorTitle="The leaderboard could not be loaded"
      empty={<EmptyState className="border-0" icon={chartIcon} title="No leaderboard data" description="Complete some tournaments to see rankings" />}
    >
      {(entries) => (
        <ol role="list" aria-label={`${season.name} top ${TOP}`} className="space-y-2">
          {entries.slice(0, TOP).map((entry) => (
            <li key={entry.player.id} className="flex items-center gap-3 rounded-lg p-2">
              <RankBadge rank={entry.rank} size="sm" labelled />
              <PlayerAvatar name={entry.player.name} imageUrl={entry.player.imageUrl} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{entry.player.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatNumber(entry.points)} pts</span>
            </li>
          ))}
        </ol>
      )}
    </QueryState>
  );
}

/** The top of the current season's leaderboard, for the latest active season of the viewer's clubs. */
export function SeasonLeaderboardCard({ clubs, seasonClubIds }: { clubs: readonly ClubDto[]; seasonClubIds: readonly string[] | undefined }) {
  const headingId = useId();
  const seasons = useScopedSeasons(seasonClubIds);
  const season = seasons.data ? currentSeason(seasons.data, clubs) : undefined;

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 border-b border-border">
          <div>
            <CardTitle id={headingId} className="text-xl">
              Season Leaderboard
            </CardTitle>
            <CardDescription>{season ? `${season.name} - Top ${TOP}` : `Current Season - Top ${TOP}`}</CardDescription>
          </div>
          <Button variant="link" size="sm" className="h-auto min-h-10 whitespace-normal" asChild>
            <Link href={routes.leaderboards(season?.id)}>Full leaderboard</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <QueryState query={seasons} errorTitle="Seasons could not be loaded">
            {() =>
              season ? (
                <TopFive season={season} />
              ) : (
                <EmptyState
                  className="border-0"
                  icon={chartIcon}
                  title="No active season"
                  description="Start a season to rank your players across tournaments."
                  action={
                    <Button variant="outline" size="sm" asChild>
                      <Link href={routes.seasons()}>Go to Seasons</Link>
                    </Button>
                  }
                />
              )
            }
          </QueryState>
        </CardContent>
      </Card>
    </section>
  );
}
