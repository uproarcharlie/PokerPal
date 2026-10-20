import { useId } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChartLine, Trophy } from "lucide-react";
import type { PublicSeason } from "@shared/api/public";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { routes } from "@/app/routes";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActiveSeasonBadge } from "./active-season-badge";
import { LeaderboardList } from "./leaderboard-list";

interface SeasonLeaderboardProps {
  query: UseQueryResult<LeaderboardEntryDto[]>;
  /** The chosen season, when the seasons list has it. */
  season: PublicSeason | undefined;
  clubName: string;
}

/** The chosen season's leaderboard card: its name, club and player count over the ranked players. */
export function SeasonLeaderboard({ query, season, clubName }: SeasonLeaderboardProps) {
  const titleId = useId();
  return (
    <QueryState
      query={query}
      errorTitle="The leaderboard could not be loaded"
      notFound={
        <EmptyState
          icon={<ChartLine className="h-12 w-12" />}
          title="Season Not Found"
          description="That season no longer exists. Choose another one above."
        />
      }
    >
      {(entries) => (
        <Card role="region" aria-labelledby={titleId}>
          <CardHeader className="border-b border-border">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle id={titleId} className="flex items-center gap-2 text-xl sm:text-2xl">
                  <Trophy className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
                  Season Leaderboard
                </CardTitle>
                {season ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {clubName ? `${season.name} - ${clubName}` : season.name}
                    {season.isActive ? <ActiveSeasonBadge label="Active" className="ml-2" /> : null}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-bold text-foreground" data-testid="total-players">
                  {entries.length}
                </p>
                <p className="text-sm text-muted-foreground">Total Players</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6">
            {entries.length === 0 ? (
              <EmptyState
                className="border-0"
                icon={<ChartLine className="h-12 w-12" />}
                title="No Leaderboard Data"
                description="Complete some tournaments in this season to see player rankings."
                action={
                  <Button asChild>
                    <Link href={routes.tournaments()}>View Tournaments</Link>
                  </Button>
                }
              />
            ) : (
              <LeaderboardList entries={entries} />
            )}
          </CardContent>
        </Card>
      )}
    </QueryState>
  );
}
