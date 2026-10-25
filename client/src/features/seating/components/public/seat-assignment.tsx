import { Link } from "wouter";
import { Armchair, MapPin } from "lucide-react";
import type { AutoSeatResultDto } from "@shared/api/seating";
import type { AutoSeatSkip } from "@shared/domain/table-advisor";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";

/** What a player who was not seated straight away is told, by why (round 5, item 9). */
const WAITING: Readonly<Record<AutoSeatSkip, string>> = {
  no_tables: "Seats haven't been drawn yet. Your table and seat show on the seat finder once they are.",
  tables_full: "Every table is full right now: you're seated as soon as the next table opens. Your seat shows on the seat finder.",
  awaiting_payment: "Your seat is drawn once you've paid at the desk.",
  off: "Your seat will be called at the desk.",
  not_eligible: "Your seat will be called at the desk.",
  already_seated: "You already have a seat: find it on the seat finder.",
};

interface SeatAssignmentProps {
  /** What auto-seat did with the sign-up (RegistrationCreatedDto.seating). */
  seating: AutoSeatResultDto;
  tournamentId: string;
}

/**
 * The QR sign-up's confirmation of where the player sits (round 5, item 9): "You're at Table 2, Seat
 * 7" in large type, or why their seat comes later, with the way to the seat finder (which follows any
 * move the tournament director makes later).
 */
export function SeatAssignment({ seating, tournamentId }: SeatAssignmentProps) {
  const finder = (
    <Button variant="outline" className="min-h-11 w-full sm:w-auto" asChild>
      <Link href={routes.publicSeats(tournamentId)} data-testid="seat-assignment-finder">
        <MapPin aria-hidden="true" />
        Find your seat
      </Link>
    </Button>
  );
  if (seating.status === "seated") {
    const { tableName, seatNumber } = seating.seat;
    return (
      <section aria-label="Your seat" className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-center" data-testid="seat-assignment">
        <Armchair className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <p className="text-foreground">
          <span className="block text-sm font-medium text-muted-foreground">You're at</span>{" "}
          <span className="block text-3xl font-bold tabular-nums text-primary">
            {tableName}, Seat {seatNumber}
          </span>
        </p>
        {finder}
      </section>
    );
  }
  return (
    <section aria-label="Your seat" className="space-y-3 rounded-lg border border-border bg-card p-4 text-center" data-testid="seat-assignment">
      <p className="text-foreground">{WAITING[seating.reason]}</p>
      {seating.reason === "no_tables" || seating.reason === "tables_full" || seating.reason === "already_seated" ? finder : null}
    </section>
  );
}
