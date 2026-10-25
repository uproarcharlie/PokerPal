import { Badge } from "@/components/ui/badge";
import { ClubHeader } from "@/components/shared/club-header";
import { ActiveSeasonBadge } from "@/features/seasons/components/active-season-badge";
import { plural } from "@/lib/format";
import { seasonDates, seasonEndDate } from "@/lib/season-dates";
import type { PublicSeasonLeaderboardDto } from "@shared/api/live-display";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the season is still being played as of `now`: marked active and its last day (a calendar
 * day, stored as midnight UTC) not yet over.
 */
export function isRunning(season: PublicSeasonLeaderboardDto["season"], now: number): boolean {
  const end = seasonEndDate(season);
  return season.isActive && (end === null || now < Date.parse(end) + DAY_MS);
}

/** "After 5 of 12 tournaments": how far through the season the standings are. */
export function progressText({ completed, total }: PublicSeasonLeaderboardDto["tournaments"]): string {
  if (total === 0) return "No tournaments yet";
  return `After ${completed} of ${plural(total, "tournament")}`;
}

/** The season page's band: the club, the season's name, dates and progress, and whether the standings are final. */
export function SeasonHeader({ data }: { data: PublicSeasonLeaderboardDto }) {
  const { season, club, tournaments } = data;
  // The server's clock, not the phone's: the badge reads the same on every screen.
  const running = isRunning(season, Date.parse(data.generatedAt));
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-8">
        <ClubHeader club={club} caption="Season leaderboard" align="start" logoSize="md" className="mb-6" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-foreground md:text-3xl">{season.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{seasonDates(season)}</p>
            <p className="text-sm text-muted-foreground" data-testid="season-progress">
              {progressText(tournaments)}
            </p>
          </div>
          {running ? (
            <ActiveSeasonBadge label="Active" className="px-3 py-1 text-sm" />
          ) : (
            <Badge variant="outline" className="px-3 py-1 text-sm">
              Final standings
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
