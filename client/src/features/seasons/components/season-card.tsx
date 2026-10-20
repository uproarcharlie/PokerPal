import { Link } from "wouter";
import { Settings as SettingsIcon, Trophy } from "lucide-react";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import { routes } from "@/app/routes";
import { ClubLogo } from "@/components/image/club-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FigureValue, type QueryFigure } from "@/components/shared/query-figure";
import { formatSeasonDate, seasonEndDate } from "@/lib/season-dates";
import { ActiveSeasonBadge } from "./active-season-badge";

interface SeasonCardProps {
  season: PublicSeason;
  /** The season's club; undefined when the clubs list no longer has it. */
  club: ClubDto | undefined;
  /** How many tournaments the season has, as far as it is known. */
  tournamentCount: QueryFigure;
}

/** One season on the Seasons page: its club, dates and tournament count, with links to its leaderboard and settings. */
export function SeasonCard({ season, club, tournamentCount }: SeasonCardProps) {
  const clubName = club?.name ?? "Unknown Club";
  return (
    <Card className="flex w-full flex-col" data-testid={`season-card-${season.id}`}>
      <CardHeader className="pb-4">
        <div className="flex items-start gap-4">
          <ClubLogo name={clubName} imageUrl={club?.imageUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <CardTitle className="break-words text-lg">{season.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{clubName}</p>
            {season.isActive ? <ActiveSeasonBadge className="mt-2" /> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col">
        <dl className="mb-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Start Date</dt>
            <dd className="font-semibold text-foreground">{formatSeasonDate(season.startDate)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">End Date</dt>
            <dd className="font-semibold text-foreground">{seasonEndDate(season) === null ? "Ongoing" : formatSeasonDate(seasonEndDate(season))}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Tournaments</dt>
            <dd className="font-semibold text-foreground">
              <FigureValue figure={tournamentCount} loadingClassName="h-4 w-6" />
            </dd>
          </div>
        </dl>

        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <Button asChild variant="outline" size="sm" className="w-full justify-start">
            <Link href={routes.leaderboards(season.id)} data-testid={`view-leaderboard-${season.id}`}>
              <Trophy className="mr-2 h-4 w-4" aria-hidden="true" />
              View Leaderboard
            </Link>
          </Button>
          {club?.viewer.canManage ? (
            <Button asChild variant="outline" size="sm" className="w-full justify-start">
              <Link href={routes.seasonSettings(season.id)} data-testid={`settings-season-${season.id}`}>
                <SettingsIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                Settings
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
