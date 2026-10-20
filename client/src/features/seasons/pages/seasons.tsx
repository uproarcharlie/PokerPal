import { Calendar } from "lucide-react";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import { usePageMeta } from "@/app/page-meta";
import { routes, STAFF_HOME } from "@/app/routes";
import { CardGridSkeleton } from "@/components/shared/card-grid-skeleton";
import { CreateButton } from "@/components/shared/create-button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { figureOf } from "@/components/shared/query-figure";
import { useCreateFromLink } from "@/hooks/use-create-from-link";
import { CreateSeasonDialog } from "../components/create-season-dialog";
import { SeasonCard } from "../components/season-card";
import { useClubs } from "@/features/clubs/hooks";
import { useTournamentCounts } from "@/features/tournaments/hooks";
import { useSeasons } from "../hooks";

const GRID = "md:grid-cols-2 xl:grid-cols-3";
const SeasonGridSkeleton = () => <CardGridSkeleton label="Loading seasons" className={GRID} />;

interface SeasonGridProps {
  seasons: readonly PublicSeason[];
  clubs: readonly ClubDto[];
  /** Tournaments per season, by season id, once counted. */
  tournamentCounts: { data: Readonly<Record<string, number>> | undefined; isError: boolean };
}

function SeasonGrid({ seasons, clubs, tournamentCounts }: SeasonGridProps) {
  const clubsById = new Map(clubs.map((club) => [club.id, club]));
  return (
    <ul role="list" aria-label="Seasons" className={`grid grid-cols-1 gap-6 ${GRID}`}>
      {seasons.map((season) => (
        <li key={season.id} className="flex">
          <SeasonCard
            season={season}
            club={clubsById.get(season.clubId)}
            tournamentCount={figureOf(tournamentCounts, (counts) => counts[season.id] ?? 0)}
          />
        </li>
      ))}
    </ul>
  );
}

export default function SeasonsPage() {
  usePageMeta({ title: "Seasons" });
  const create = useCreateFromLink(routes.seasons());
  const seasons = useSeasons();
  const clubs = useClubs();
  const counts = useTournamentCounts();
  const tournamentCounts = { data: counts.data?.seasons, isError: counts.isError };
  // Seasons can only be added to clubs the viewer runs (every club, for an admin).
  const manageableClubs = (clubs.data ?? []).filter((club) => club.viewer.canManage);

  const createButton = (label: string, testId: string) => (
    <CreateButton label={label} testId={testId} onClick={() => create.setOpen(true)} disabled={!clubs.data} />
  );

  return (
    <>
      <PageHeader
        title="Season Management"
        description="Manage tournament seasons and track player progress"
        back={STAFF_HOME}
        actions={createButton("Create New Season", "create-season-button")}
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <QueryState
          query={seasons}
          loading={<SeasonGridSkeleton />}
          errorTitle="Seasons could not be loaded"
          empty={
            <EmptyState
              icon={<Calendar className="h-12 w-12" />}
              title="No Seasons Found"
              description="Create seasons to organize your tournaments over time and track player leaderboards across multiple events."
              action={createButton("Create Your First Season", "create-first-season")}
            />
          }
        >
          {(list) => (
            <QueryState query={clubs} loading={<SeasonGridSkeleton />} errorTitle="Clubs could not be loaded">
              {(clubList) => <SeasonGrid seasons={list} clubs={clubList} tournamentCounts={tournamentCounts} />}
            </QueryState>
          )}
        </QueryState>
      </div>
      {/* The form starts from the viewer's clubs, so it opens once they are known. */}
      <CreateSeasonDialog
        open={create.open && clubs.data !== undefined}
        onOpenChange={create.setOpen}
        clubs={manageableClubs}
        clubId={create.clubId}
      />
    </>
  );
}
