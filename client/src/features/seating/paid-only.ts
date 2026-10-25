/**
 * "Paid players only": whether this device's draws leave out the players who have not paid (the
 * online sign-ups who may never come). Kept per tournament on the device, so a refresh, a phone
 * bringing the tab back or a look at the standings no longer turns it off and lets the next "Seat N
 * waiting" seat the no-shows (TDN3-PAIDONLY-RESET). The tab's badge reads the same choice as the panel.
 */
import type { SeatingDto } from "@shared/api/seating";
import { useDeviceChoice } from "./device-choice";

const CHOICES = ["off", "on"] as const;

/** The tournament's "Paid players only" on this device, and the way to change it. */
export function usePaidOnly(tournamentId: string): [boolean, (paidOnly: boolean) => void] {
  const [choice, setChoice] = useDeviceChoice(`paidOnly.${tournamentId}`, CHOICES);
  return [choice === "on", (paidOnly) => setChoice(paidOnly ? "on" : "off")];
}

/** Players a draw of the waiting list seats: everyone waiting, or only those who have paid. */
export const waitingToSeat = (stats: SeatingDto["stats"], paidOnly: boolean): number => (paidOnly ? stats.unseated - stats.unconfirmedUnseated : stats.unseated);
