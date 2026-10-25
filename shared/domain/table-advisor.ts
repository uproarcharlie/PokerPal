/**
 * When to open and break tables, and where a new arrival sits (round 5, items 9, 11 and 12). PURE: no
 * runtime imports outside shared/domain, no I/O; randomness is injected (see each function).
 *
 * The owner's way of running a room: start with a few tables (2 by default), fill them first, and
 * open the next table only when every open table has reached a threshold (full, by default) and
 * another player arrives; then even the tables out so they are within one player. As players bust,
 * break a table once everyone fits on one fewer, balance tables two or more apart, and draw the final
 * table once everyone fits at one. Never a room of half-empty tables, and never more tables than
 * ceil(max players / seats per table). The advisor only advises: nobody moves without the TD's tap,
 * except a new arrival, whom auto-seat sits down as they register (planAutoSeat).
 *
 * Two phases, so advice never flips back and forth: while players may still arrive and no table has
 * been broken the tournament is GROWING (the threshold opens tables; the starting tables are never
 * broken, and a later table only once the players fit on one fewer with a seat to spare at each);
 * once late registration is over, or the TD breaks a table, it is SHRINKING (tables open only for
 * players who have no seat at all, and break by seats). The final table is advised in either phase
 * once everyone fits at one table, and while growing only after someone has been knocked out.
 */
import { mulberry32, randomIndex, type Rng } from "./hash";
import {
  activeTables,
  openSeats,
  planBalance,
  SEATING_LIMITS,
  seatingVersion,
  shuffle,
  tableStats,
  waitingPlayers,
  type EligiblePlayer,
  type SeatingSnapshot,
  type SeatMove,
  type SeatPos,
  type SeatSpot,
  type SeatTable,
} from "./seating";
import { resolveTableShape, type TableShape } from "./table-layout";

// ---------------------------------------------------------------------------------------------------
// Settings

export const AUTO_SEAT_MODES = ["on_register", "once_paid", "off"] as const;
/**
 * When a new registration is seated automatically (tournaments.auto_seat; NULL is on_register): as
 * they register, once their payment is confirmed, or never (the TD seats them).
 */
export type AutoSeatMode = (typeof AUTO_SEAT_MODES)[number];

export const AUTO_SEAT_LABELS: Readonly<Record<AutoSeatMode, string>> = {
  on_register: "When they register",
  once_paid: "Once they've paid",
  off: "Off (I'll seat them)",
};

export const DEFAULT_AUTO_SEAT: AutoSeatMode = "on_register";
/** The owner's way: start with 2 tables and open more as players arrive. */
export const DEFAULT_STARTING_TABLES = 2;

export function isAutoSeatMode(value: unknown): value is AutoSeatMode {
  return typeof value === "string" && (AUTO_SEAT_MODES as readonly string[]).includes(value);
}

/** The columns the settings come from: a `Tournament` and a `Club` row fit as they are. */
export interface SeatingSettingsInput {
  tournament: {
    maxPlayers: number;
    seatsPerTable?: number | null;
    startingTables?: number | null;
    openTableAt?: number | null;
    autoSeat?: string | null;
    tableShape?: string | null;
  };
  club?: { defaultSeatsPerTable?: number | null; defaultTableShape?: string | null } | null;
}

/** A tournament's seating settings with every default filled in. */
export interface SeatingSettings {
  /** 2–10: the tournament's, else the club's default, else 9. */
  seatsPerTable: number;
  /** How many tables setup opens first: the tournament's, else 2 (1 when max players fit at one table). */
  startingTables: number;
  /** Open the next table when every open table has this many players: 1 to seatsPerTable (full by default). */
  openTableAt: number;
  autoSeat: AutoSeatMode;
  tableShape: TableShape;
  maxPlayers: number;
  /** ceil(maxPlayers / seatsPerTable): the most tables the advisor ever plans for. */
  maxTables: number;
}

const wholeIn = (value: number | null | undefined, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

/** Each stored value when it is in range, else its default (a value out of range is read as unset). */
export function resolveSeatingSettings({ tournament, club }: SeatingSettingsInput): SeatingSettings {
  const seatsPerTable =
    wholeIn(tournament.seatsPerTable, SEATING_LIMITS.minSeats, SEATING_LIMITS.maxSeats) ??
    wholeIn(club?.defaultSeatsPerTable, SEATING_LIMITS.minSeats, SEATING_LIMITS.maxSeats) ??
    SEATING_LIMITS.defaultSeats;
  const maxPlayers = Math.max(1, Math.floor(tournament.maxPlayers) || 1);
  const maxTables = Math.min(SEATING_LIMITS.maxActiveTables, Math.ceil(maxPlayers / seatsPerTable));
  return {
    seatsPerTable,
    startingTables: wholeIn(tournament.startingTables, 1, SEATING_LIMITS.maxActiveTables) ?? Math.min(DEFAULT_STARTING_TABLES, maxTables),
    openTableAt: wholeIn(tournament.openTableAt, 1, seatsPerTable) ?? seatsPerTable,
    autoSeat: isAutoSeatMode(tournament.autoSeat) ? tournament.autoSeat : DEFAULT_AUTO_SEAT,
    tableShape: resolveTableShape(tournament.tableShape, club?.defaultTableShape),
    maxPlayers,
    maxTables,
  };
}

/**
 * Why a tournament's seating settings, as they would be after a change, cannot be kept: an open-table
 * threshold above the seats per table in force (400 VALIDATION on openTableAt). Null when they can.
 */
export function seatingSettingsProblem(input: SeatingSettingsInput): { field: "openTableAt"; message: string } | null {
  const { seatsPerTable } = resolveSeatingSettings(input);
  const at = input.tournament.openTableAt;
  if (typeof at === "number" && at > seatsPerTable) {
    return { field: "openTableAt", message: `Open the next table at ${seatsPerTable} players or fewer (the seats per table)` };
  }
  return null;
}

/**
 * How many tables setup opens for `players` registered so far: the starting tables, or more when
 * those cannot take everyone at the threshold (30 players at a threshold of 9 need 4), never more than
 * the tournament's tables (ceil(max players / seats)) unless the players already need them (staff can
 * register extras), and 1 to 50.
 */
export function setupTableCount(settings: SeatingSettings, players: number): number {
  const count = Math.max(0, Math.floor(players));
  const needed = Math.ceil(count / settings.seatsPerTable);
  const wanted = Math.max(settings.startingTables, Math.ceil(count / settings.openTableAt));
  return Math.min(SEATING_LIMITS.maxActiveTables, Math.max(1, Math.min(wanted, Math.max(settings.maxTables, needed))));
}

/** The number a table opened next gets: one past the highest ever used (archived tables keep theirs). */
export function nextTableNumber(tables: readonly Pick<SeatTable, "tableNumber">[]): number {
  return tables.reduce((highest, table) => Math.max(highest, table.tableNumber), 0) + 1;
}

// ---------------------------------------------------------------------------------------------------
// Auto-seat (item 9)

/** Why a new registration was not seated automatically. */
export type AutoSeatSkip =
  /** The tournament's setting is off. */
  | "off"
  /** "Once they've paid", and their payment is not confirmed yet. */
  | "awaiting_payment"
  /** No table is in play yet: setup will seat them. */
  | "no_tables"
  /** Every seat at every open table is taken: the TD should open a table. */
  | "tables_full"
  /** They are out of the tournament (or not in it). */
  | "not_eligible"
  /** They already have a seat. */
  | "already_seated";

/** A planned auto-seat always sits the player down somewhere: its move has a destination. */
export type AutoSeatPlan = { ok: true; move: SeatMove & { from: null; to: SeatSpot } } | { ok: false; skip: AutoSeatSkip };

/** Whether `mode` seats a registration now: "seat", or why not. */
export function autoSeatDecision(mode: AutoSeatMode, paymentConfirmed: boolean): "seat" | "off" | "awaiting_payment" {
  if (mode === "off") return "off";
  if (mode === "once_paid" && !paymentConfirmed) return "awaiting_payment";
  return "seat";
}

/**
 * Seats one new arrival (item 9): at the open table with the fewest players that has an empty seat
 * (ties: the one with more empty seats, then at random), in a random empty seat there, so the tables
 * stay balanced as players roll in. Auto-seat never opens a table: with every seat taken the player
 * waits ("tables_full") and the advisor says to open one. `rng` is the server's crypto randomness.
 */
export function planAutoSeat(snapshot: SeatingSnapshot, registrationId: string, rng: Rng): AutoSeatPlan {
  if (!snapshot.eligible.some((player) => player.registrationId === registrationId)) return { ok: false, skip: "not_eligible" };
  if (snapshot.seats.some((seat) => seat.registrationId === registrationId)) return { ok: false, skip: "already_seated" };
  const tables = activeTables(snapshot.tables);
  if (tables.length === 0) return { ok: false, skip: "no_tables" };
  const open = openSeats(tables, snapshot.seats);
  const withRoom = tables
    .map((table) => ({ table, occupied: snapshot.seats.filter((seat) => seat.tableId === table.id).length, free: open.get(table.id) ?? [] }))
    .filter((candidate) => candidate.free.length > 0);
  if (withRoom.length === 0) return { ok: false, skip: "tables_full" };
  const fewest = Math.min(...withRoom.map((candidate) => candidate.occupied));
  const least = withRoom.filter((candidate) => candidate.occupied === fewest);
  const roomiest = Math.max(...least.map((candidate) => candidate.free.length));
  const choices = least.filter((candidate) => candidate.free.length === roomiest);
  const chosen = choices[randomIndex(rng, choices.length)];
  const seatNumber = chosen.free[randomIndex(rng, chosen.free.length)];
  return { ok: true, move: { registrationId, from: null, to: { tableId: chosen.table.id, seatNumber }, reason: "auto_seat" } };
}

// ---------------------------------------------------------------------------------------------------
// Who the advisor counts

/**
 * The players still in who should have a seat: everyone seated, and everyone waiting for one, except
 * (with "once they've paid") those who have not paid: they registered but have not arrived, and must
 * not make the advisor open tables for no-shows.
 */
function seatablePlayers(snapshot: SeatingSnapshot, settings: Pick<SeatingSettings, "autoSeat">): { waiting: EligiblePlayer[]; notArrived: EligiblePlayer[] } {
  const waiting = waitingPlayers(snapshot);
  if (settings.autoSeat !== "once_paid") return { waiting, notArrived: [] };
  return { waiting: waiting.filter((player) => player.paymentConfirmed), notArrived: waiting.filter((player) => !player.paymentConfirmed) };
}

// ---------------------------------------------------------------------------------------------------
// Opening a table (item 11)

/** The id the advisor's preview gives the table it would open (the server inserts the real row). */
export const NEW_TABLE_ID = "new-table";

/**
 * How many players each table should hold to share `players` within one of each other, no table over
 * its capacity: the level L where every table holds min(capacity, L), and the players left over add
 * one each to the tables that have room, those holding the most players now first (fewest moves).
 */
function targetSizes(tables: ReadonlyArray<{ capacity: number; occupied: number; order: number }>, players: number): number[] {
  const capacity = tables.reduce((sum, table) => sum + table.capacity, 0);
  const total = Math.min(players, capacity);
  let level = 0;
  while (tables.reduce((sum, table) => sum + Math.min(table.capacity, level + 1), 0) <= total && level < SEATING_LIMITS.maxSeats) level++;
  const targets = tables.map((table) => Math.min(table.capacity, level));
  let left = total - targets.reduce((sum, target) => sum + target, 0);
  const byClaim = tables
    .map((table, index) => ({ ...table, index }))
    .filter((table) => table.capacity > level)
    .sort((a, b) => b.occupied - a.occupied || a.order - b.order);
  for (const table of byClaim) {
    if (left === 0) break;
    targets[table.index] += 1;
    left -= 1;
  }
  return targets;
}

export interface OpenTablePlan {
  /** Every move: players moved from the fullest tables to the new one (reason open_table, released as "balanced"), and waiting players seated. */
  moves: SeatMove[];
  /** Players at each active table afterwards, the new one last: "7 / 7 / 7". */
  sizes: number[];
  /** Waiting players there was still no seat for (more arrivals than even the new table holds). */
  stillWaiting: string[];
}

/**
 * Opens `table` (a new, empty table not in `snapshot`): seats the waiting players (sign-up order;
 * those not arrived yet under "once they've paid" left out) and evens every table out to within one
 * player, moving players from the fullest tables, so 10 / 10 with 1 arrival becomes 7 / 7 / 7. Who
 * moves is deterministic (from each table that must shed players, the ones in its highest seats, as
 * Balance moves them); the seats they and the waiting players take are drawn with `rng`. The advisor's
 * preview and the server's Apply use the same `openTableRng(snapshot)`, so Apply does what was shown.
 */
export function planOpenTable(snapshot: SeatingSnapshot, settings: Pick<SeatingSettings, "autoSeat">, table: SeatTable, rng: Rng): OpenTablePlan {
  const existing = activeTables(snapshot.tables).filter((candidate) => candidate.id !== table.id);
  const tables = [...existing, { ...table, status: "active" as const }];
  const { waiting } = seatablePlayers(snapshot, settings);
  const occupiedOf = (id: string) => snapshot.seats.filter((seat) => seat.tableId === id).length;
  const players = snapshot.seats.length + waiting.length;
  const targets = targetSizes(
    tables.map((candidate, order) => ({ capacity: candidate.seatCount, occupied: candidate.id === table.id ? 0 : occupiedOf(candidate.id), order })),
    players,
  );

  const seats: SeatPos[] = snapshot.seats.map((seat) => ({ ...seat }));
  const movers: SeatPos[] = [];
  existing.forEach((candidate, index) => {
    const here = seats.filter((seat) => seat.tableId === candidate.id).sort((a, b) => b.seatNumber - a.seatNumber);
    movers.push(...here.slice(0, Math.max(0, here.length - targets[index])));
  });
  const leaving = new Set(movers.map((seat) => seat.registrationId));
  const staying = seats.filter((seat) => !leaving.has(seat.registrationId));

  // Fill the new table first with the players moved off the full tables, then any table still short with the waiting players.
  const order = [tables.length - 1, ...existing.map((_, index) => index)];
  const incoming: Array<{ registrationId: string; from: SeatPos | null }> = [
    ...movers.map((seat) => ({ registrationId: seat.registrationId, from: seat })),
    ...waiting.map((player) => ({ registrationId: player.registrationId, from: null })),
  ];
  const moves: SeatMove[] = [];
  const placed: SeatPos[] = [...staying];
  let next = 0;
  for (const index of order) {
    const destination = tables[index];
    const free = shuffle(openSeats([destination], placed).get(destination.id) ?? [], rng);
    let room = targets[index] - placed.filter((seat) => seat.tableId === destination.id).length;
    while (room > 0 && next < incoming.length) {
      const player = incoming[next++];
      const seatNumber = free.shift() as number;
      placed.push({ registrationId: player.registrationId, tableId: destination.id, seatNumber });
      moves.push({
        registrationId: player.registrationId,
        from: player.from ? { tableId: player.from.tableId, seatNumber: player.from.seatNumber } : null,
        to: { tableId: destination.id, seatNumber },
        reason: "open_table",
      });
      room--;
    }
  }
  return {
    moves,
    sizes: tables.map((candidate) => placed.filter((seat) => seat.tableId === candidate.id).length),
    stillWaiting: incoming.slice(next).map((player) => player.registrationId),
  };
}

/** The seeded randomness an open-table plan draws seats with: the same for the preview and for Apply while the seating is unchanged. */
export function openTableRng(snapshot: SeatingSnapshot): Rng {
  return mulberry32(Number.parseInt(seatingVersion(snapshot), 16));
}

// ---------------------------------------------------------------------------------------------------
// The advisor (item 11)

export type TableAdviceKind = "open_table" | "seat_waiting" | "final_table" | "break_table" | "balance";

export interface TableAdvice {
  kind: TableAdviceKind;
  /** One plain sentence: "17 players fit on 2 tables of 9: break Table 3". */
  message: string;
  /** The table to break, or to draw the final table at; NEW_TABLE_ID for the table to open; null for the others. */
  tableId: string | null;
  /** That table's number (the new table's: nextTableNumber). */
  tableNumber: number | null;
  /**
   * What Apply would do: open_table, the whole plan (the new table's seats under NEW_TABLE_ID);
   * balance, planBalance. Empty for break, final table and seating the waiting, whose seats are drawn
   * at random when applied (`players` says how many sit down or move).
   */
  moves: SeatMove[];
  /** How many players the advice seats or moves. */
  players: number;
}

export type SeatingPhase = "growing" | "shrinking";

/** What the advisor needs to know about the field beyond the seating. */
export interface AdvisorContext {
  /**
   * Players knocked out so far. Until someone is, a growing room that fits at one table is still
   * filling (8 early arrivals at the 2 starting tables), not at its final table. Default 0.
   */
  busted?: number;
  /**
   * Whether players may still arrive (lateRegistrationOpen). Once late registration is over the room
   * only shrinks, though no table has been broken yet. Default true.
   */
  lateRegistrationOpen?: boolean;
  /** Sign-ups on the waiting list (round 5, item 15: beyond max players, not accepted): never counted, only flagged. Default 0. */
  waitingList?: number;
}

export interface TableAdvisorResult {
  phase: SeatingPhase;
  /** The players the advice counts: everyone seated and everyone waiting who has arrived. */
  players: number;
  /** Waiting for a seat (and counted). */
  waiting: number;
  /** "Once they've paid": registered, not paid and not seated, so not counted (shown as "not arrived yet"). */
  notArrived: number;
  /** Sign-ups on the waiting list behind a full field (AdvisorContext.waitingList); shown as a flag. */
  overCapacity: number;
  /** Most urgent first; the first is the banner. Empty when there is nothing to do. */
  advice: TableAdvice[];
}

/**
 * Whether players may still sign up and sit down: always before the game starts; while it is in
 * progress, until the clock passes the re-buy period when the tournament has one (the late
 * registration window at the clubs that use the app), else for as long as it runs (sign-ups stay open
 * while a game is in progress). Never once it is completed or cancelled. `clockElapsedMs` is the
 * clock's time since level 1 began, null without a clock.
 */
export function lateRegistrationOpen(
  tournament: { status?: string | null; rebuyPeriodMinutes?: number | null },
  clockElapsedMs: number | null,
): boolean {
  const status = tournament.status ?? "registration";
  if (status === "completed" || status === "cancelled") return false;
  if (status !== "in_progress") return true;
  const period = tournament.rebuyPeriodMinutes;
  if (typeof period !== "number" || !Number.isFinite(period) || clockElapsedMs === null) return true;
  return clockElapsedMs < period * 60_000;
}

const playersText = (count: number) => (count === 1 ? "1 player" : `${count} players`);
const tablesText = (count: number) => (count === 1 ? "1 table" : `${count} tables`);
const tableName = (table: Pick<SeatTable, "tableNumber">) => `Table ${table.tableNumber}`;

/**
 * What the TD should do with the tables now, from the seating, the settings and the field (`context`).
 * Rules, most urgent first:
 * - open_table: players with no seat and no seat for them; or, while growing, more players than every
 *   table's threshold together (and fewer tables than the tournament's maximum). The plan seats the
 *   waiting and evens everyone out (planOpenTable).
 * - seat_waiting: players waiting while seats are open (auto-seat is off, or they arrived before the tables).
 * - final_table: two or more tables, and everyone fits at the biggest one; while growing, only once
 *   someone has been knocked out (R5REV-HOST-01: a night that stays on its starting tables still gets it).
 * - break_table: everyone fits on one fewer table: by seats when shrinking; while growing, only above
 *   the starting tables, and with a seat to spare at each table left under the threshold, so the first
 *   bust after a table opens never asks to break it again (R5REV-HOST-02). The table with the fewest
 *   players (ties: the highest number), as Break picks it.
 * - balance: two tables two or more players apart (planBalance).
 */
export function adviseTables(snapshot: SeatingSnapshot, settings: SeatingSettings, context: AdvisorContext = {}): TableAdvisorResult {
  const tables = activeTables(snapshot.tables);
  const broken = snapshot.tables.some((table) => table.status === "broken");
  const phase: SeatingPhase = broken || context.lateRegistrationOpen === false ? "shrinking" : "growing";
  const { waiting, notArrived } = seatablePlayers(snapshot, settings);
  const stats = tableStats(snapshot);
  const players = snapshot.seats.length + waiting.length;
  const result: TableAdvisorResult = {
    phase,
    players,
    waiting: waiting.length,
    notArrived: notArrived.length,
    overCapacity: Math.max(0, context.waitingList ?? 0),
    advice: [],
  };
  if (tables.length === 0) return result;

  const advice = result.advice;
  const thresholds = tables.reduce((sum, table) => sum + Math.min(settings.openTableAt, table.seatCount), 0);
  const mustOpen = waiting.length > stats.openSeats;
  const shouldOpen = phase === "growing" && players > thresholds && tables.length < settings.maxTables;
  if ((mustOpen || shouldOpen) && tables.length < SEATING_LIMITS.maxActiveTables) {
    const number = nextTableNumber(snapshot.tables);
    const plan = planOpenTable(snapshot, settings, { id: NEW_TABLE_ID, tableNumber: number, seatCount: settings.seatsPerTable, status: "active" }, openTableRng(snapshot));
    const why = mustOpen
      ? `Every table is full and ${playersText(waiting.length - stats.openSeats)} ${waiting.length - stats.openSeats === 1 ? "is" : "are"} waiting`
      : settings.openTableAt >= settings.seatsPerTable
        ? `Every table is full (${playersText(players)} in all)`
        : `Every table has ${settings.openTableAt} or more players (${playersText(players)} in all)`;
    advice.push({
      kind: "open_table",
      message: `${why}: open Table ${number} and even the tables out to ${plan.sizes.join(" / ")}`,
      tableId: NEW_TABLE_ID,
      tableNumber: number,
      moves: plan.moves,
      players: plan.moves.length,
    });
  } else if (waiting.length > 0 && stats.openSeats > 0) {
    const seating = Math.min(waiting.length, stats.openSeats);
    advice.push({
      kind: "seat_waiting",
      message: `${playersText(waiting.length)} ${waiting.length === 1 ? "is" : "are"} waiting and ${stats.openSeats === 1 ? "1 seat is" : `${stats.openSeats} seats are`} open: seat ${waiting.length === 1 ? "them" : seating === waiting.length ? "them" : `${seating} of them`}`,
      tableId: null,
      tableNumber: null,
      moves: [],
      players: seating,
    });
  }

  // Opening a table and taking one away never go together.
  const fewerTables = tables.length >= 2 && !advice.some((item) => item.kind === "open_table");
  const growing = phase === "growing";
  const biggest = tables.reduce((best, table) => (table.seatCount > best.seatCount || (table.seatCount === best.seatCount && table.tableNumber < best.tableNumber) ? table : best));
  const fitsAtOne = players > 0 && players <= biggest.seatCount;
  if (fewerTables && fitsAtOne && (!growing || (context.busted ?? 0) > 0)) {
    advice.push({
      kind: "final_table",
      message: `${playersText(players)} fit at one table: draw the final table at ${tableName(biggest)}`,
      tableId: biggest.id,
      tableNumber: biggest.tableNumber,
      moves: [],
      players,
    });
  } else if (fewerTables && !(growing && tables.length <= settings.startingTables)) {
    // While filling, the starting tables stay, and a later table goes only with a seat to spare under
    // the threshold at each table left: one bust after opening Table 3 (19 → 18) never undoes it.
    const counts = stats.perTable;
    const fewest = counts.reduce((best, table) =>
      table.occupied < best.occupied || (table.occupied === best.occupied && table.tableNumber > best.tableNumber) ? table : best,
    );
    const others = tables.filter((table) => table.id !== fewest.tableId);
    const room = others.reduce((sum, table) => sum + (growing ? Math.min(settings.openTableAt, table.seatCount) - 1 : table.seatCount), 0);
    if (players <= room) {
      advice.push({
        kind: "break_table",
        message: `${playersText(players)} fit on ${tablesText(others.length)} of ${settings.seatsPerTable}: break Table ${fewest.tableNumber}`,
        tableId: fewest.tableId,
        tableNumber: fewest.tableNumber,
        moves: [],
        players: fewest.occupied,
      });
    }
  }

  if (!advice.some((item) => item.kind === "open_table" || item.kind === "final_table" || item.kind === "break_table") && stats.maxDiff >= 2) {
    const moves = planBalance(snapshot);
    if (moves.length > 0) {
      const counts = stats.perTable.map((table) => table.occupied);
      advice.push({
        kind: "balance",
        message: `Tables are ${Math.max(...counts)} and ${Math.min(...counts)} players: balance them (${moves.length === 1 ? "1 move" : `${moves.length} moves`})`,
        tableId: null,
        tableNumber: null,
        moves,
        players: moves.length,
      });
    }
  }
  return result;
}
