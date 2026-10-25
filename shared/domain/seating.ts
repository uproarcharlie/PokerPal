/**
 * Table seating for one tournament: drawing seats, balancing tables, breaking a table, the final
 * table, moving and swapping players, and the checks every plan must pass. PURE: no runtime imports
 * but ./hash, no I/O; randomness is injected (the server passes crypto randomness, tests a seeded
 * PRNG), so every plan can be reproduced.
 *
 * A plan is a list of SeatMoves the server persists in one transaction: it releases every `from`
 * first (released_at + the move's release reason), then inserts every `to`, so two players can trade
 * seats. Balancing is deterministic (spec D5): the suggestion shown between polls is exactly what
 * Apply does. The snapshot a plan reads holds only ACTIVE seats on ACTIVE tables of players still in
 * (the server filters out a busted player's seat even before it is released).
 */
import { fnv1aHex, randomIndex, type Rng } from "./hash";

export const SEATING_LIMITS = {
  minSeats: 2,
  maxSeats: 10,
  defaultSeats: 9,
  maxTableNumber: 999,
  /** Active tables per tournament (archived ones do not count). */
  maxActiveTables: 50,
} as const;

/** Why a player was put in, or taken out of, a seat. */
export type SeatReason = "draw" | "redraw" | "move" | "swap" | "balance" | "table_broken" | "final_table" | "unseat" | "eliminated" | "restored";

export const RELEASE_REASONS = ["eliminated", "moved", "swapped", "balanced", "table_broken", "redraw", "final_table", "unseated"] as const;
/** tournament_seats.release_reason: why a seat row stopped being the player's seat. */
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

/** The release reason a move's `from` seat is stored with. */
export const RELEASE_REASON: Readonly<Record<Exclude<SeatReason, "draw" | "restored">, ReleaseReason>> = {
  redraw: "redraw",
  move: "moved",
  swap: "swapped",
  balance: "balanced",
  table_broken: "table_broken",
  final_table: "final_table",
  unseat: "unseated",
  eliminated: "eliminated",
};

export interface SeatTable {
  id: string;
  tableNumber: number;
  seatCount: number;
  status: "active" | "broken";
}

export interface SeatSpot {
  tableId: string;
  seatNumber: number;
}

export interface SeatPos extends SeatSpot {
  registrationId: string;
}

/** A player still in the tournament (not eliminated), who may be seated. */
export interface EligiblePlayer {
  registrationId: string;
  paymentConfirmed: boolean;
}

export interface SeatingSnapshot {
  tables: SeatTable[];
  /** Active seats on active tables, of eligible players only. */
  seats: SeatPos[];
  eligible: EligiblePlayer[];
}

export interface SeatMove {
  registrationId: string;
  from: SeatSpot | null;
  to: SeatSpot | null;
  reason: SeatReason;
}

export type SeatingProblem =
  | "NO_TABLES"
  | "INSUFFICIENT_SEATS"
  | "SEAT_TAKEN"
  | "SEAT_OUT_OF_RANGE"
  | "PLAYER_NOT_ACTIVE"
  | "TABLE_NOT_ACTIVE"
  | "NOT_SEATED"
  | "LAST_TABLE";

export type SeatingPlan =
  | { ok: true; moves: SeatMove[]; archiveTableIds: string[] }
  | { ok: false; problem: SeatingProblem; message: string; details?: Record<string, unknown> };

const planned = (moves: SeatMove[], archiveTableIds: string[] = []): SeatingPlan => ({ ok: true, moves, archiveTableIds });
const refused = (problem: SeatingProblem, message: string, details?: Record<string, unknown>): SeatingPlan => ({
  ok: false,
  problem,
  message,
  ...(details ? { details } : {}),
});

const sameSpot = (a: SeatSpot | null, b: SeatSpot | null) => a !== null && b !== null && a.tableId === b.tableId && a.seatNumber === b.seatNumber;

/** A shuffled copy (Fisher–Yates). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomIndex(rng, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** The active tables, by table number. */
export function activeTables(tables: readonly SeatTable[]): SeatTable[] {
  return tables.filter((table) => table.status === "active").sort((a, b) => a.tableNumber - b.tableNumber);
}

/**
 * A fingerprint of the active tables and who sits where, 8 hex digits. Balance sends the version its
 * suggestion was made from and is refused (STALE_PLAN) when seating changed since. Order-independent.
 */
export function seatingVersion(snapshot: Pick<SeatingSnapshot, "tables" | "seats">): string {
  const tables = snapshot.tables
    .filter((table) => table.status === "active")
    .map((table) => `${table.id}:${table.seatCount}`)
    .sort();
  const seats = snapshot.seats.map((seat) => `${seat.tableId}:${seat.seatNumber}:${seat.registrationId}`).sort();
  return fnv1aHex(`${tables.join("|")}#${seats.join("|")}`);
}

/** Each active table's empty seat numbers, ascending. */
export function openSeats(tables: readonly SeatTable[], seats: readonly SeatPos[]): Map<string, number[]> {
  const open = new Map<string, number[]>();
  for (const table of activeTables(tables)) {
    const taken = new Set(seats.filter((seat) => seat.tableId === table.id).map((seat) => seat.seatNumber));
    open.set(
      table.id,
      Array.from({ length: table.seatCount }, (_, i) => i + 1).filter((number) => !taken.has(number)),
    );
  }
  return open;
}

export interface TableOccupancy {
  tableId: string;
  tableNumber: number;
  occupied: number;
  capacity: number;
}

export interface SeatingStats {
  perTable: TableOccupancy[];
  activePlayers: number;
  seated: number;
  unseated: number;
  openSeats: number;
  capacity: number;
  activeTables: number;
  /** Most minus fewest players at any two active tables (0 with fewer than two). */
  maxDiff: number;
}

function occupancy(tables: readonly SeatTable[], seats: readonly SeatPos[]): TableOccupancy[] {
  return activeTables(tables).map((table) => ({
    tableId: table.id,
    tableNumber: table.tableNumber,
    occupied: seats.filter((seat) => seat.tableId === table.id).length,
    capacity: table.seatCount,
  }));
}

export function tableStats(snapshot: SeatingSnapshot): SeatingStats {
  const perTable = occupancy(snapshot.tables, snapshot.seats);
  const seated = perTable.reduce((sum, table) => sum + table.occupied, 0);
  const capacity = perTable.reduce((sum, table) => sum + table.capacity, 0);
  const counts = perTable.map((table) => table.occupied);
  return {
    perTable,
    activePlayers: snapshot.eligible.length,
    seated,
    unseated: waitingPlayers(snapshot).length,
    openSeats: capacity - seated,
    capacity,
    activeTables: perTable.length,
    maxDiff: counts.length > 1 ? Math.max(...counts) - Math.min(...counts) : 0,
  };
}

/** How many tables `players` need at `seatsPerTable`, and how many sit at each: 22 at 9 → [8, 7, 7]. */
export function suggestTables(players: number, seatsPerTable: number): { tableCount: number; perTable: number[] } {
  const seats = Math.max(1, Math.floor(seatsPerTable));
  const count = Math.max(0, Math.floor(players));
  const tableCount = Math.max(1, Math.ceil(count / seats));
  const base = Math.floor(count / tableCount);
  const extra = count % tableCount;
  return { tableCount, perTable: Array.from({ length: tableCount }, (_, i) => base + (i < extra ? 1 : 0)) };
}

/**
 * Seats `ids` one by one (in the order given) on `tables`: each at the table with the fewest players
 * that has an empty seat (ties broken by `rng`), in a random empty seat there. `seats` is updated in
 * place. The caller has checked there are enough seats.
 */
function drawInto(seats: SeatPos[], tables: readonly SeatTable[], ids: readonly string[], rng: Rng): SeatPos[] {
  const placed: SeatPos[] = [];
  for (const registrationId of ids) {
    const open = openSeats(tables, seats);
    const withRoom = occupancy(tables, seats).filter((table) => (open.get(table.tableId)?.length ?? 0) > 0);
    const fewest = Math.min(...withRoom.map((table) => table.occupied));
    const candidates = withRoom.filter((table) => table.occupied === fewest);
    const table = candidates[randomIndex(rng, candidates.length)];
    const free = open.get(table.tableId) as number[];
    const seat: SeatPos = { registrationId, tableId: table.tableId, seatNumber: free[randomIndex(rng, free.length)] };
    seats.push(seat);
    placed.push(seat);
  }
  return placed;
}

const notActive = (registrationId: string) =>
  refused("PLAYER_NOT_ACTIVE", "That player is not in the tournament any more (or not registered for it)", { registrationId });

/**
 * Seats the given players who have no seat yet, at random (all or nothing). Players already seated are
 * skipped, so a repeated tap seats nobody twice. Anyone not eligible: PLAYER_NOT_ACTIVE.
 */
export function planDraw(snapshot: SeatingSnapshot, registrationIds: readonly string[], rng: Rng, reason: "draw" | "redraw" = "draw"): SeatingPlan {
  const eligible = new Set(snapshot.eligible.map((player) => player.registrationId));
  const unique = Array.from(new Set(registrationIds));
  const stranger = unique.find((id) => !eligible.has(id));
  if (stranger !== undefined) return notActive(stranger);
  const seatedIds = new Set(snapshot.seats.map((seat) => seat.registrationId));
  const toSeat = unique.filter((id) => !seatedIds.has(id));
  const tables = activeTables(snapshot.tables);
  if (toSeat.length === 0) return planned([]);
  if (tables.length === 0) return refused("NO_TABLES", "Add a table first");
  const stats = tableStats(snapshot);
  if (toSeat.length > stats.openSeats) {
    return refused("INSUFFICIENT_SEATS", `Need ${toSeat.length - stats.openSeats} more seats: add a table`, {
      needed: toSeat.length,
      available: stats.openSeats,
    });
  }
  const seats = snapshot.seats.map((seat) => ({ ...seat }));
  const placed = drawInto(seats, tables, shuffle(toSeat, rng), rng);
  return planned(placed.map((seat) => ({ registrationId: seat.registrationId, from: null, to: { tableId: seat.tableId, seatNumber: seat.seatNumber }, reason })));
}

/**
 * Redraws everyone given (seated or not) on empty tables: each seated player's move goes from their
 * old seat straight to their new one (reason "redraw"); a player drawn into the seat they had is not
 * moved.
 */
export function planRedrawAll(snapshot: SeatingSnapshot, registrationIds: readonly string[], rng: Rng): SeatingPlan {
  const eligible = new Set(snapshot.eligible.map((player) => player.registrationId));
  const unique = Array.from(new Set(registrationIds));
  const stranger = unique.find((id) => !eligible.has(id));
  if (stranger !== undefined) return notActive(stranger);
  const tables = activeTables(snapshot.tables);
  if (unique.length === 0) return planned([]);
  if (tables.length === 0) return refused("NO_TABLES", "Add a table first");
  const redrawn = new Set(unique);
  const staying = snapshot.seats.filter((seat) => !redrawn.has(seat.registrationId));
  const available = tableStats({ ...snapshot, seats: staying }).openSeats;
  if (unique.length > available) {
    return refused("INSUFFICIENT_SEATS", `Need ${unique.length - available} more seats: add a table`, { needed: unique.length, available });
  }
  const before = new Map(snapshot.seats.map((seat) => [seat.registrationId, seat]));
  const placed = drawInto(staying.map((seat) => ({ ...seat })), tables, shuffle(unique, rng), rng);
  const moves = placed.flatMap((seat): SeatMove[] => {
    const old = before.get(seat.registrationId) ?? null;
    const to = { tableId: seat.tableId, seatNumber: seat.seatNumber };
    return sameSpot(old, to) ? [] : [{ registrationId: seat.registrationId, from: old ? { tableId: old.tableId, seatNumber: old.seatNumber } : null, to, reason: "redraw" }];
  });
  return planned(moves);
}

/**
 * The moves that even the tables out to at most one player apart, DETERMINISTIC (spec §4.5): while
 * the most-occupied table (ties: the highest table number) has two or more players than the
 * least-occupied table with an empty seat (ties: the lowest number), its player in the highest seat
 * moves to the lowest empty seat there. A player moved twice gets one move, first seat to last.
 */
export function planBalance(snapshot: SeatingSnapshot): SeatMove[] {
  const seats = snapshot.seats.map((seat) => ({ ...seat }));
  const tables = activeTables(snapshot.tables);
  const moves = new Map<string, SeatMove>();
  for (;;) {
    const counts = occupancy(tables, seats);
    if (counts.length < 2) break;
    const most = counts.reduce((best, table) =>
      table.occupied > best.occupied || (table.occupied === best.occupied && table.tableNumber > best.tableNumber) ? table : best,
    );
    const roomy = counts.filter((table) => table.occupied < table.capacity && table.tableId !== most.tableId);
    if (roomy.length === 0) break;
    const least = roomy.reduce((best, table) =>
      table.occupied < best.occupied || (table.occupied === best.occupied && table.tableNumber < best.tableNumber) ? table : best,
    );
    if (most.occupied - least.occupied <= 1) break;
    const mover = seats.filter((seat) => seat.tableId === most.tableId).reduce((best, seat) => (seat.seatNumber > best.seatNumber ? seat : best));
    const to = { tableId: least.tableId, seatNumber: (openSeats(tables, seats).get(least.tableId) as number[])[0] };
    const earlier = moves.get(mover.registrationId);
    moves.set(mover.registrationId, {
      registrationId: mover.registrationId,
      from: earlier ? earlier.from : { tableId: mover.tableId, seatNumber: mover.seatNumber },
      to,
      reason: "balance",
    });
    mover.tableId = to.tableId;
    mover.seatNumber = to.seatNumber;
  }
  return Array.from(moves.values()).filter((move) => !sameSpot(move.from, move.to));
}

/**
 * Players still in who have no seat, in sign-up order: typically online sign-ups who have not paid
 * or arrived (left out by a "paid players only" draw), or a player unseated by hand. Break and the
 * final table plan around the players at the tables, as the TD sees them, so the waiting never block
 * either; screens say they are waiting (waitingText) instead.
 */
export function waitingPlayers(snapshot: Pick<SeatingSnapshot, "seats" | "eligible">): EligiblePlayer[] {
  const seated = new Set(snapshot.seats.map((seat) => seat.registrationId));
  return snapshot.eligible.filter((player) => !seated.has(player.registrationId));
}

/** "2 players are waiting for a seat (1 unpaid)"; null when nobody is. */
export function waitingText(waiting: number, unpaid: number): string | null {
  if (waiting <= 0) return null;
  const who = waiting === 1 ? "1 player is" : `${waiting} players are`;
  return `${who} waiting for a seat${unpaid > 0 ? ` (${unpaid} unpaid)` : ""}`;
}

/**
 * The table to break, when everyone seated fits at the other active tables: the one with the fewest
 * players (ties: the highest number). Null with one table, or when they would not fit. Players
 * waiting for a seat are not counted (TDN3-FINAL-TABLE-WAITING).
 */
export function suggestBreak(snapshot: SeatingSnapshot): { tableId: string; tableNumber: number; playersToMove: number } | null {
  const counts = occupancy(snapshot.tables, snapshot.seats);
  if (counts.length < 2) return null;
  const fewest = counts.reduce((best, table) =>
    table.occupied < best.occupied || (table.occupied === best.occupied && table.tableNumber > best.tableNumber) ? table : best,
  );
  const elsewhere = counts.filter((table) => table.tableId !== fewest.tableId).reduce((sum, table) => sum + table.capacity, 0);
  return snapshot.seats.length <= elsewhere ? { tableId: fewest.tableId, tableNumber: fewest.tableNumber, playersToMove: fewest.occupied } : null;
}

/** Breaks a table: its players are drawn onto the other active tables (reason table_broken), and it is archived. */
export function planBreak(snapshot: SeatingSnapshot, tableId: string, rng: Rng): SeatingPlan {
  const tables = activeTables(snapshot.tables);
  const table = tables.find((candidate) => candidate.id === tableId);
  if (!table) return refused("TABLE_NOT_ACTIVE", "That table is not in play");
  if (tables.length < 2) return refused("LAST_TABLE", "This is the last table: there is nowhere to move its players");
  const others = tables.filter((candidate) => candidate.id !== tableId);
  const occupants = snapshot.seats.filter((seat) => seat.tableId === tableId).sort((a, b) => a.seatNumber - b.seatNumber);
  const remaining = snapshot.seats.filter((seat) => seat.tableId !== tableId);
  const available = tableStats({ ...snapshot, tables: others, seats: remaining }).openSeats;
  if (occupants.length > available) {
    return refused("INSUFFICIENT_SEATS", `The other tables need ${occupants.length - available} more seats`, {
      needed: occupants.length,
      available,
    });
  }
  const from = new Map(occupants.map((seat) => [seat.registrationId, seat]));
  const placed = drawInto(remaining.map((seat) => ({ ...seat })), others, shuffle(occupants.map((seat) => seat.registrationId), rng), rng);
  return planned(
    placed.map((seat) => {
      const old = from.get(seat.registrationId) as SeatPos;
      return {
        registrationId: seat.registrationId,
        from: { tableId: old.tableId, seatNumber: old.seatNumber },
        to: { tableId: seat.tableId, seatNumber: seat.seatNumber },
        reason: "table_broken",
      };
    }),
    [tableId],
  );
}

/** Who a final-table draw seats: the players at the tables, and with `includeWaiting` also those waiting for a seat. */
function finalTablePlayers(snapshot: SeatingSnapshot, includeWaiting: boolean): string[] {
  const seated = new Set(snapshot.seats.map((seat) => seat.registrationId));
  return snapshot.eligible.filter((player) => includeWaiting || seated.has(player.registrationId)).map((player) => player.registrationId);
}

/** The lowest-numbered active table with at least `players` seats. */
const finalTableFor = (tables: readonly SeatTable[], players: number): SeatTable | undefined => tables.find((candidate) => candidate.seatCount >= players);

/**
 * The final table, once everyone seated fits at one table and more than one is in play: the
 * lowest-numbered active table with enough seats. Null otherwise. Players waiting for a seat are not
 * counted: they would otherwise keep the final table from ever being suggested (TDN3-FINAL-TABLE-WAITING).
 */
export function suggestFinalTable(snapshot: SeatingSnapshot): { tableId: string; tableNumber: number } | null {
  const tables = activeTables(snapshot.tables);
  if (tables.length < 2 || snapshot.seats.length === 0) return null;
  const table = finalTableFor(tables, snapshot.seats.length);
  return table ? { tableId: table.id, tableNumber: table.tableNumber } : null;
}

/**
 * Redraws everyone seated at one table (the given one, else the lowest-numbered one they fit at, else
 * the only one), at random (reason final_table), and archives every other active table. Players
 * waiting for a seat stay waiting unless `includeWaiting`, when they are drawn too (and counted in the
 * size check). Players drawn into the seat they had are not moved.
 */
export function planFinalTable(snapshot: SeatingSnapshot, tableId: string | null, rng: Rng, includeWaiting = false): SeatingPlan {
  const tables = activeTables(snapshot.tables);
  if (tables.length === 0) return refused("NO_TABLES", "Add a table first");
  const players = finalTablePlayers(snapshot, includeWaiting);
  const who = includeWaiting ? "Everyone still in" : "Everyone seated";
  const chosenId = tableId ?? finalTableFor(tables, players.length)?.id ?? (tables.length === 1 ? tables[0].id : null);
  const table = tables.find((candidate) => candidate.id === chosenId);
  if (!table) {
    return tableId === null
      ? refused("INSUFFICIENT_SEATS", `${who} does not fit at one table yet`, { needed: players.length, available: Math.max(...tables.map((t) => t.seatCount)) })
      : refused("TABLE_NOT_ACTIVE", "That table is not in play");
  }
  if (players.length > table.seatCount) {
    return refused("INSUFFICIENT_SEATS", `Table ${table.tableNumber} has ${table.seatCount} seats for ${players.length} players`, {
      needed: players.length,
      available: table.seatCount,
    });
  }
  const before = new Map(snapshot.seats.map((seat) => [seat.registrationId, seat]));
  const order = shuffle(players, rng);
  const seatNumbers = shuffle(Array.from({ length: table.seatCount }, (_, i) => i + 1), rng);
  const moves = order.flatMap((registrationId, i): SeatMove[] => {
    const old = before.get(registrationId) ?? null;
    const to = { tableId: table.id, seatNumber: seatNumbers[i] };
    return sameSpot(old, to) ? [] : [{ registrationId, from: old ? { tableId: old.tableId, seatNumber: old.seatNumber } : null, to, reason: "final_table" }];
  });
  return planned(
    moves,
    tables.filter((candidate) => candidate.id !== table.id).map((candidate) => candidate.id),
  );
}

/**
 * Puts a player in a chosen seat. An empty seat: they move there (or are seated, if they had none). An
 * occupied seat: with `swap`, a seated player trades seats with its occupant (NOT_SEATED for a player
 * with no seat to trade); without, SEAT_TAKEN (details: occupantRegistrationId). Their own seat: no moves.
 */
export function planAssign(snapshot: SeatingSnapshot, registrationId: string, tableId: string, seatNumber: number, swap: boolean): SeatingPlan {
  if (!snapshot.eligible.some((player) => player.registrationId === registrationId)) return notActive(registrationId);
  const table = activeTables(snapshot.tables).find((candidate) => candidate.id === tableId);
  if (!table) return refused("TABLE_NOT_ACTIVE", "That table is not in play");
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > table.seatCount) {
    return refused("SEAT_OUT_OF_RANGE", `Table ${table.tableNumber} has seats 1 to ${table.seatCount}`);
  }
  const target = { tableId, seatNumber };
  const current = snapshot.seats.find((seat) => seat.registrationId === registrationId) ?? null;
  const occupant = snapshot.seats.find((seat) => sameSpot(seat, target)) ?? null;
  if (occupant?.registrationId === registrationId) return planned([]);
  const from = current ? { tableId: current.tableId, seatNumber: current.seatNumber } : null;
  if (!occupant) return planned([{ registrationId, from, to: target, reason: "move" }]);
  if (!swap) return refused("SEAT_TAKEN", "That seat is taken: swap the two players instead", { occupantRegistrationId: occupant.registrationId });
  if (!from) return refused("NOT_SEATED", "Only a seated player can swap seats: choose an empty seat");
  return planned([
    { registrationId, from, to: target, reason: "swap" },
    { registrationId: occupant.registrationId, from: target, to: from, reason: "swap" },
  ]);
}

/** Takes a player out of their seat (they wait as unseated); no moves when they have none. */
export function planUnseat(snapshot: SeatingSnapshot, registrationId: string): SeatingPlan {
  const current = snapshot.seats.find((seat) => seat.registrationId === registrationId);
  return planned(current ? [{ registrationId, from: { tableId: current.tableId, seatNumber: current.seatNumber }, to: null, reason: "unseat" }] : []);
}

/**
 * Puts a player whose bust was undone back in the seat they were busted from, when they have no seat,
 * that table is still in play, the seat still exists and nobody sits in it. Null otherwise (they then
 * wait as unseated).
 */
export function planRestore(snapshot: SeatingSnapshot, registrationId: string, lastSeat: SeatSpot | null): SeatMove | null {
  if (!lastSeat || !snapshot.eligible.some((player) => player.registrationId === registrationId)) return null;
  if (snapshot.seats.some((seat) => seat.registrationId === registrationId)) return null;
  const table = activeTables(snapshot.tables).find((candidate) => candidate.id === lastSeat.tableId);
  if (!table || lastSeat.seatNumber > table.seatCount) return null;
  if (snapshot.seats.some((seat) => sameSpot(seat, lastSeat))) return null;
  return { registrationId, from: null, to: { tableId: lastSeat.tableId, seatNumber: lastSeat.seatNumber }, reason: "restored" };
}

/** What is wrong with a set of seats: a seat or player twice, a seat past its table's size, or on a table not in play. */
export function seatingProblems(tables: readonly SeatTable[], seats: readonly SeatPos[]): string[] {
  const problems: string[] = [];
  const active = new Map(activeTables(tables).map((table) => [table.id, table]));
  const spots = new Set<string>();
  const players = new Set<string>();
  for (const seat of seats) {
    const table = active.get(seat.tableId);
    const spot = `${seat.tableId}:${seat.seatNumber}`;
    if (!table) problems.push(`seat ${spot} is on a table not in play`);
    else if (!Number.isInteger(seat.seatNumber) || seat.seatNumber < 1 || seat.seatNumber > table.seatCount) problems.push(`seat ${spot} is past the table's ${table.seatCount} seats`);
    if (spots.has(spot)) problems.push(`seat ${spot} is taken twice`);
    if (players.has(seat.registrationId)) problems.push(`registration ${seat.registrationId} has two seats`);
    spots.add(spot);
    players.add(seat.registrationId);
  }
  return problems;
}

/**
 * The seats after `moves`: every `from` is vacated first, then every `to` filled (as the server
 * persists them). Throws an Error starting "INVARIANT" when a move's `from` is not that player's seat
 * or the result breaks `seatingProblems`.
 */
export function applyMoves(seats: readonly SeatPos[], moves: readonly SeatMove[], tables: readonly SeatTable[]): SeatPos[] {
  let result = seats.map((seat) => ({ ...seat }));
  for (const move of moves) {
    if (!move.from) continue;
    const from = move.from;
    const index = result.findIndex((seat) => seat.registrationId === move.registrationId && sameSpot(seat, from));
    if (index === -1) throw new Error(`INVARIANT: ${move.registrationId} is not in seat ${from.tableId}:${from.seatNumber}`);
    result = [...result.slice(0, index), ...result.slice(index + 1)];
  }
  for (const move of moves) if (move.to) result.push({ registrationId: move.registrationId, tableId: move.to.tableId, seatNumber: move.to.seatNumber });
  const problems = seatingProblems(tables, result);
  if (problems.length > 0) throw new Error(`INVARIANT: ${problems.join("; ")}`);
  return result;
}
