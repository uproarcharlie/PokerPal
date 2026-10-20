import { Link } from "wouter";
import { Calendar, Users } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { routes } from "@/app/routes";
import { ClubLogo } from "@/components/image/club-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clubTimeZone, formatDay } from "@/lib/format";

interface HomeTournamentCardProps {
  tournament: TournamentListItemDto;
  /** The club running it, when the page has it. */
  club: ClubDto | undefined;
}

/** An upcoming tournament on the club directory; the whole card opens the tournament's page. */
export function HomeTournamentCard({ tournament, club }: HomeTournamentCardProps) {
  return (
    <Card className="relative h-full transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary">
      <CardContent className="flex h-full flex-col p-4 sm:p-6">
        <h3 className="mb-2 break-words text-lg font-bold text-foreground">{tournament.name}</h3>
        {club ? (
          <p className="mb-2 flex items-center gap-2 text-sm text-foreground">
            <ClubLogo name={club.name} imageUrl={club.imageUrl} size="sm" />
            <span className="min-w-0 break-words">{club.name}</span>
          </p>
        ) : null}
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Calendar className="h-4 w-4" aria-hidden="true" />
            {formatDay(tournament.startDateTime, clubTimeZone(club))}
          </p>
          <p className="flex items-center gap-2">
            <Users className="h-4 w-4" aria-hidden="true" />
            {tournament.registeredCount} / {tournament.maxPlayers} players
          </p>
        </div>
        <div className="mt-auto pt-4">
          <Button asChild className="w-full">
            <Link href={routes.publicTournament(tournament.id)} className="after:absolute after:inset-0">
              View Details<span className="sr-only"> for {tournament.name}</span>
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
