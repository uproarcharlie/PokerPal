import { useId } from "react";
import { Link } from "wouter";
import { Eye, Plus, Trophy } from "lucide-react";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { routes } from "@/app/routes";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clubColumn, ManageLink, playersColumn, startColumn, statusColumn } from "@/features/tournaments/components/list/tournament-columns";
import { useActiveTournaments, useScopedSeasons } from "../hooks";
import { activeTournaments } from "../scope";

interface ActiveTournamentsCardProps {
  /** The clubs the viewer runs. */
  clubs: readonly ClubDto[];
  /** Whose seasons name the tournaments' seasons (scope.ts `seasonScope`). */
  seasonClubIds: readonly string[] | undefined;
  onCreate: () => void;
}

function columnsFor(clubs: readonly ClubDto[], seasons: readonly PublicSeason[] | undefined): ResponsiveColumn<TournamentListItemDto>[] {
  const clubOf = (tournament: TournamentListItemDto) => clubs.find((club) => club.id === tournament.clubId);
  // While the seasons load, a tournament's season line waits rather than saying "Unknown".
  const seasonName = (tournament: TournamentListItemDto) => {
    if (!tournament.seasonId) return "No Season";
    if (!seasons) return null;
    return seasons.find((season) => season.id === tournament.seasonId)?.name ?? "Unknown";
  };

  // The tournaments page's own columns (P3REV5-CQ-06), with each one's season under its name.
  return [
    {
      id: "tournament",
      header: "Tournament",
      phone: "title",
      cell: (tournament) => (
        <div className="text-left">
          <p className="font-medium text-foreground">{tournament.name}</p>
          {seasonName(tournament) !== null ? (
            <p className="text-sm font-normal text-muted-foreground">Season: {seasonName(tournament)}</p>
          ) : null}
        </div>
      ),
    },
    clubColumn(clubOf),
    statusColumn,
    playersColumn,
    startColumn(clubOf),
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      phone: "actions",
      className: "text-right",
      cell: (tournament) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ManageLink tournament={tournament} />
          <Button variant="ghost" asChild>
            <Link
              href={routes.publicTournament(tournament.id)}
              data-testid={`public-view-tournament-${tournament.id}`}
              aria-label={`Public view of ${tournament.name}`}
            >
              <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
              Public View
            </Link>
          </Button>
        </div>
      ),
    },
  ];
}

/** The running and open tournaments of the viewer's clubs, with their way in for staff and for players. */
export function ActiveTournamentsCard({ clubs, seasonClubIds, onCreate }: ActiveTournamentsCardProps) {
  const headingId = useId();
  const tournaments = useActiveTournaments();
  const seasons = useScopedSeasons(seasonClubIds);

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle id={headingId} className="text-xl">
            Active Tournaments
          </CardTitle>
          <CardDescription>Currently running and upcoming events</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-0">
          <QueryState query={tournaments} errorTitle="Tournaments could not be loaded" loading={<LoadingRows className="md:p-6" />}>
            {(list) => {
              const active = activeTournaments(list, clubs);
              if (active.length === 0) {
                return (
                  <EmptyState
                    className="border-0"
                    icon={<Trophy className="h-10 w-10" />}
                    title="No Active Tournaments"
                    description="Create your first tournament to get started with managing poker events."
                    action={
                      <Button onClick={onCreate} data-testid="create-first-tournament">
                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                        Create Tournament
                      </Button>
                    }
                  />
                );
              }
              return (
                <ResponsiveTable
                  rows={active}
                  columns={columnsFor(clubs, seasons.data)}
                  rowKey={(tournament) => tournament.id}
                  caption="Active tournaments"
                />
              );
            }}
          </QueryState>
        </CardContent>
      </Card>
    </section>
  );
}
