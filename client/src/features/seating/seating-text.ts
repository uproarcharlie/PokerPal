/**
 * The TD's seating screen in words: seats and moves as they are read out at the venue ("Alice →
 * Table 1, Seat 3"), and refusals in the copy phase4-contracts §6 gives them. Branches on error
 * codes, never on the server's sentence.
 */
import type { SeatingChangeDto, SeatingDto, SeatingMutationDto, SeatMoveDto, SeatRefDto } from "@shared/api/seating";
import { SEATING_LIMITS, waitingText } from "@shared/domain/seating";
import { playerName } from "@/features/tournaments/player-name";
import { errorDetails, errorMessage, hasErrorCode } from "@/lib/api/http";
import { plural } from "@/lib/format";
import type { SeatingChange } from "./staff-hooks";

/** "Table 2, Seat 4" (a named table by its name: "Feature table, Seat 4"). */
export const seatText = (seat: Pick<SeatRefDto, "tableName" | "seatNumber">): string => `${seat.tableName}, Seat ${seat.seatNumber}`;

/** "Alice → Table 1, Seat 3", or "Alice unseated". */
export const moveText = (move: SeatMoveDto): string => (move.to ? `${move.playerName} → ${seatText(move.to)}` : `${move.playerName} unseated`);

/** "Table 1, Table 2" as one says it: "Tables 1 and 2" (named tables by name: "Feature table and Table 2"). */
export function tablesText(tables: ReadonlyArray<{ name: string | null; displayName: string; tableNumber: number }>): string {
  if (tables.length === 1) return tables[0].displayName;
  const numbered = tables.every((table) => table.name === null);
  const names = tables.map((table) => (numbered ? String(table.tableNumber) : table.displayName));
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return numbered ? `Tables ${list}` : list;
}

/**
 * "2 players are waiting for a seat (1 unpaid): they keep waiting." Breaking a table, balancing and
 * the final table plan around the players at the tables, so the TD is told who they leave out
 * (TDN4-FINAL-TABLE-WORDS). Null when nobody is waiting.
 */
export function leftWaitingText(stats: Pick<SeatingDto["stats"], "unseated" | "unconfirmedUnseated">): string | null {
  const waiting = waitingText(stats.unseated, stats.unconfirmedUnseated);
  return waiting ? `${waiting}: they keep waiting.` : null;
}

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
    const details = errorDetails(error) ?? {};
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
  /** The change the moves were (its activity entry), offered as Undo while the seats are as it left them. */
  undoable?: { activityId: string; version: string };
  /** Draw and setup: players left out because they have not paid. */
  excludedUnconfirmed?: number;
  /**
   * A break, a balance or the final table: who is still waiting for a seat after it, by name, and how
   * many seats are open for them (TDN4-FINAL-TABLE-WORDS). Absent when nobody is.
   */
  waiting?: { text: string; names: readonly string[]; openSeats: number };
}

/** What the TD is told after a change: the moves to call out, or a toast, with an Undo for a move made by hand. */
export interface ChangeOutcome {
  announce: AnnouncedMoves | null;
  toast: { title: string; description?: string } | null;
  /** The change that puts a hand-made move, swap or unseat back, for the toast's Undo (TDN4-UNSEAT-NO-UNDO). */
  undo: SeatingChange | null;
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
    case "openTable":
      // The new table is filled first (planOpenTable), so the first move names it.
      return `${result.moves[0]?.to?.tableName ?? "Table"} opened`;
    case "undoChange":
      return "Change undone";
    default:
      return "Seats drawn";
  }
}

/** "Alice is back at Table 1, Seat 3": what the Undo of a move made by hand says it did. */
function undoneToast(result: SeatingMutationDto): ChangeOutcome["toast"] {
  const [first, second] = result.moves;
  if (!first) return null;
  if (second) return { title: "Swap undone", description: `${first.playerName} and ${second.playerName} are back in their seats.` };
  return { title: "Move undone", description: first.to ? `${first.playerName} is back at ${seatText(first.to)}.` : `${first.playerName} is waiting for a seat again.` };
}

function quietToast(change: SeatingChange, result: SeatingMutationDto): ChangeOutcome["toast"] {
  const excluded = result.excludedUnconfirmed ?? 0;
  const [first, second] = result.moves;
  if ((change.kind === "assign" || change.kind === "unseat") && change.undoing) return undoneToast(result);
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
      return first ? { title: "Player moved", description: first.from ? `${moveText(first)} (from ${seatText(first.from)})` : moveText(first) } : null;
    case "unseat":
      return first ? { title: "Player unseated", description: first.from ? `${first.playerName} left ${seatText(first.from)} and is waiting for a seat.` : `${first.playerName} is waiting for a seat.` } : null;
    case "balance":
      return { title: "Tables are already balanced" };
    case "finalTable":
      return { title: "Final table drawn", description: "Everyone was already in place." };
    case "openTable":
      return { title: "Table opened", description: "Nobody needed to move." };
    case "undoChange":
      return { title: "Change undone", description: "Everyone was already back in place." };
  }
}

/**
 * What puts a move, a swap or an unseat made by hand back: the player (for a swap, the one who was
 * moved) goes back to the seat they left, or back to waiting when they had none. It is sent against
 * the seating the change left, so once anything else has changed the server refuses it (STALE_PLAN)
 * rather than undo over someone else's change. An undo is not itself undone.
 */
function undoOf(change: SeatingChange, result: SeatingMutationDto): SeatingChange | null {
  if ((change.kind !== "assign" && change.kind !== "unseat") || change.undoing) return null;
  const moved = result.moves.find((move) => move.registrationId === change.input.registrationId);
  if (!moved) return null;
  const { registrationId } = moved;
  if (!moved.from) return { kind: "unseat", input: { registrationId }, undoing: true };
  const back = { registrationId, tableId: moved.from.tableId, seatNumber: moved.from.seatNumber, expectedVersion: result.seating.version };
  return { kind: "assign", input: { ...back, swap: result.moves.length > 1 }, undoing: true };
}

/** Who is still waiting for a seat after a break, a balance, the final table or an opened table (more arrivals than it holds). */
function stillWaiting(change: SeatingChange, seating: SeatingDto): AnnouncedMoves["waiting"] {
  if (change.kind !== "breakTable" && change.kind !== "balance" && change.kind !== "finalTable" && change.kind !== "openTable") return undefined;
  const text = waitingText(seating.stats.unseated, seating.stats.unconfirmedUnseated);
  return text ? { text, names: seating.unseated.map((entry) => playerName(entry)), openSeats: seating.stats.openSeats } : undefined;
}

/** The activity entry each change that moves players by the system's choice is logged as (shared/api/seating SEATING_CHANGE_EVENTS). */
const LOGGED_AS: Partial<Record<SeatingChange["kind"], SeatingChangeDto["eventType"]>> = {
  setup: "seating_drawn",
  draw: "seating_drawn",
  balance: "seating_balanced",
  breakTable: "table_broken",
  finalTable: "final_table",
  openTable: "table_opened",
};

/**
 * The change just made, as Undo names it: the seating's last change when it is this one (logged as
 * this kind of change, with these moves) and can still be undone. Another phone's change made in
 * between is never offered as this one's Undo.
 */
function undoableChange(change: SeatingChange, result: SeatingMutationDto): AnnouncedMoves["undoable"] {
  const last = result.seating.lastChange;
  if (!last?.canUndo || LOGGED_AS[change.kind] !== last.eventType || last.moves.length !== result.moves.length) return undefined;
  return { activityId: last.activityId, version: result.seating.version };
}

/** After a change: the moves to call out when the system chose them, else a toast saying what happened (or nothing). */
export function changeOutcome(change: SeatingChange, result: SeatingMutationDto): ChangeOutcome {
  if (result.moves.length > 0 && announcesMoves(change)) {
    const undoable = undoableChange(change, result);
    const announce: AnnouncedMoves = {
      title: announceTitle(change, result),
      moves: result.moves,
      excludedUnconfirmed: result.excludedUnconfirmed ?? 0,
      ...(undoable ? { undoable } : {}),
    };
    const waiting = stillWaiting(change, result.seating);
    return { announce: waiting ? { ...announce, waiting } : announce, toast: null, undo: null };
  }
  return { announce: null, toast: quietToast(change, result), undo: undoOf(change, result) };
}

/** A refused change's toast title (an Undo's says it could not undo). */
export function failedTitle(change: SeatingChange): string {
  if ((change.kind === "assign" || change.kind === "unseat") && change.undoing) return "Could not undo";
  return FAILED[change.kind];
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
  openTable: "Could not open the table",
  undoChange: "Could not undo",
};

/**
 * "Up to 3 tables" for the max players and seats per table typed so far (the club's default, else 9,
 * when the seats are blank): the most tables the table advisor ever plans for. Null until both are
 * numbers it could use.
 */
export function tablesNeeded(maxPlayersText: string, seatsText: string, clubSeats: number | null | undefined): string | null {
  const maxPlayers = Number(maxPlayersText.trim());
  const seats = seatsText.trim() === "" ? (clubSeats ?? SEATING_LIMITS.defaultSeats) : Number(seatsText.trim());
  if (maxPlayersText.trim() === "" || !Number.isInteger(maxPlayers) || maxPlayers < 2) return null;
  if (!Number.isInteger(seats) || seats < SEATING_LIMITS.minSeats || seats > SEATING_LIMITS.maxSeats) return null;
  return `Up to ${plural(Math.min(SEATING_LIMITS.maxActiveTables, Math.ceil(maxPlayers / seats)), "table")} of ${seats}`;
}
