/**
 * How a tournament's seating is shown (phase4-contracts §4.4): the staff SeatingDto, the public seat
 * finder and the moves a write made, all built from one SeatingState. Pure: the service loads the
 * state (server/services/seating.ts).
 */
import type {
  PublicSeatingDto,
  SeatingChangeDto,
  SeatingChangeEvent,
  SeatingDto,
  SeatMoveDto,
  SeatRefDto,
  TableDto,
  TableSeatDto,
} from "@shared/api/seating";
import {
  planBalance,
  RELEASE_REASON,
  SEATING_LIMITS,
  seatingVersion,
  suggestBreak,
  suggestFinalTable,
  suggestTables,
  tableStats,
  waitingPlayers,
  type SeatingSnapshot,
  type SeatMove,
  type SeatPos,
  type SeatSpot,
} from "@shared/domain/seating";
import type { Club, Tournament, TournamentTable } from "@shared/schema";
import type { TimedActivity } from "../repositories/activity";
import type { SeatingEntry } from "../repositories/seating";
import { isClosed, tournamentStatusOf } from "./tournament-views";

export interface SeatingState {
  /** Every table, archived ones included, by number. */
  tables: TournamentTable[];
  /** Every registration, in sign-up order. */
  entries: SeatingEntry[];
  /** What the domain plans from: the active tables, the seats of players still in, and those players. */
  snapshot: SeatingSnapshot;
}

/** The state as the TD's SeatingDto shows it: with the last seating change ("Show last moves", Undo). */
export interface StaffSeatingState extends SeatingState {
  /** The activity entry of the last table break, draw, balance or final table (or undo of one). */
  lastChange: TimedActivity | null;
}

/** The table's name, or "Table <number>". */
export const tableName = (table: Pick<TournamentTable, "name" | "tableNumber">): string => table.name ?? `Table ${table.tableNumber}`;

export function seatingState(tables: TournamentTable[], entries: SeatingEntry[], seats: SeatPos[]): SeatingState {
  return {
    tables,
    entries,
    snapshot: {
      tables: tables.map(({ id, tableNumber, seatCount, status }) => ({ id, tableNumber, seatCount, status })),
      seats,
      eligible: entries
        .filter((entry) => !entry.isEliminated)
        .map(({ registrationId, paymentConfirmed }) => ({ registrationId, paymentConfirmed })),
    },
  };
}

/**
 * What a table break, draw, balance or final table keeps in its activity entry (eventData) besides
 * its own figures: every move, named as it was then ("Show last moves"), and what undoing it needs.
 */
export interface SeatingChangeRecord {
  moves: SeatMoveDto[];
  /** The seating version it left behind and the tables it archived; absent on an undo's own entry. */
  undo: { versionAfter: string; archivedTableIds: string[] } | null;
}

const SEAT_REASONS: ReadonlySet<unknown> = new Set([...Object.keys(RELEASE_REASON), "draw", "restored"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isSeatRef(value: unknown): value is SeatRefDto | null {
  if (value === null) return true;
  return (
    isRecord(value) &&
    typeof value.tableId === "string" &&
    Number.isInteger(value.tableNumber) &&
    typeof value.tableName === "string" &&
    Number.isInteger(value.seatNumber)
  );
}

function isSeatMove(value: unknown): value is SeatMoveDto {
  return (
    isRecord(value) &&
    typeof value.registrationId === "string" &&
    typeof value.playerName === "string" &&
    isSeatRef(value.from) &&
    isSeatRef(value.to) &&
    SEAT_REASONS.has(value.reason)
  );
}

function parsed(json: string | null): unknown {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

/** The moves and undo record a seating change's entry holds; nothing for an entry without them (written before they were kept). */
export function seatingChangeOf(entry: Pick<TimedActivity, "eventData">): SeatingChangeRecord {
  const data = parsed(entry.eventData);
  if (!isRecord(data) || !Array.isArray(data.moves) || !data.moves.every(isSeatMove)) return { moves: [], undo: null };
  const undo = isRecord(data.undo) ? data.undo : null;
  const versionAfter = undo?.versionAfter;
  const archivedTableIds = undo?.archivedTableIds;
  const keepsUndo =
    typeof versionAfter === "string" && Array.isArray(archivedTableIds) && archivedTableIds.every((id): id is string => typeof id === "string");
  return { moves: data.moves, undo: keepsUndo ? { versionAfter, archivedTableIds } : null };
}

/** The last seating change as the TD's panel shows it, and whether Undo would still put everyone back. */
function lastChangeDto(tournament: Tournament, { lastChange, snapshot }: StaffSeatingState): SeatingChangeDto | null {
  if (!lastChange) return null;
  const record = seatingChangeOf(lastChange);
  return {
    activityId: lastChange.id,
    eventType: lastChange.eventType as SeatingChangeEvent,
    description: lastChange.description,
    at: new Date(lastChange.timestamp).toISOString(),
    moves: record.moves,
    canUndo: !isClosed(tournament) && record.undo !== null && record.undo.versionAfter === seatingVersion(snapshot),
  };
}

const seatKey = (spot: SeatSpot) => `${spot.tableId}:${spot.seatNumber}`;

const byName = (a: SeatingEntry, b: SeatingEntry) =>
  a.player.name.localeCompare(b.player.name, "en", { sensitivity: "base" }) || a.registrationId.localeCompare(b.registrationId);

/** Players still in who have no seat (waitingPlayers, the one rule every path uses), by name. */
function waitingEntries({ entries, snapshot }: SeatingState): SeatingEntry[] {
  const waiting = new Set(waitingPlayers(snapshot).map((player) => player.registrationId));
  return entries.filter((entry) => waiting.has(entry.registrationId)).sort(byName);
}

/** Moves as screens name them ("Alice → Table 1, Seat 3"). Every table a move names is in `state.tables`. */
export function toMoveDtos(state: SeatingState, moves: readonly SeatMove[]): SeatMoveDto[] {
  const tables = new Map(state.tables.map((table) => [table.id, table]));
  const names = new Map(state.entries.map((entry) => [entry.registrationId, entry.player.name]));
  const ref = (spot: SeatSpot | null): SeatRefDto | null => {
    if (!spot) return null;
    const table = tables.get(spot.tableId);
    if (!table) throw new Error(`INVARIANT: a move names table ${spot.tableId}, which is not this tournament's`);
    return { tableId: table.id, tableNumber: table.tableNumber, tableName: tableName(table), seatNumber: spot.seatNumber };
  };
  return moves.map((move) => ({
    registrationId: move.registrationId,
    playerName: names.get(move.registrationId) ?? "Unknown player",
    from: ref(move.from),
    to: ref(move.to),
    reason: move.reason,
  }));
}

function toTableDto(table: TournamentTable, occupants: ReadonlyMap<string, SeatingEntry>): TableDto {
  const seats: TableSeatDto[] =
    table.status === "active"
      ? Array.from({ length: table.seatCount }, (_, i) => {
          const entry = occupants.get(seatKey({ tableId: table.id, seatNumber: i + 1 }));
          return {
            seatNumber: i + 1,
            registrationId: entry?.registrationId ?? null,
            player: entry?.player ?? null,
            paymentConfirmed: entry ? entry.paymentConfirmed : null,
          };
        })
      : [];
  return {
    id: table.id,
    tableNumber: table.tableNumber,
    name: table.name,
    displayName: tableName(table),
    seatCount: table.seatCount,
    status: table.status,
    occupied: seats.filter((seat) => seat.registrationId !== null).length,
    seats,
  };
}

/** Each occupied seat ("tableId:seatNumber") with whoever sits there. */
function occupantsOf({ entries, snapshot }: SeatingState): Map<string, SeatingEntry> {
  const byId = new Map(entries.map((entry) => [entry.registrationId, entry]));
  return new Map(snapshot.seats.flatMap((seat) => {
    const entry = byId.get(seat.registrationId);
    return entry ? [[seatKey(seat), entry] as const] : [];
  }));
}

/** GET /api/tournaments/:id/seating, and the seating every write answers with. */
export function toSeatingDto(tournament: Tournament, state: StaffSeatingState): SeatingDto {
  const { tables, snapshot } = state;
  const occupants = occupantsOf(state);
  const waiting = waitingEntries(state);
  const stats = tableStats(snapshot);
  const byId = new Map(tables.map((table) => [table.id, table]));
  const suggested = suggestTables(snapshot.eligible.length, SEATING_LIMITS.defaultSeats);
  return {
    tournamentId: tournament.id,
    tournamentStatus: tournamentStatusOf(tournament),
    readOnly: isClosed(tournament),
    version: seatingVersion(snapshot),
    tables: [...tables.filter((table) => table.status === "active"), ...tables.filter((table) => table.status !== "active")].map((table) =>
      toTableDto(table, occupants),
    ),
    unseated: waiting.map(({ registrationId, player, paymentConfirmed }) => ({ registrationId, player, paymentConfirmed })),
    stats: {
      activePlayers: stats.activePlayers,
      seated: stats.seated,
      unseated: stats.unseated,
      unconfirmedUnseated: waiting.filter((entry) => !entry.paymentConfirmed).length,
      openSeats: stats.openSeats,
      capacity: stats.capacity,
      activeTables: stats.activeTables,
      maxDiff: stats.maxDiff,
    },
    suggestions: {
      balance: toMoveDtos(state, planBalance(snapshot)),
      breakTable: suggestBreak(snapshot),
      finalTable: suggestFinalTable(snapshot),
      setup: stats.activeTables === 0 ? { seatCount: SEATING_LIMITS.defaultSeats, ...suggested } : null,
    },
    seatByRegistrationId: Object.fromEntries(
      snapshot.seats.flatMap((seat) => {
        const table = byId.get(seat.tableId);
        return table ? [[seat.registrationId, { tableNumber: table.tableNumber, seatNumber: seat.seatNumber }] as const] : [];
      }),
    ),
    lastChange: lastChangeDto(tournament, state),
  };
}

/** GET /api/public/tournaments/:id/seating: active tables and the players still in, PublicPlayer only. */
export function toPublicSeatingDto(
  tournament: Pick<Tournament, "id" | "name" | "status">,
  club: Pick<Club, "id" | "name" | "slug" | "imageUrl">,
  state: SeatingState,
): PublicSeatingDto {
  const occupants = occupantsOf(state);
  const active = state.tables.filter((table) => table.status === "active");
  const tables = new Map(active.map((table) => [table.id, table]));
  const seated = state.snapshot.seats.flatMap((seat) => {
    const table = tables.get(seat.tableId);
    const entry = occupants.get(seatKey(seat));
    return table && entry ? [{ entry, table, seatNumber: seat.seatNumber }] : [];
  });
  return {
    tournament: { id: tournament.id, name: tournament.name, status: tournamentStatusOf(tournament) },
    club: { id: club.id, name: club.name, slug: club.slug, imageUrl: club.imageUrl },
    tables: active.map((table) => ({
      tableNumber: table.tableNumber,
      displayName: tableName(table),
      seatCount: table.seatCount,
      seats: Array.from({ length: table.seatCount }, (_, i) => ({
        seatNumber: i + 1,
        player: occupants.get(seatKey({ tableId: table.id, seatNumber: i + 1 }))?.player ?? null,
      })),
    })),
    players: seated
      .sort((a, b) => byName(a.entry, b.entry))
      .map(({ entry, table, seatNumber }) => ({ player: entry.player, tableNumber: table.tableNumber, tableName: tableName(table), seatNumber })),
    unseatedCount: waitingPlayers(state.snapshot).length,
  };
}
