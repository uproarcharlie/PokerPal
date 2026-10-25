/**
 * A player who has just come into play while the tables are in use: a late registration, a restored
 * bust, a re-entry. The server gives a returning player their old seat while it is still free, and
 * (round 5) auto-seat sits anyone else down as they come in; but with auto-seat off, every table full,
 * or a player held back until they pay, they wait, and nothing outside the Seats tab said so: the seat
 * finder and the TV's seats left them out until the TD happened to look (TDN2-WAITING-NOT-FLAGGED).
 * The toast that confirms the change says where they sit now, and whether that is their old seat, so
 * the TD can send them straight there (R5REV-HOST-04: the auto-seat notice stays quiet about a change
 * this device made); or that they are waiting, with a one-tap "Seat now".
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ActivityDto } from "@shared/api/public";
import type { SeatingDto } from "@shared/api/seating";
import { tournamentQueries } from "@/features/tournaments/api";
import { ACTIVITY_FEED_LIMIT } from "@/features/tournaments/hooks";
import { toast, type ToastAction } from "@/hooks/use-toast";
import { isRecord } from "@/lib/api/http";
import { seatingRefusal, seatText } from "./seating-text";
import { seatingQueries } from "./staff-api";
import { useSeatingMutations, type SeatingChange } from "./staff-hooks";

/** A seat as the toast names it ("Table 2, Seat 7"). */
export interface ReturnedSeat {
  tableNumber: number;
  tableName: string;
  seatNumber: number;
}

/**
 * Where the player is once the change is in. `oldSeat`: true for the seat they had before they went
 * out, false for another one (auto-seat sat them down: theirs was not free), null when the seating's
 * history could not tell.
 */
export type ReturnSeat = { status: "seated"; seat: ReturnedSeat; oldSeat: boolean | null } | { status: "waiting"; seatNow: ToastAction };

/** Where `registrationId` sits in `seating`, by its table's name; null for no seat. */
function seatIn(seating: SeatingDto, registrationId: string): ReturnedSeat | null {
  for (const table of seating.tables) {
    if (table.status !== "active") continue;
    const seat = table.seats.find((candidate) => candidate.registrationId === registrationId);
    if (seat) return { tableNumber: table.tableNumber, tableName: table.displayName, seatNumber: seat.seatNumber };
  }
  return null;
}

/**
 * Whether `seat` is the player's old one, from the entry the server wrote as it sat them down: their
 * old seat given back (`restored`), or a seat auto-seat chose (`auto`). Null when the latest such entry
 * is not about this seat or cannot be read: the toast then names the seat without saying more.
 */
async function wasOldSeat(queryClient: QueryClient, tournamentId: string, registrationId: string, seat: ReturnedSeat): Promise<boolean | null> {
  let feed: ActivityDto[];
  try {
    feed = await queryClient.fetchQuery({ ...tournamentQueries.activity(tournamentId, ACTIVITY_FEED_LIMIT), staleTime: 0 });
  } catch {
    return null;
  }
  for (const entry of feed) {
    if (entry.eventType !== "seat_assigned" || !entry.eventData) continue;
    let data: unknown;
    try {
      data = JSON.parse(entry.eventData);
    } catch {
      continue;
    }
    if (!isRecord(data) || data.registrationId !== registrationId) continue;
    const to = isRecord(data.to) ? data.to : null;
    if (to?.tableNumber !== seat.tableNumber || to.seatNumber !== seat.seatNumber) return null;
    if (data.restored === true) return true;
    if (data.auto === true) return false;
    return null;
  }
  return null;
}

/**
 * `returnSeat(registrationId, name)`, once the change is in: the seating as the server has it now
 * (asked afresh: a returning player may have their old seat back, or auto-seat may have chosen one).
 * Seated: where, and for a player coming back (`returning`, the default) whether it is their old seat;
 * waiting while tables are in play: the "Seat now" for the toast; null when no table is in play, or
 * when the seating could not be read (the toast then just says what changed).
 */
export function useReturnSeat(tournamentId: string): (registrationId: string, name: string, options?: { returning?: boolean }) => Promise<ReturnSeat | null> {
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

  return async (registrationId, name, { returning = true } = {}) => {
    let seating: SeatingDto;
    try {
      seating = await queryClient.fetchQuery({ ...seatingQueries.detail(tournamentId), staleTime: 0 });
    } catch {
      return null;
    }
    if (seating.readOnly || seating.stats.activeTables === 0) return null;
    const seat = seatIn(seating, registrationId);
    if (seat) return { status: "seated", seat, oldSeat: returning ? await wasOldSeat(queryClient, tournamentId, registrationId, seat) : null };
    return seating.unseated.some((entry) => entry.registrationId === registrationId)
      ? { status: "waiting", seatNow: { label: "Seat now", onClick: () => void seatNow(registrationId, name) } }
      : null;
  };
}

/**
 * What the toast says after `lead` ("Ann is back in"): "Ann is back in, at their old seat: Table 1,
 * Seat 3.", "Ann is back in at a new seat: Table 2, Seat 5.", "Ann is back in, waiting for a seat.";
 * `${lead}.` when there is nothing to add.
 */
export function returnSeatText(lead: string, outcome: ReturnSeat | null, { waiting = "waiting for a seat" }: { waiting?: string } = {}): string {
  if (outcome === null) return `${lead}.`;
  if (outcome.status === "waiting") return `${lead}, ${waiting}.`;
  const where = seatText(outcome.seat);
  if (outcome.oldSeat === true) return `${lead}, at their old seat: ${where}.`;
  if (outcome.oldSeat === false) return `${lead} at a new seat: ${where}.`;
  return `${lead} at ${where}.`;
}

/** The toast's action for `outcome`: "Seat now" while the player waits. */
export const returnSeatAction = (outcome: ReturnSeat | null): ToastAction | undefined => (outcome?.status === "waiting" ? outcome.seatNow : undefined);
