import { Link } from "wouter";
import { Wallet } from "lucide-react";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";

interface PaidPlayersNoteProps {
  tournamentId: string;
  /** The accepted players the pool counts (computePrizePool's counts.registrations): free entries too. */
  paid: number;
  /** The players in the field: everyone but the waiting list behind a full one. */
  entrants: number;
  /** How many of the accepted players were given a free entry (computePrizePool's freeEntries.entries). */
  freeEntries?: number;
  /** A $0 buy-in (isFreeTournament): players are accepted, not paid. */
  freeTournament?: boolean;
  /**
   * Opens the phone desk's Take payment sheet (R6REV1-PHONE-02): the TD stays on the desk, with its
   * tabs, clock and quick actions. Without it (the wide screen) the button leads to the payment desk.
   */
  onTakePayments?: () => void;
}

const players = (count: number, word: string) => `${count} ${word} ${count === 1 ? "player" : "players"}`;
const freeEntriesText = (count: number) => `${count} free ${count === 1 ? "entry" : "entries"}`;

/**
 * Whose money the prize pool holds (round 6: only paid players'), said plainly for the TD: "Prize pool
 * from 16 paid players · 2 not paid yet (not in the pool)", with the way to take their payments while
 * anyone in the field has not paid. Free entries are accepted without paying (round 7), so with any
 * the note counts accepted players and says how many came in free. A $0 game's pool is the club's
 * (round 7, item 8): the note only counts who is accepted, with "Accept players". Nothing before
 * anyone has signed up.
 */
export function PaidPlayersNote({ tournamentId, paid, entrants, freeEntries = 0, freeTournament = false, onTakePayments }: PaidPlayersNoteProps) {
  if (entrants === 0) return null;
  const unpaid = Math.max(0, entrants - paid);
  const counted = freeTournament ? players(paid, "accepted") : `Prize pool from ${players(paid, freeEntries > 0 ? "accepted" : "paid")}`;
  const action = freeTournament ? "Accept players" : "Take payments";
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
      data-testid="paid-players-note"
    >
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{counted}</span>
        {freeEntries > 0 && !freeTournament ? (
          <>
            <span aria-hidden="true"> · </span>
            <span data-testid="free-entry-count">{freeEntriesText(freeEntries)}</span>
          </>
        ) : null}
        {unpaid > 0 ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="font-medium text-foreground" data-testid="unpaid-count">
              {unpaid} {freeTournament ? "not accepted yet" : "not paid yet"}
            </span>
            {freeTournament ? null : " (not in the pool)"}
          </>
        ) : null}
      </p>
      {unpaid > 0 && onTakePayments ? (
        <Button type="button" variant="outline" className="h-11 w-full shrink-0 sm:w-auto" onClick={onTakePayments} data-testid="take-payments">
          <Wallet aria-hidden="true" />
          {action}
        </Button>
      ) : unpaid > 0 ? (
        <Button asChild variant="outline" className="h-11 w-full shrink-0 sm:w-auto">
          <Link href={routes.adminRegistrations(tournamentId)} data-testid="take-payments">
            <Wallet aria-hidden="true" />
            {action}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
