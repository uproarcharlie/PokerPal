/**
 * Moving players by hand on the TD's plan: tap a player (at their seat, or in the waiting list), then
 * tap where they go. An empty seat moves them there; another player's seat asks to swap the two. What a
 * tap does is worked out here from the seating on screen, so the panel only carries it out.
 */
import type { PublicPlayer } from "@shared/api/public";
import type { SeatingDto } from "@shared/api/seating";
import { playerName } from "@/features/tournaments/player-name";

/** Where a player sits, as the plan names it. */
export interface SeatSpotText {
  tableId: string;
  tableName: string;
  seatNumber: number;
}

/** A player still in, with their seat (null while they wait for one). */
export interface SeatedEntry {
  registrationId: string;
  player: PublicPlayer | null;
  name: string;
  paymentConfirmed: boolean;
  seat: SeatSpotText | null;
}

/** Everyone still in, by registration: who sits where on the active tables, and who waits. */
export function seatingEntries(seating: Pick<SeatingDto, "tables" | "unseated">): Map<string, SeatedEntry> {
  const entries = new Map<string, SeatedEntry>();
  for (const table of seating.tables) {
    if (table.status !== "active") continue;
    for (const seat of table.seats) {
      if (seat.registrationId === null) continue;
      entries.set(seat.registrationId, {
        registrationId: seat.registrationId,
        player: seat.player,
        name: playerName(seat),
        paymentConfirmed: seat.paymentConfirmed !== false,
        seat: { tableId: table.id, tableName: table.displayName, seatNumber: seat.seatNumber },
      });
    }
  }
  for (const waiting of seating.unseated) {
    entries.set(waiting.registrationId, {
      registrationId: waiting.registrationId,
      player: waiting.player,
      name: playerName(waiting),
      paymentConfirmed: waiting.paymentConfirmed,
      seat: null,
    });
  }
  return entries;
}

/** The seat tapped: where it is, and who sits in it (null when it is empty). */
export interface PressedSeat extends SeatSpotText {
  occupant: SeatedEntry | null;
}

export type SeatPressOutcome =
  | { kind: "select"; registrationId: string }
  | { kind: "deselect" }
  | { kind: "move"; mover: SeatedEntry; to: SeatSpotText }
  | { kind: "swap"; mover: SeatedEntry & { seat: SeatSpotText }; occupant: SeatedEntry & { seat: SeatSpotText } }
  | { kind: "hint"; text: string };

export const PICK_A_PLAYER_FIRST = "Pick a player first (at their seat, or in the waiting list), then tap the empty seat.";

/** What tapping `seat` does, with `selected` picked up (or nobody). */
export function seatPress(selected: SeatedEntry | null, seat: PressedSeat): SeatPressOutcome {
  const spot: SeatSpotText = { tableId: seat.tableId, tableName: seat.tableName, seatNumber: seat.seatNumber };
  const { occupant } = seat;
  if (occupant === null) {
    return selected === null ? { kind: "hint", text: PICK_A_PLAYER_FIRST } : { kind: "move", mover: selected, to: spot };
  }
  if (selected === null) return { kind: "select", registrationId: occupant.registrationId };
  if (selected.registrationId === occupant.registrationId) return { kind: "deselect" };
  if (selected.seat === null) {
    return { kind: "hint", text: `That seat is taken. Pick an empty seat for ${selected.name}, or move ${occupant.name} first.` };
  }
  return { kind: "swap", mover: { ...selected, seat: selected.seat }, occupant: { ...occupant, seat: spot } };
}
