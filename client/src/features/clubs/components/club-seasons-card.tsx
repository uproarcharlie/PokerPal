import { Link } from "wouter";
import { Calendar, ChartLine } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PublicSeason } from "@shared/api/public";
import { routes } from "@/app/routes";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { seasonDates } from "@/lib/season-dates";
import { ActiveSeasonBadge } from "@/features/seasons/components/active-season-badge";

interface ClubSeasonsCardProps {
  seasons: UseQueryResult<PublicSeason[]>;
  /** Where the club's staff make the first one; nobody else is offered it. */
  createHref: string | undefined;
}

/** The club's seasons, each with a link to its leaderboard. */
export function ClubSeasonsCard({ seasons, createHref }: ClubSeasonsCardProps) {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-xl">
          <Calendar className="h-5 w-5 text-accent" aria-hidden="true" />
          Seasons
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <QueryState
          query={seasons}
          errorTitle="The club's seasons could not be loaded"
          empty={
            <EmptyState
              icon={<Calendar className="h-12 w-12" />}
              title="No seasons yet"
              action={
                createHref ? (
                  <Button asChild variant="outline">
                    <Link href={createHref}>Create First Season</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {(list) => (
            <ul role="list" className="space-y-3">
              {list.map((season) => (
                <li key={season.id} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">{season.name}</p>
                    {season.isActive ? <ActiveSeasonBadge label="Active" /> : null}
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">{seasonDates(season)}</p>
                  <Button asChild variant="outline" className="w-full">
                    <Link href={routes.leaderboards(season.id)}>
                      <ChartLine className="mr-2 h-4 w-4" aria-hidden="true" />
                      View Leaderboard
                      <span className="sr-only"> for {season.name}</span>
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
