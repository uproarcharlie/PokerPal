import { useState } from "react";
import { Users } from "lucide-react";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import type { TournamentCountsDto } from "@shared/api/tournaments";
import type { MemberCountsResponse } from "@shared/api/clubs";
import { usePageMeta } from "@/app/page-meta";
import { STAFF_HOME } from "@/app/routes";
import { CardGridSkeleton } from "@/components/shared/card-grid-skeleton";
import { CreateButton } from "@/components/shared/create-button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { ClubCard, type ClubCardStats } from "../components/club-card";
import { CreateClubDialog } from "../components/create-club-dialog";
import { figureOf } from "@/components/shared/query-figure";
import { useSeasons } from "@/features/seasons/hooks";
import { useTournamentCounts } from "@/features/tournaments/hooks";
import { useClubs, useMemberCounts } from "../hooks";

interface Loaded<T> {
  data: T | undefined;
  isError: boolean;
}

function clubStats(
  club: ClubDto,
  tournaments: Loaded<TournamentCountsDto>,
  seasons: Loaded<PublicSeason[]>,
  members: Loaded<MemberCountsResponse>,
): ClubCardStats {
  return {
    members: figureOf(members, (counts) => counts[club.id] ?? 0),
    activeTournaments: figureOf(tournaments, (counts) => counts.clubs[club.id]?.active ?? 0),
    totalTournaments: figureOf(tournaments, (counts) => counts.clubs[club.id]?.total ?? 0),
    activeSeason: figureOf(seasons, (list) => list.find((season) => season.clubId === club.id && season.isActive)?.name ?? "None"),
  };
}

export default function ClubsPage() {
  usePageMeta({ title: "Clubs" });
  const [creating, setCreating] = useState(false);
  const clubs = useClubs();
  const tournaments = useTournamentCounts();
  const seasons = useSeasons();
  const memberCounts = useMemberCounts({ enabled: (clubs.data?.length ?? 0) > 0 });

  const createButton = (label: string, testId: string) => <CreateButton label={label} testId={testId} onClick={() => setCreating(true)} />;

  return (
    <>
      <PageHeader
        title="Club Management"
        description="Manage your poker clubs and settings"
        back={STAFF_HOME}
        actions={createButton("Create New Club", "create-club-button")}
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <QueryState
          query={clubs}
          errorTitle="Your clubs could not be loaded"
          loading={<CardGridSkeleton label="Loading clubs" />}
          empty={
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title="No Clubs Found"
              description="Get started by creating your first poker club. Clubs help you organize tournaments and manage your poker community."
              action={createButton("Create Your First Club", "create-first-club")}
            />
          }
        >
          {(list) => (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {list.map((club) => (
                <ClubCard key={club.id} club={club} stats={clubStats(club, tournaments, seasons, memberCounts)} />
              ))}
            </div>
          )}
        </QueryState>
      </div>
      <CreateClubDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
