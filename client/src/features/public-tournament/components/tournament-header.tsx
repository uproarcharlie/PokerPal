import { Link } from "wouter";
import { Calendar, UserPlus } from "lucide-react";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { routes } from "@/app/routes";
import { ClubHeader } from "@/components/shared/club-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clubTimeZone, formatDay, formatTime } from "@/lib/format";

interface TournamentHeaderProps {
  tournament: TournamentDetailDto;
  club: ClubDto | undefined;
  season: PublicSeason | undefined;
}

/** The public page's band: the club (once loaded), the season, the tournament's name, start, status and sign-up. */
export function TournamentHeader({ tournament, club, season }: TournamentHeaderProps) {
  const zone = clubTimeZone(club);
  const signUpOpen = tournament.status === "registration" || tournament.status === "scheduled";
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          {club ? <ClubHeader club={club} align="start" logoSize="md" /> : <span aria-hidden="true" />}
          {season ? (
            <Badge variant="outline" className="px-3 py-1 text-xs md:text-sm">
              {season.name}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="mb-2 break-words text-2xl font-bold text-foreground md:text-3xl">{tournament.name}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground md:text-base">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              <span>{formatDay(tournament.startDateTime, zone)}</span>
              <span aria-hidden="true">•</span>
              <span>{formatTime(tournament.startDateTime, zone)}</span>
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <StatusBadge status={tournament.status} className="justify-center px-3 py-1 text-sm" />
            {signUpOpen ? (
              <Button size="lg" className="w-full sm:w-auto" asChild>
                <Link href={routes.publicRegister(tournament.id)}>
                  <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Register Now
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
