/**
 * "Paid players only": whether this device's draws leave out the players who have not paid (the
 * online sign-ups who may never come). Kept per tournament on the device (localStorage), so a refresh,
 * a phone bringing the tab back or a look at the standings no longer turns it off and lets the next
 * "Seat N waiting" seat the no-shows (TDN3-PAIDONLY-RESET). A browser that refuses storage (a private
 * window) keeps it while the page is open. The tab's badge reads the same choice as the panel.
 */
import { useSyncExternalStore } from "react";
import type { SeatingDto } from "@shared/api/seating";

const KEY_PREFIX = "pokerpal.seating.paidOnly.";
const keyOf = (tournamentId: string) => `${KEY_PREFIX}${tournamentId}`;

/** Where the choice lives while storage is refused. */
const unstored = new Map<string, boolean>();
const listeners = new Set<() => void>();

function read(tournamentId: string): boolean {
  try {
    return window.localStorage.getItem(keyOf(tournamentId)) === "on";
  } catch {
    return unstored.get(tournamentId) ?? false;
  }
}

function write(tournamentId: string, paidOnly: boolean): void {
  try {
    if (paidOnly) window.localStorage.setItem(keyOf(tournamentId), "on");
    else window.localStorage.removeItem(keyOf(tournamentId));
  } catch {
    unstored.set(tournamentId, paidOnly);
  }
  listeners.forEach((listener) => listener());
}

/** Every reader of the choice hears a change: on this page at once, from another tab through `storage`. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener("storage", fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromOtherTab);
  };
}

/** The tournament's "Paid players only" on this device, and the way to change it. */
export function usePaidOnly(tournamentId: string): [boolean, (paidOnly: boolean) => void] {
  const paidOnly = useSyncExternalStore(
    subscribe,
    () => read(tournamentId),
    () => false,
  );
  return [paidOnly, (next) => write(tournamentId, next)];
}

/** Players a draw of the waiting list seats: everyone waiting, or only those who have paid. */
export const waitingToSeat = (stats: SeatingDto["stats"], paidOnly: boolean): number => (paidOnly ? stats.unseated - stats.unconfirmedUnseated : stats.unseated);
