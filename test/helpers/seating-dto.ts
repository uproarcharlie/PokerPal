/**
 * Seating bodies for the web tests (U-SEAT): a seating described by its tables and who sits where, and
 * built into SeatingDto / PublicSeatingDto with every derived figure (counts, open seats, the Seat column)
 * worked out as the server does, so a test states only the scenario. MSW helpers record what the panel
 * sent.
 */
import { http, HttpResponse } from "msw";
import type { PublicPlayer } from "@shared/api/public";
import type { PublicSeatingDto, SeatingDto, SeatingMutationDto, SeatMoveDto, SeatRefDto, TableAdviceDto, TableDto } from "@shared/api/seating";
import type { SeatingSnapshot, SeatMove, SeatReason } from "@shared/domain/seating";
import { adviseTables, resolveSeatingSettings, setupTableCount, type AdvisorContext, type SeatingSettings } from "@shared/domain/table-advisor";
import type { TableShape } from "@shared/domain/table-layout";
import type { TournamentStatus } from "@shared/domain/tournaments";
import { server } from "../msw/server";
import { recordRequests } from "./requests";

/** Someone in a seat (or waiting): their registration, name, and whether they have paid (default yes). */
export interface EntrySpec {
  id: string;
  name: string;
  paid?: boolean;
  imageUrl?: string | null;
}

export interface TableSpec {
  id: string;
  number: number;
  name?: string | null;
  seats?: number;
  shape?: TableShape;
  status?: "active" | "broken";
  /** Who sits where: seat number → entry (empty seats left out). */
  seated?: Partial<Record<number, EntrySpec>>;
}

export interface SeatingSpec {
  tournamentId?: string;
  tables?: TableSpec[];
  unseated?: EntrySpec[];
  readOnly?: boolean;
  tournamentStatus?: TournamentStatus;
  version?: string;
  suggestions?: Partial<SeatingDto["suggestions"]>;
  lastChange?: SeatingDto["lastChange"];
  /** Default: a 40-player tournament's defaults (9 seats, 2 starting tables, open when full, seat on sign-up, oval). */
  settings?: Partial<SeatingDto["settings"]>;
  /** Default: no advice, the counts from the tables and the waiting. */
  advisor?: Partial<SeatingDto["advisor"]>;
}

export const seatPlayer = (entry: EntrySpec): PublicPlayer => ({ id: `p-${entry.id}`, name: entry.name, imageUrl: entry.imageUrl ?? null });

const displayName = (table: TableSpec) => table.name ?? `Table ${table.number}`;

export function tableDto(table: TableSpec): TableDto {
  const seatCount = table.seats ?? 9;
  const status = table.status ?? "active";
  const seated = table.seated ?? {};
  const seats =
    status === "active"
      ? Array.from({ length: seatCount }, (_, i) => {
          const entry = seated[i + 1];
          return entry
            ? { seatNumber: i + 1, registrationId: entry.id, player: seatPlayer(entry), paymentConfirmed: entry.paid ?? true }
            : { seatNumber: i + 1, registrationId: null, player: null, paymentConfirmed: null };
        })
      : [];
  return {
    id: table.id,
    tableNumber: table.number,
    name: table.name ?? null,
    displayName: displayName(table),
    seatCount,
    shape: table.shape ?? "oval",
    status,
    occupied: seats.filter((seat) => seat.registrationId !== null).length,
    seats,
  };
}

/** The TD's seating for `spec`: active tables by number, then archived; the unseated by name; the figures. */
export function seatingDto(spec: SeatingSpec = {}): SeatingDto {
  const tables = (spec.tables ?? []).map(tableDto).sort((a, b) => (a.status === b.status ? a.tableNumber - b.tableNumber : a.status === "active" ? -1 : 1));
  const active = tables.filter((table) => table.status === "active");
  const unseated = [...(spec.unseated ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ registrationId: entry.id, player: seatPlayer(entry), paymentConfirmed: entry.paid ?? true }));
  const seated = active.reduce((sum, table) => sum + table.occupied, 0);
  const capacity = active.reduce((sum, table) => sum + table.seatCount, 0);
  const counts = active.map((table) => table.occupied);
  const activePlayers = seated + unseated.length;
  const seatByRegistrationId: SeatingDto["seatByRegistrationId"] = {};
  for (const table of active) {
    for (const seat of table.seats) if (seat.registrationId) seatByRegistrationId[seat.registrationId] = { tableNumber: table.tableNumber, seatNumber: seat.seatNumber };
  }
  const settings: SeatingSettings = { ...resolveSeatingSettings({ tournament: { maxPlayers: 40 } }), ...spec.settings };
  const setup = active.length === 0 ? setupSuggestion(settings, activePlayers) : null;
  return {
    tournamentId: spec.tournamentId ?? "t1",
    tournamentStatus: spec.tournamentStatus ?? (spec.readOnly ? "completed" : "in_progress"),
    readOnly: spec.readOnly ?? false,
    version: spec.version ?? "0badc0de",
    tables,
    unseated,
    stats: {
      activePlayers,
      seated,
      unseated: unseated.length,
      unconfirmedUnseated: unseated.filter((entry) => !entry.paymentConfirmed).length,
      openSeats: capacity - seated,
      capacity,
      activeTables: active.length,
      maxDiff: counts.length > 1 ? Math.max(...counts) - Math.min(...counts) : 0,
    },
    suggestions: { balance: [], breakTable: null, finalTable: null, setup, ...spec.suggestions },
    settings,
    advisor: { phase: "growing", players: activePlayers, waiting: unseated.length, notArrived: 0, overCapacity: 0, advice: [], ...spec.advisor },
    seatByRegistrationId,
    lastChange: spec.lastChange ?? null,
  };
}

/** What the server's setup suggestion is for `players` (server/services/seating-views setupSuggestion). */
function setupSuggestion(settings: SeatingSettings, players: number): NonNullable<SeatingDto["suggestions"]["setup"]> {
  const tableCount = setupTableCount(settings, players);
  const seated = Math.min(players, tableCount * settings.seatsPerTable);
  return {
    seatCount: settings.seatsPerTable,
    tableCount,
    perTable: Array.from({ length: tableCount }, (_, i) => Math.floor(seated / tableCount) + (i < seated % tableCount ? 1 : 0)),
  };
}

/**
 * `spec`'s seating with the table advisor's real advice (shared/domain/table-advisor adviseTables, as
 * the server works it out), its moves named as the server names them: for tests of the advice banner
 * that should hold whatever the advisor's rules say.
 */
export function advisedSeatingDto(spec: SeatingSpec = {}, context: AdvisorContext = {}): SeatingDto {
  const seating = seatingDto(spec);
  const active = seating.tables.filter((table) => table.status === "active");
  const snapshot: SeatingSnapshot = {
    tables: seating.tables.map(({ id, tableNumber, seatCount, status }) => ({ id, tableNumber, seatCount, status })),
    seats: active.flatMap((table) => table.seats.flatMap((seat) => (seat.registrationId ? [{ registrationId: seat.registrationId, tableId: table.id, seatNumber: seat.seatNumber }] : []))),
    eligible: [
      ...active.flatMap((table) => table.seats.flatMap((seat) => (seat.registrationId ? [{ registrationId: seat.registrationId, paymentConfirmed: seat.paymentConfirmed !== false }] : []))),
      ...seating.unseated.map((entry) => ({ registrationId: entry.registrationId, paymentConfirmed: entry.paymentConfirmed })),
    ],
  };
  const names = new Map([
    ...active.flatMap((table) => table.seats.flatMap((seat) => (seat.registrationId && seat.player ? [[seat.registrationId, seat.player.name] as const] : []))),
    ...seating.unseated.map((entry) => [entry.registrationId, entry.player.name] as const),
  ]);
  const result = adviseTables(snapshot, seating.settings, context);
  const ref = (spot: SeatMove["from"], newTable: number | null) => {
    if (!spot) return null;
    const table = seating.tables.find((candidate) => candidate.id === spot.tableId);
    const tableNumber = table?.tableNumber ?? newTable ?? 0;
    // The table the advice would open is not in the seating yet: it is named as it will be ("Table 3", under NEW_TABLE_ID).
    return seatRef(spot.tableId, tableNumber, spot.seatNumber, table?.displayName ?? `Table ${tableNumber}`);
  };
  return {
    ...seating,
    advisor: {
      ...result,
      advice: result.advice.map((advice) => ({
        ...advice,
        moves: advice.moves.map((move) => seatMove(move.registrationId, names.get(move.registrationId) ?? "Unknown player", ref(move.from, advice.tableNumber), ref(move.to, advice.tableNumber), move.reason)),
      })),
    },
  };
}

/** A seat as moves name it. */
export const seatRef = (tableId: string, tableNumber: number, seatNumber: number, tableName = `Table ${tableNumber}`): SeatRefDto => ({
  tableId,
  tableNumber,
  tableName,
  seatNumber,
});

export const seatMove = (registrationId: string, playerName: string, from: SeatRefDto | null, to: SeatRefDto | null, reason: SeatReason): SeatMoveDto => ({
  registrationId,
  playerName,
  from,
  to,
  reason,
});

/** One piece of the table advisor's advice, as the server words it. */
export const tableAdvice = (kind: TableAdviceDto["kind"], message: string, rest: Partial<TableAdviceDto> = {}): TableAdviceDto => ({
  kind,
  message,
  tableId: null,
  tableNumber: null,
  moves: [],
  players: 0,
  ...rest,
});

export const seatingMutation = (seating: SeatingDto, moves: SeatMoveDto[] = [], extra: Partial<SeatingMutationDto> = {}): SeatingMutationDto => ({ seating, moves, ...extra });

/** What anyone sees of `spec` on the seat finder: active tables, and every seated player by name. */
export function publicSeatingDto(spec: SeatingSpec & { tournamentName?: string } = {}): PublicSeatingDto {
  const seating = seatingDto(spec);
  const active = seating.tables.filter((table) => table.status === "active");
  return {
    tournament: { id: seating.tournamentId, name: spec.tournamentName ?? "Friday Freezeout", status: seating.tournamentStatus },
    club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null, theme: null },
    tables: active.map((table) => ({
      tableNumber: table.tableNumber,
      displayName: table.displayName,
      seatCount: table.seatCount,
      shape: table.shape,
      seats: table.seats.map((seat) => ({ seatNumber: seat.seatNumber, player: seat.player })),
    })),
    players: active
      .flatMap((table) =>
        table.seats.flatMap((seat) =>
          seat.player ? [{ player: seat.player, tableNumber: table.tableNumber, tableName: table.displayName, seatNumber: seat.seatNumber }] : [],
        ),
      )
      .sort((a, b) => a.player.name.localeCompare(b.player.name)),
    unseatedCount: seating.stats.unseated,
  };
}

/** GET /api/tournaments/:id/seating answers `seating` (staff). */
export function mockSeating(seating: SeatingDto, tournamentId = "t1"): void {
  server.use(http.get(`/api/tournaments/${tournamentId}/seating`, () => HttpResponse.json(seating)));
}

/**
 * A seating write at `path` answers `respond()` (each time it is asked), and records the bodies sent,
 * in order. A DELETE records `null`.
 */
export function recordWrite(method: "post" | "patch" | "delete", path: string, respond: () => Response | Promise<Response>): unknown[] {
  return recordRequests([[method, path]], () => respond(), (sent) => sent.body ?? null);
}
