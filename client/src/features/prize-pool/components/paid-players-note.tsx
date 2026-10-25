import { Link } from "wouter";
import { Wallet } from "lucide-react";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";

interface PaidPlayersNoteProps {
  tournamentId: string;
  /** The paid players the pool counts (computePrizePool's counts.registrations). */
  paid: number;
  /** The players in the field: everyone but the waiting list behind a full one. */
  entrants: number;
  /**
   * Opens the phone desk's Take payment sheet (R6REV1-PHONE-02): the TD stays on the desk, with its
   * tabs, clock and quick actions. Without it (the wide screen) the button leads to the payment desk.
   */
  onTakePayments?: () => void;
}

const players = (count: number) => `${count} paid ${count === 1 ? "player" : "players"}`;

/**
 * Whose money the prize pool holds (round 6: only paid players'), said plainly for the TD: "Prize pool
 * from 16 paid players · 2 not paid yet (not in the pool)", with the way to take their payments while
 * anyone in the field has not paid. Nothing before anyone has signed up.
 */
export function PaidPlayersNote({ tournamentId, paid, entrants, onTakePayments }: PaidPlayersNoteProps) {
  if (entrants === 0) return null;
  const unpaid = Math.max(0, entrants - paid);
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
      data-testid="paid-players-note"
    >
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">Prize pool from {players(paid)}</span>
        {unpaid > 0 ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="font-medium text-foreground" data-testid="unpaid-count">
              {unpaid} not paid yet
            </span>{" "}
            (not in the pool)
          </>
        ) : null}
      </p>
      {unpaid > 0 && onTakePayments ? (
        <Button type="button" variant="outline" className="h-11 w-full shrink-0 sm:w-auto" onClick={onTakePayments} data-testid="take-payments">
          <Wallet aria-hidden="true" />
          Take payments
        </Button>
      ) : unpaid > 0 ? (
        <Button asChild variant="outline" className="h-11 w-full shrink-0 sm:w-auto">
          <Link href={routes.adminRegistrations(tournamentId)} data-testid="take-payments">
            <Wallet aria-hidden="true" />
            Take payments
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
