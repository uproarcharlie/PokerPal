import { TrendingUp } from "lucide-react";
import type { PublicSeason } from "@shared/api/public";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSeasonLeaderboard } from "../hooks";
import { SeasonLeaderboardTable } from "./season-leaderboard-table";

interface SeasonLeaderboardCardProps {
  season: PublicSeason;
  /** The line under the title: the season's dates on the club page. */
  subtitle?: string;
}

/**
 * A season's leaderboard on the public pages (the club page's Standings tab, a tournament's Season
 * view), ranked by the server: tied players share a rank. Only the season shown is fetched.
 */
export function SeasonLeaderboardCard({ season, subtitle = "Season standings across all tournaments" }: SeasonLeaderboardCardProps) {
  const leaderboard = useSeasonLeaderboard(season.id);
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
          <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
          {season.name} Leaderboard
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="p-0">
        <QueryState
          query={leaderboard}
          loading={<LoadingRows className="p-4" />}
          errorTitle="The leaderboard could not be loaded"
          empty={
            <EmptyState
              className="m-4 border-0"
              icon={<TrendingUp className="h-10 w-10" />}
              title="No Leaderboard Data"
              description="Complete some tournaments in this season to see player rankings."
            />
          }
        >
          {(entries) => <SeasonLeaderboardTable entries={entries} seasonName={season.name} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}
