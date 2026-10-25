import { useState } from "react";
import { Link, useParams } from "wouter";
import { Armchair } from "lucide-react";
import type { PublicSeatingDto } from "@shared/api/seating";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { ClubHeader } from "@/components/shared/club-header";
import { LiveStatus } from "@/components/shared/live-status";
import { PageSpinner } from "@/components/shared/page-spinner";
import { PublicFooter } from "@/components/shared/public-footer";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { qk } from "@/lib/api/query-keys";
import { findSeats, SeatFinder } from "../components/public/seat-finder";
import { PublicTables, seatKey } from "../components/public/public-tables";
import { publicSeatingInterval, usePublicSeating } from "../hooks";

/** A tournament that does not exist (any more): a mistyped link, or one the TD removed. */
function TournamentMissing() {
  return (
    <EmptyState
      title="Tournament not found"
      description="The link may be mistyped, or the tournament may have been removed. Check it with the tournament director."
      action={
        <Button variant="outline" asChild>
          <Link href={routes.home()}>Find a club</Link>
        </Button>
      }
    />
  );
}

const PAGE_STATES = {
  stateClassName: "mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center bg-background px-4 py-8",
  loading: <PageSpinner label="Loading the seats" />,
  errorTitle: "The seats could not be loaded",
  notFound: <TournamentMissing />,
};

function SeatsView({ seating }: { seating: PublicSeatingDto }) {
  const [query, setQuery] = useState("");
  const { tournament, club, tables } = seating;
  const highlighted = new Set(query.trim() === "" ? [] : findSeats(seating.players, query.trim()).map((entry) => seatKey(entry.tableNumber, entry.seatNumber)));

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
          <ClubHeader club={club} align="start" logoSize="md" />
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Find your seat</h1>
            <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <Link href={routes.publicTournament(tournament.id)} className="font-medium text-foreground underline-offset-4 hover:underline">
                {tournament.name}
              </Link>
              <StatusBadge status={tournament.status} label={tournament.status === "in_progress" ? "Live" : undefined} />
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <LiveStatus follows={[{ queryKey: qk.tournaments.publicSeating(tournament.id), interval: publicSeatingInterval(seating) }]} />
        {tables.length === 0 ? (
          <EmptyState
            icon={<Armchair className="h-8 w-8" />}
            title="Seats haven't been drawn yet"
            description="Your table and seat show here once the tournament director draws the seats. This page updates by itself."
          />
        ) : (
          <>
            <div className="mx-auto max-w-xl">
              <SeatFinder players={seating.players} unseatedCount={seating.unseatedCount} query={query} onQueryChange={setQuery} />
            </div>
            <PublicTables tables={tables} highlighted={highlighted} />
          </>
        )}
      </div>

      <PublicFooter club={club} />
    </div>
  );
}

/** "Find your seat" (/tournament/:id/seats): players type their name and see their table and seat; every table listed. */
export default function PublicSeatsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const seating = usePublicSeating(id);
  usePageMeta({ title: seating.data ? `Find your seat: ${seating.data.tournament.name}` : "Find your seat", noindex: true });

  return (
    <QueryState query={seating} {...PAGE_STATES}>
      {(loaded) => <SeatsView seating={loaded} />}
    </QueryState>
  );
}
