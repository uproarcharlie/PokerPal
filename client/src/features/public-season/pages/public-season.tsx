import { useParams } from "wouter";
import { usePageMeta } from "@/app/page-meta";
import { LiveStatus } from "@/components/shared/live-status";
import { PageSpinner } from "@/components/shared/page-spinner";
import { PublicFooter } from "@/components/shared/public-footer";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { qk } from "@/lib/api/query-keys";
import type { PublicSeasonLeaderboardDto } from "@shared/api/live-display";
import { PUBLIC_SEASON_REFRESH_MS } from "../api";
import { SeasonHeader } from "../components/public/season-header";
import { SeasonStandings } from "../components/public/season-standings";
import { usePublicSeasonLeaderboard } from "../hooks";

function SeasonPage({ data }: { data: PublicSeasonLeaderboardDto }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SeasonHeader data={data} />
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-8">
        <LiveStatus follows={[{ queryKey: qk.seasons.publicLeaderboard(data.season.id), interval: PUBLIC_SEASON_REFRESH_MS }]} className="mb-4" />
        <SeasonStandings entries={data.entries} seasonName={data.season.name} />
      </div>
      <PublicFooter club={data.club} />
    </div>
  );
}

/**
 * A season's leaderboard for players (/season/:seasonId), where the TV clock's QR code leads: who leads
 * the season the tournament counts towards, followed while the page is open.
 */
export default function PublicSeasonPage() {
  const { seasonId = "" } = useParams<{ seasonId: string }>();
  const leaderboard = usePublicSeasonLeaderboard(seasonId);
  // Names players: kept out of search engines like the other player pages.
  usePageMeta({ title: leaderboard.data ? `${leaderboard.data.season.name} leaderboard` : "Season leaderboard", noindex: true });

  return (
    <QueryState
      query={leaderboard}
      loading={<PageSpinner label="Loading the leaderboard" className="min-h-dvh" />}
      notFound={<EmptyState title="Season not found" description="This season's leaderboard has moved or no longer exists." />}
      errorTitle="The leaderboard could not be loaded"
      stateClassName="mx-auto min-h-dvh max-w-md bg-background px-4 py-12"
    >
      {(data) => <SeasonPage data={data} />}
    </QueryState>
  );
}
