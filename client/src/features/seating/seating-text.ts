/**
 * The TD's seating screen in words: seats and moves as they are read out at the venue ("Alice →
 * Table 1, Seat 3"), and refusals in the copy phase4-contracts §6 gives them. Branches on error
 * codes, never on the server's sentence.
 */
import type { SeatingDto, SeatingMutationDto, SeatMoveDto, SeatRefDto } from "@shared/api/seating";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { plural } from "@/lib/format";
import type { SeatingChange } from "./staff-hooks";

/** "Table 2, Seat 4" (a named table by its name: "Feature table, Seat 4"). */
export const seatText = (seat: Pick<SeatRefDto, "tableName" | "seatNumber">): string => `${seat.tableName}, Seat ${seat.seatNumber}`;

/** "Alice → Table 1, Seat 3", or "Alice unseated". */
export const moveText = (move: SeatMoveDto): string => (move.to ? `${move.playerName} → ${seatText(move.to)}` : `${move.playerName} unseated`);

/** Moves in the order players listen for them: by name. */
export const movesByName = (moves: readonly SeatMoveDto[]): SeatMoveDto[] => [...moves].sort((a, b) => a.playerName.localeCompare(b.playerName));

/** Whether a change's moves are the system's to announce (a draw, balancing), rather than a move the TD made by hand. */
export const announcesMoves = (change: SeatingChange): boolean => change.kind !== "assign" && change.kind !== "unseat";

/** "17/27 seats · 10 open · 3 waiting": the seating at a glance. */
export function seatingSummary(stats: SeatingDto["stats"]): string {
  const parts = [`${stats.seated}/${stats.capacity} seats`, `${stats.openSeats} open`];
  if (stats.unseated > 0) parts.push(`${stats.unseated} waiting`);
  return parts.join(" · ");
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * What a refused seating change tells the TD. INSUFFICIENT_SEATS says how many seats are missing
 * (except for the final table, where the server says which table is too small); a seat taken or a
 * seating changed meanwhile says the screen has been refreshed; anything else is the server's sentence.
 */
export function seatingRefusal(error: unknown, change?: SeatingChange): string {
  if (hasErrorCode(error, "INSUFFICIENT_SEATS") && change?.kind !== "finalTable") {
    const details = (typeof error.details === "object" && error.details !== null ? error.details : {}) as { needed?: unknown; available?: unknown };
    if (isCount(details.needed) && isCount(details.available) && details.needed > details.available) {
      return `Need ${plural(details.needed - details.available, "more seat")} — add a table?`;
    }
  }
  if (hasErrorCode(error, "SEAT_TAKEN")) return "Seat taken — tap Swap";
  if (hasErrorCode(error, "STALE_PLAN", "SEAT_CONFLICT")) return "Seating changed — refreshed";
  return errorMessage(error);
}

/** The moves a draw, a balance, a broken table or the final table made, to read out at the venue. */
export interface AnnouncedMoves {
  title: string;
  moves: readonly SeatMoveDto[];
  /** Draw and setup: players left out because they have not paid. */
  excludedUnconfirmed?: number;
}

/** What the TD is told after a change: the moves to call out, or a toast. */
export interface ChangeOutcome {
  announce: AnnouncedMoves | null;
  toast: { title: string; description?: string } | null;
}

const tableName = (seating: SeatingDto, tableId: string) => seating.tables.find((table) => table.id === tableId)?.displayName ?? "The table";

const unpaidLeftOut = (excluded: number) => `${plural(excluded, "unpaid player was", "unpaid players were")} left out`;

function announceTitle(change: SeatingChange, result: SeatingMutationDto): string {
  switch (change.kind) {
    case "draw":
      return change.input.scope === "all" ? "Seats redrawn" : "Seats drawn";
    case "balance":
      return "Tables balanced";
    case "breakTable":
      return `${tableName(result.seating, change.tableId)} broken`;
    case "finalTable":
      return "Final table drawn";
    default:
      return "Seats drawn";
  }
}

function quietToast(change: SeatingChange, result: SeatingMutationDto): ChangeOutcome["toast"] {
  const excluded = result.excludedUnconfirmed ?? 0;
  const [first, second] = result.moves;
  switch (change.kind) {
    case "setup":
      return { title: "Tables set up", description: excluded > 0 ? `Nobody seated: ${unpaidLeftOut(excluded)}.` : "Nobody to seat yet." };
    case "addTables":
      return { title: `${plural(change.input.count, "table")} added` };
    case "updateTable":
      return { title: change.input.status === "active" ? "Table reopened" : "Table updated" };
    case "removeTable":
      return result.removed === "archived" ? { title: "Table archived", description: "It has seated players before, so its history is kept." } : { title: "Table removed" };
    case "breakTable":
      return { title: "Table broken", description: "Nobody was sitting at it." };
    case "draw":
      return excluded > 0 ? { title: "Nobody seated", description: `${unpaidLeftOut(excluded)} (paid players only).` } : { title: "Everyone is seated" };
    case "assign":
      if (first && second) return { title: "Seats swapped", description: `${first.playerName} and ${second.playerName} swapped seats.` };
      return first ? { title: "Player moved", description: moveText(first) } : null;
    case "unseat":
      return first ? { title: "Player unseated", description: `${first.playerName} is waiting for a seat.` } : null;
    case "balance":
      return { title: "Tables are already balanced" };
    case "finalTable":
      return { title: "Final table drawn", description: "Everyone was already in place." };
  }
}

/** After a change: the moves to call out when the system chose them, else a toast saying what happened (or nothing). */
export function changeOutcome(change: SeatingChange, result: SeatingMutationDto): ChangeOutcome {
  if (result.moves.length > 0 && announcesMoves(change)) {
    return { announce: { title: announceTitle(change, result), moves: result.moves, excludedUnconfirmed: result.excludedUnconfirmed ?? 0 }, toast: null };
  }
  return { announce: null, toast: quietToast(change, result) };
}

/** A refused change's toast title. */
export const FAILED: Record<SeatingChange["kind"], string> = {
  setup: "Could not set up the tables",
  addTables: "Could not add tables",
  updateTable: "Could not change the table",
  removeTable: "Could not remove the table",
  breakTable: "Could not break the table",
  draw: "Could not draw seats",
  assign: "Could not move the player",
  unseat: "Could not unseat the player",
  balance: "Could not balance the tables",
  finalTable: "Could not draw the final table",
};
