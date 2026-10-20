import type { ReactNode } from "react";
import { Calendar, DollarSign, Users } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { MoneyText } from "@/components/shared/money-text";
import { figureOf, FigureValue } from "@/components/shared/query-figure";
import { Card, CardContent } from "@/components/ui/card";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function Stat({ icon, label, value, tint }: { icon: ReactNode; label: string; value: ReactNode; tint: string }) {
  return (
    <Card>
      <CardContent className="p-4 sm:pt-6">
        <div className="flex items-center gap-3">
          <div className={cn("shrink-0 rounded-lg p-2.5 sm:p-3", tint)} aria-hidden="true">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="truncate text-lg font-bold text-foreground sm:text-2xl">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface TournamentStatsProps {
  tournament: TournamentDetailDto;
  /** The registrations query: the counts wait for it (never a made-up 0), and say so if it failed. */
  registrations: { data: readonly PublicRegistration[] | undefined; isError: boolean };
  timeZone: string;
}

/** Entrants against the cap, who is still in while it runs, the buy-in and the start time. */
export function TournamentStats({ tournament, registrations, timeZone }: TournamentStatsProps) {
  const entrants = figureOf(registrations, (list) => list.length);
  const stillIn = figureOf(registrations, (list) => list.filter((registration) => !registration.isEliminated).length);
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:mb-8 md:grid-cols-4 md:gap-4">
      <Stat
        icon={<Users className="h-5 w-5" />}
        tint="bg-primary/10 text-primary"
        label="Players"
        value={
          <>
            <FigureValue figure={entrants} loadingClassName="h-6 w-8" />/{tournament.maxPlayers}
          </>
        }
      />
      {tournament.status === "in_progress" ? (
        <Stat icon={<Users className="h-5 w-5" />} tint="bg-status-live text-status-live-foreground" label="Active" value={<FigureValue figure={stillIn} loadingClassName="h-6 w-8" />} />
      ) : null}
      <Stat
        icon={<DollarSign className="h-5 w-5" />}
        tint="bg-accent/15 text-accent"
        label="Buy-in"
        value={<MoneyText amount={tournament.buyInAmount} />}
      />
      <Stat
        icon={<Calendar className="h-5 w-5" />}
        tint="bg-status-registration text-status-registration-foreground"
        label="Start Time"
        value={formatTime(tournament.startDateTime, timeZone)}
      />
    </div>
  );
}
