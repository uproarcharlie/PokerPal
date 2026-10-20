import { Link } from "wouter";
import { Calendar, Users } from "lucide-react";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { routes } from "@/app/routes";
import { MoneyText } from "@/components/shared/money-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDay, formatTime } from "@/lib/format";

/** How a club's public page names a status where it differs from the staff wording. */
const PUBLIC_LABELS: Readonly<Record<string, string | undefined>> = { in_progress: "Live", scheduled: "Upcoming" };

interface PublicTournamentCardProps {
  tournament: TournamentListItemDto;
  timeZone: string;
  /** Live games show only the day; others the day and start time. */
  showTime?: boolean;
}

/** One tournament on a club's public page; the whole card opens the tournament's page. */
export function PublicTournamentCard({ tournament, timeZone, showTime = true }: PublicTournamentCardProps) {
  return (
    <Card className="relative transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary">
      <CardContent className="flex flex-col justify-between gap-4 p-4 sm:p-6 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="mb-2 break-words text-xl font-bold text-foreground">
            <Link href={routes.publicTournament(tournament.id)} className="after:absolute after:inset-0 focus-visible:outline-none">
              {tournament.name}
            </Link>
          </h3>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              {formatDay(tournament.startDateTime, timeZone)}
            </span>
            {showTime ? <span>{formatTime(tournament.startDateTime, timeZone)}</span> : null}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>
              Buy-in: <MoneyText amount={tournament.buyInAmount} forceCents />
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" aria-hidden="true" />
              {tournament.maxPlayers} max players
            </span>
          </p>
        </div>
        <StatusBadge status={tournament.status} label={PUBLIC_LABELS[tournament.status]} className="self-start md:self-center" />
      </CardContent>
    </Card>
  );
}
