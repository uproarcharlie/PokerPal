import { Link, useLocation, useSearch } from "wouter";
import { ChartLine, Download } from "lucide-react";
import { usePageMeta } from "@/app/page-meta";
import { routes, STAFF_HOME } from "@/app/routes";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { SeasonLeaderboard } from "../components/season-leaderboard";
import { SeasonPicker } from "../components/season-picker";
import { useClubs } from "@/features/clubs/hooks";
import { useSeasonLeaderboard, useSeasons } from "../hooks";
import { downloadCsv, leaderboardCsv, leaderboardFileName } from "../leaderboard-csv";

/** Season leaderboards. The season shown is the one in the address (`?season=`), so it can be linked to. */
export default function LeaderboardsPage() {
  usePageMeta({ title: "Leaderboards" });
  const [, navigate] = useLocation();
  const seasonId = new URLSearchParams(useSearch()).get("season") || undefined;
  const seasons = useSeasons();
  const clubs = useClubs();
  const leaderboard = useSeasonLeaderboard(seasonId);

  const selected = seasons.data?.find((season) => season.id === seasonId);
  const clubName = (clubId: string) => (clubs.data ? (clubs.data.find((club) => club.id === clubId)?.name ?? "Unknown Club") : "");
  const entries = leaderboard.data;

  const exportCsv = () => {
    if (entries) downloadCsv(leaderboardFileName(selected?.name ?? "season"), leaderboardCsv(entries));
  };

  return (
    <>
      <PageHeader
        title="Leaderboards"
        description="Track player rankings and tournament performance"
        back={STAFF_HOME}
        actions={
          <>
            <SeasonPicker
              seasons={seasons.data ?? []}
              clubName={clubName}
              value={selected?.id}
              onChange={(id) => navigate(routes.leaderboards(id), { replace: true })}
              disabled={!seasons.data}
            />
            <Button variant="outline" size="sm" disabled={!entries?.length} onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Export
            </Button>
          </>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <QueryState
          query={seasons}
          errorTitle="Seasons could not be loaded"
          empty={
            <EmptyState
              icon={<ChartLine className="h-12 w-12" />}
              title="No Seasons Available"
              description="Create seasons and tournaments to start tracking player leaderboards and rankings."
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Button asChild variant="outline">
                    <Link href={routes.clubs()}>Create Club</Link>
                  </Button>
                  <Button asChild>
                    <Link href={routes.seasons()}>Create Season</Link>
                  </Button>
                </div>
              }
            />
          }
        >
          {() =>
            seasonId ? (
              <SeasonLeaderboard query={leaderboard} season={selected} clubName={selected ? clubName(selected.clubId) : ""} />
            ) : (
              <EmptyState
                icon={<ChartLine className="h-12 w-12" />}
                title="Select a Season"
                description="Choose a season from the dropdown above to view its leaderboard and player rankings."
              />
            )
          }
        </QueryState>
      </div>
    </>
  );
}
