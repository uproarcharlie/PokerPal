/**
 * Putting a player who is out back in, from the standings' Restore or from the bust toast's Undo: the
 * server takes the knockout back off the eliminator and gives back the player's seat while it is still
 * free. A bust recorded from the seating plan with a wrong tap is then undone at once, from where it
 * was made, instead of from the Standings tab after the seat may have gone (TDN3-BUST-NO-UNDO).
 */
import type { PublicRegistration } from "@shared/api/public";
import { returnSeatAction, returnSeatText, useReturnSeat } from "@/features/seating/waiting-seat";
import { toast, type ToastAction } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { playerName } from "../../player-name";
import { useUpdateRegistration } from "../../staff-hooks";

/**
 * `announceReturn(registration, title)`, once a restore is in: the toast that says where the player
 * sits now ("back in, at their old seat: Table 1, Seat 3", or "at a new seat" when theirs was taken),
 * or that they wait, with "Seat now" (R5REV-HOST-04).
 */
export function useAnnounceReturn(tournamentId: string): (registration: PublicRegistration, title: string) => Promise<void> {
  const returnSeat = useReturnSeat(tournamentId);
  return async (registration, title) => {
    const name = playerName(registration);
    const outcome = await returnSeat(registration.id, name);
    toast({
      title,
      description: outcome ? returnSeatText(`${name} is back in`, outcome, { waiting: "waiting for a seat: their old one was not free" }) : undefined,
      action: returnSeatAction(outcome),
    });
  };
}

/** The bust toast's "Undo" for a player just eliminated. */
export type UndoElimination = (registration: PublicRegistration) => ToastAction;

/** The Undo for the bust toast: the same restore as the standings' Restore. */
export function useUndoElimination(tournamentId: string): UndoElimination {
  const restore = useUpdateRegistration(tournamentId);
  const announceReturn = useAnnounceReturn(tournamentId);
  return (registration) => ({
    label: "Undo",
    onClick: () =>
      void restore.mutateAsync({ registrationId: registration.id, input: { isEliminated: false } }).then(
        () => announceReturn(registration, "Elimination undone"),
        (error: unknown) => toast({ title: "Could not undo the elimination", description: errorMessage(error, "Failed to restore player"), variant: "destructive" }),
      ),
  });
}
