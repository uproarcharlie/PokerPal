import { useState } from "react";
import { Plus } from "lucide-react";
import { usePageMeta } from "@/app/page-meta";
import { CreateTournamentDialog } from "@/features/tournaments/components/create-tournament-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingRows, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { ActiveTournamentsCard } from "../components/active-tournaments-card";
import { RecentClubsCard } from "../components/recent-clubs-card";
import { SeasonLeaderboardCard } from "../components/season-leaderboard-card";
import { StatCards } from "../components/stat-cards";
import { useClubs } from "@/features/clubs/hooks";
import { useDashboardStats } from "../hooks";
import { runByViewer, seasonScope } from "../scope";

/** The staff home: totals, running tournaments, newest clubs and the season's leaders, for the clubs the viewer runs. */
export default function DashboardPage() {
  usePageMeta({ title: "Dashboard" });
  const [creating, setCreating] = useState(false);
  const stats = useDashboardStats();
  const clubs = useClubs();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Where Poker Communities Thrive"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} data-testid="create-tournament-button">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New Tournament
          </Button>
        }
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <StatCards query={stats} />
        <QueryState query={clubs} errorTitle="Your clubs could not be loaded" loading={<LoadingRows rows={6} />}>
          {(list) => {
            const yours = runByViewer(list);
            const seasonClubIds = seasonScope(yours, list);
            return (
              <>
                <ActiveTournamentsCard clubs={yours} seasonClubIds={seasonClubIds} onCreate={() => setCreating(true)} />
                {/* Its cards may shrink to the screen: without min-w-0 their headers' and rows' width set the
                    column's, and the page scrolled sideways at 320 px (MA-P3REV1-06). */}
                <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0" data-testid="dashboard-cards">
                  <RecentClubsCard clubs={yours} />
                  <SeasonLeaderboardCard clubs={yours} seasonClubIds={seasonClubIds} />
                </div>
              </>
            );
          }}
        </QueryState>
      </div>
      <CreateTournamentDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
