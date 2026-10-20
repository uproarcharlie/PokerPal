import { useId } from "react";
import { Link } from "wouter";
import { Trophy } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { routes } from "@/app/routes";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { byStartDesc } from "../tournament-lists";

/** How many of the club's tournaments the card lists. */
const SHOWN = 5;

interface RecentTournamentsCardProps {
  tournaments: UseQueryResult<TournamentListItemDto[]>;
  timeZone: string;
  /** Where the club's staff make the first one; nobody else is offered it. */
  createHref: string | undefined;
}

/** The club's latest tournaments, each opening its admin page. */
export function RecentTournamentsCard({ tournaments, timeZone, createHref }: RecentTournamentsCardProps) {
  const headingId = useId();
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle id={headingId} className="flex items-center gap-2 text-xl">
          <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
          Recent Tournaments
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <QueryState
          query={tournaments}
          errorTitle="The club's tournaments could not be loaded"
          empty={
            <EmptyState
              icon={<Trophy className="h-12 w-12" />}
              title="No tournaments yet"
              action={
                createHref ? (
                  <Button asChild variant="outline">
                    <Link href={createHref}>Create First Tournament</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {(list) => (
            <ul role="list" aria-labelledby={headingId} className="space-y-3">
              {[...list].sort(byStartDesc).slice(0, SHOWN).map((tournament) => (
                <li key={tournament.id}>
                  <Link
                    href={routes.tournamentAdmin(tournament.id)}
                    className="block rounded-lg border border-border p-3 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block font-semibold text-foreground">{tournament.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {formatDate(tournament.startDateTime, timeZone)}
                      <StatusBadge status={tournament.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
