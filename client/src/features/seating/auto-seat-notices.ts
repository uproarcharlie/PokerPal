/**
 * New arrivals at the tables (round 5, item 9): the server seats a late registration the moment it is
 * made (QR sign-up or desk), so the TD hears of it from the seating as it is followed, never from a
 * new endpoint. A player in the seating now who was in neither its tables nor its waiting list the last
 * time it was read has just come into play: seated ("Test Player 16 seated at Table 2, Seat 7"), or
 * waiting with every seat taken (the advisor's "Open Table N" is then the next step).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SeatingDto } from "@shared/api/seating";
import { isRecord } from "@/lib/api/http";
import { toast } from "@/hooks/use-toast";
import { tournamentQueries } from "@/features/tournaments/api";
import { seatingEntries } from "./seat-selection";
import { seatText } from "./seating-text";
import { useFollowedSeating } from "./staff-hooks";

/** Someone who has just come into play, and where they sit (null while they wait for a seat). */
export interface Arrival {
  registrationId: string;
  name: string;
  seat: { tableId: string; tableName: string; seatNumber: number } | null;
}

type Roster = Pick<SeatingDto, "tables" | "unseated">;

/** The players in `next` who were not in `previous` at all (seated or waiting): new registrations, and players back in. */
export function newArrivals(previous: Roster, next: Roster): Arrival[] {
  const known = seatingEntries(previous);
  return Array.from(seatingEntries(next).values())
    .filter((entry) => !known.has(entry.registrationId))
    .map(({ registrationId, name, seat }) => ({ registrationId, name, seat }));
}

/** "Test Player 16 seated at Table 2, Seat 7". */
export const arrivalText = (arrival: Arrival & { seat: NonNullable<Arrival["seat"]> }): string => `${arrival.name} seated at ${seatText(arrival.seat)}`;

/** How many arrivals the Seats tab's banner keeps (the newest first). */
const ARRIVALS_KEPT = 6;

/**
 * The arrivals since the Seats tab opened, newest first, for its banner and the seats it marks on the
 * plan; cleared by `dismiss`. Worked out from each new seating the panel is given (a poll, or the
 * answer to a change), against the one before.
 */
export function useSeatArrivals(seating: SeatingDto): { arrivals: Arrival[]; dismiss: () => void } {
  const [seen, setSeen] = useState(seating);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  if (seating !== seen) {
    setSeen(seating);
    const fresh = seating.readOnly ? [] : newArrivals(seen, seating);
    if (fresh.length > 0) {
      setArrivals((current) => [...fresh, ...current.filter((kept) => !fresh.some((arrival) => arrival.registrationId === kept.registrationId))].slice(0, ARRIVALS_KEPT));
    }
  }
  return { arrivals, dismiss: () => setArrivals([]) };
}

/**
 * Whether this device made that registration (or brought that player back) itself: its own screen
 * said where they sat, so the notice would only repeat it. Read from the mutations it ran, whose
 * answers are the registration.
 */
function madeHere(queryClient: QueryClient, registrationId: string): boolean {
  return queryClient
    .getMutationCache()
    .getAll()
    .some((mutation) => mutation.state.status === "success" && isRecord(mutation.state.data) && mutation.state.data.id === registrationId);
}

/**
 * Toasts on the TD's tournament page as players are seated automatically (round5-contracts §8.2):
 * "Test Player 16 seated at Table 2, Seat 7", or "Test Player 17 is waiting for a seat" when every
 * table is full. It follows the seating the Seats tab's badge follows (the same query, every 30
 * seconds while tables are in play) and asks again whenever the page's registrations show someone
 * new; arrivals this device registered itself are left to its own screen. Off for a tournament that
 * is over, and for a viewer who is not the club's staff (`enabled`).
 */
export function useAutoSeatNotices(tournamentId: string, { enabled = true }: { enabled?: boolean } = {}): void {
  const queryClient = useQueryClient();
  // The page's own poll of the registrations, read from the cache (never asked for here).
  const registrations = useQuery({ ...tournamentQueries.registrations(tournamentId), enabled: false });
  const seating = useFollowedSeating(tournamentId, { registrations: registrations.data, poll: "badge", enabled });

  const previous = useRef<SeatingDto | undefined>(undefined);
  useEffect(() => {
    const next = seating.data;
    const before = previous.current;
    previous.current = next;
    if (!enabled || !before || !next || next.readOnly) return;
    const arrivals = newArrivals(before, next).filter((arrival) => !madeHere(queryClient, arrival.registrationId));
    const seated = arrivals.filter((arrival): arrival is Arrival & { seat: NonNullable<Arrival["seat"]> } => arrival.seat !== null);
    if (seated.length === 1) toast({ title: "Player seated", description: `${arrivalText(seated[0])}.` });
    else if (seated.length > 1) toast({ title: `${seated.length} players seated`, description: `${seated.map(arrivalText).join("; ")}.` });
    const full = next.stats.activeTables > 0 && next.stats.openSeats === 0 && next.settings.autoSeat !== "off";
    const waiting = full ? arrivals.filter((arrival) => arrival.seat === null) : [];
    if (waiting.length > 0) {
      const names = waiting.map((arrival) => arrival.name).join(", ");
      toast({ title: "Every table is full", description: `${names} ${waiting.length === 1 ? "is" : "are"} waiting for a seat: open a table on the Seats tab.` });
    }
  }, [enabled, seating.data, queryClient]);
}
