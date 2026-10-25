/**
 * A player who has just come into play while the tables are in use: a late registration, a restored
 * bust, a re-entry. The server seats nobody new by itself, and gives a returning player their old seat
 * only while it is still free; nothing outside the Tables & Seating tab said so, so the seat finder and
 * the TV's seats left them out until the TD happened to look (TDN2-WAITING-NOT-FLAGGED). The toast that
 * confirms the change says they are waiting, with a one-tap "Seat now".
 */
import { useQueryClient } from "@tanstack/react-query";
import { toast, type ToastAction } from "@/hooks/use-toast";
import { seatingRefusal, seatText } from "./seating-text";
import { seatingQueries } from "./staff-api";
import { useSeatingMutations, type SeatingChange } from "./staff-hooks";

/**
 * `waitingSeat(registrationId, name)`, once the change is in: the seating as the server has it now
 * (asked afresh: a returning player may have their old seat back). While tables are in play and the
 * player has no seat, the "Seat now" for the toast; otherwise null, as it is when the seating could not
 * be read (the toast then just says what changed).
 */
export function useWaitingSeat(tournamentId: string): (registrationId: string, name: string) => Promise<ToastAction | null> {
  const queryClient = useQueryClient();
  // The seating's one change path: the panel holds its buttons meanwhile, and a refusal refreshes what it must (P4REV4-R3-CQ-08).
  const change = useSeatingMutations(tournamentId);

  /** Seats one waiting player in a free seat (a draw of them alone), and says where. */
  const seatNow = async (registrationId: string, name: string): Promise<void> => {
    const draw: SeatingChange = { kind: "draw", input: { scope: "unseated", registrationIds: [registrationId], includeUnconfirmed: true } };
    try {
      const result = await change.mutateAsync(draw);
      const seat = result.moves.find((move) => move.registrationId === registrationId)?.to;
      toast(seat ? { title: "Player seated", description: `${name}: ${seatText(seat)}.` } : { title: `${name} already has a seat` });
    } catch (error) {
      toast({ title: `Could not seat ${name}`, description: seatingRefusal(error, draw), variant: "destructive" });
    }
  };

  return async (registrationId, name) => {
    try {
      const seating = await queryClient.fetchQuery({ ...seatingQueries.detail(tournamentId), staleTime: 0 });
      const waiting = !seating.readOnly && seating.stats.activeTables > 0 && seating.unseated.some((entry) => entry.registrationId === registrationId);
      return waiting ? { label: "Seat now", onClick: () => void seatNow(registrationId, name) } : null;
    } catch {
      return null;
    }
  };
}
