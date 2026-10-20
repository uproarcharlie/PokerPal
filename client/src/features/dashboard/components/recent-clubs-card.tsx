import { useId } from "react";
import { Link } from "wouter";
import { ChevronRight, Users } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { routes } from "@/app/routes";
import { ClubLogo } from "@/components/image/club-logo";
import { EmptyState } from "@/components/shared/query-state";
import { figureOf, FigureValue } from "@/components/shared/query-figure";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MemberCountsResponse } from "@shared/api/clubs";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemberCounts } from "@/features/clubs/hooks";
import { useTournaments } from "@/features/tournaments/hooks";
import { newestClubs } from "../scope";
import { plural } from "@/lib/format";

/** One club: its member count, and its tournaments counted from that club's own list (PERF-09). */
function ClubRow({ club, members }: { club: ClubDto; members: UseQueryResult<MemberCountsResponse> }) {
  const tournaments = useTournaments({ clubId: club.id });
  return (
    <li>
      <Link
        href={routes.clubDetails(club.id)}
        data-testid={`club-card-${club.id}`}
        className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ClubLogo name={club.name} imageUrl={club.imageUrl} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{club.name}</span>
          <span className="block text-sm text-muted-foreground">
            <FigureValue figure={figureOf(members, (counts) => plural(counts[club.id] ?? 0, "member"))} loadingClassName="h-3 w-16" />
            {" • "}
            <FigureValue figure={figureOf(tournaments, (list) => plural(list.length, "tournament"))} loadingClassName="h-3 w-20" />
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** The viewer's newest clubs, each with its member and tournament counts, each a link to the club. */
export function RecentClubsCard({ clubs }: { clubs: readonly ClubDto[] }) {
  const headingId = useId();
  const memberCounts = useMemberCounts();

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b border-border">
          <CardTitle id={headingId} className="text-xl">
            Recent Clubs
          </CardTitle>
          <Button variant="link" size="sm" className="h-auto min-h-10 whitespace-normal" asChild>
            <Link href={routes.clubs()}>View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          {clubs.length === 0 ? (
            <EmptyState
              className="border-0"
              icon={<Users className="h-8 w-8" />}
              title="No clubs found"
              description="Create your first club to organize tournaments"
            />
          ) : (
            <ul role="list" className="space-y-2">
              {newestClubs(clubs, 3).map((club) => (
                <ClubRow key={club.id} club={club} members={memberCounts} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
