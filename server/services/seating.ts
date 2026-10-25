/**
 * Tables and seating (phase4-contracts §3.1). Every write runs in one transaction that locks the
 * tournament row first, the lock every registration write takes (lockTournamentForRegistrationWrite),
 * so seating changes and busts are serialized in one order (tournament, registrations, seats) and two
 * taps never plan against the same seats. Inside it, the seats of players who are out and of broken
 * tables are released (self-heal, not logged), the state is loaded, the plan is made by
 * shared/domain/seating (draws with crypto randomness; balancing deterministic), checked against the
 * domain's invariants and persisted: every vacated seat released, then every new seat inserted in one
 * statement, then the archived tables; with one activity row per operation. The answer is built after
 * the commit. A race the lock did not prevent is still refused by the partial unique indexes (409
 * SEAT_CONFLICT, mapped centrally).
 *
 * A table break, draw, balance or final table keeps every move it made in its activity entry, so the
 * TD can see them again ("Show last moves") and undo the change while the seats are still as it left
 * them (P4REV0-BREAK-NO-RECOVERY).
 *
 * The registrations service calls the hooks at the end of this file from inside its own transaction,
 * which already holds the tournament lock: a bust releases the seat; an undone bust (or a re-buy
 * re-entry) puts the player back in the seat they were busted from when it is still free; and (round
 * 5) auto-seat sits new registrations, players whose payment is confirmed and returning players down
 * as they come into play, so two sign-ups at once never take one seat.
 */
import { randomInt } from "node:crypto";
import type { Request } from "express";
import {
  SEATING_CHANGE_EVENTS,
  type AssignSeatInput,
  type BalanceInput,
  type BreakTableInput,
  type CreateTablesInput,
  type DrawSeatsInput,
  type AutoSeatResultDto,
  type FinalTableInput,
  type OpenTableInput,
  type PublicSeatingDto,
  type SeatingChangeEvent,
  type SeatingDto,
  type SeatingMutationDto,
  type SeatingSetupInput,
  type SeatMoveDto,
  type SeatRefDto,
  type UndoSeatingInput,
  type UnseatInput,
  type UpdateTableInput,
} from "@shared/api/seating";
import type { ActivityEventType } from "@shared/api/tournaments";
import type { Rng } from "@shared/domain/hash";
import {
  applyMoves,
  planAssign,
  planBalance,
  planBreak,
  planDraw,
  planFinalTable,
  planRedrawAll,
  planRestore,
  planUnseat,
  RELEASE_REASON,
  SEATING_LIMITS,
  seatingVersion,
  type ReleaseReason,
  type SeatingPlan,
  type SeatMove,
  type SeatReason,
  waitingPlayers,
  waitingText,
} from "@shared/domain/seating";
import {
  autoSeatDecision,
  nextTableNumber,
  openTableRng,
  planAutoSeat,
  planOpenTable,
  resolveSeatingSettings,
  setupTableCount,
  type SeatingSettings,
} from "@shared/domain/table-advisor";
import { resolveTableShape, type TableShape } from "@shared/domain/table-layout";
import type { InsertTournamentTable, Tournament, TournamentTable } from "@shared/schema";
import { db, readSnapshot, type Executor, type Transaction } from "../db";
import { actingUserId } from "../http/authz";
import { badRequest, conflict, HttpError, notFound } from "../http/errors";
import { insertActivity, latestActivityOf } from "../repositories/activity";
import { getClub } from "../repositories/clubs";
import { clockElapsedMsNow } from "../repositories/clock";
import { lockTournamentForRegistrationWrite } from "../repositories/registrations";
import * as seatingRepo from "../repositories/seating";
import { getTournament, setTournamentColumns } from "../repositories/tournaments";
import {
  seatingChangeOf,
  seatingSettingsOf,
  seatingState,
  tableName,
  toMoveDtos,
  toPublicSeatingDto,
  toSeatRef,
  toSeatingDto,
  type SeatingState,
  type StaffSeatingState,
} from "./seating-views";
import { assertOpen } from "./tournament-views";

/** Draws, redraws, breaks and the final table are fair (spec D5): crypto randomness. */
const cryptoRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "Table 2, Seat 7" (a named table by its name). */
const seatText = (seat: Pick<SeatRefDto, "tableName" | "seatNumber">) => `${seat.tableName}, Seat ${seat.seatNumber}`;

type SeatingTournament = Pick<Tournament, "id" | "maxPlayers">;

/** The tables, entries and seats, read side by side (a transaction runs them one after another on its connection). */
async function loadState(ex: Executor, tournament: SeatingTournament): Promise<SeatingState> {
  const [tables, entries, seats, club] = await Promise.all([
    seatingRepo.tablesOf(ex, tournament.id),
    seatingRepo.seatingEntriesOf(ex, tournament.id),
    seatingRepo.activeSeatsOf(ex, tournament.id),
    seatingRepo.clubSeatingDefaultsOf(ex, tournament.id),
  ]);
  return seatingState(tables, entries, seats, club, tournament.maxPlayers);
}

/**
 * loadState with the last seating change and the clock's time, which only the TD's SeatingDto (the
 * advisor: is late registration over?) and Undo use: the public seat finder's poll and the bust hooks
 * never read them (R2-CQ-04).
 */
async function loadStaffState(ex: Executor, tournament: SeatingTournament): Promise<StaffSeatingState> {
  const [state, lastChange, clockElapsedMs] = await Promise.all([
    loadState(ex, tournament),
    latestActivityOf(ex, tournament.id, SEATING_CHANGE_EVENTS),
    clockElapsedMsNow(ex, tournament.id),
  ]);
  return { ...state, lastChange: lastChange ?? null, clockElapsedMs };
}

async function requireTournament(ex: Executor, id: string): Promise<Tournament> {
  const tournament = await getTournament(ex, id);
  if (!tournament) throw notFound("Tournament not found");
  return tournament;
}

// ---------------------------------------------------------------------------------------------------
// Reads

// Unlocked reads, each from one snapshot (readSnapshot): a seating write committing between its queries
// must not show players missing or tables out of play for a poll (P4REV1-R3-02).

/** GET /api/tournaments/:id/seating (staff). */
export async function getSeating(tournamentId: string): Promise<SeatingDto> {
  return readSnapshot(async (tx) => {
    const tournament = await requireTournament(tx, tournamentId);
    return toSeatingDto(tournament, await loadStaffState(tx, tournament));
  });
}

/** GET /api/public/tournaments/:id/seating: anyone; PublicPlayer only, players still in, active tables. */
export async function getPublicSeating(tournamentId: string): Promise<PublicSeatingDto> {
  return readSnapshot(async (tx) => {
    const tournament = await requireTournament(tx, tournamentId);
    const [state, club] = await Promise.all([loadState(tx, tournament), getClub(tx, tournament.clubId)]);
    if (!club) throw notFound("Tournament not found");
    return toPublicSeatingDto(tournament, club, state);
  });
}

// ---------------------------------------------------------------------------------------------------
// The write pipeline

interface Locked {
  tx: Transaction;
  tournament: Tournament;
  /** With the last change: a 409 answers the TD's SeatingDto, and Undo reads it. */
  state: StaffSeatingState;
}

type WriteResult = Omit<SeatingMutationDto, "seating">;

/** One seating write: lock, heal, load, `write`; then the seating as it stands after the commit. */
async function seatingWrite(tournamentId: string, write: (locked: Locked) => Promise<WriteResult>): Promise<SeatingMutationDto> {
  const result = await db.transaction(async (tx) => {
    const tournament = await lockTournamentForRegistrationWrite(tx, tournamentId);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament);
    await seatingRepo.healSeats(tx, tournamentId);
    return write({ tx, tournament, state: await loadStaffState(tx, tournament) });
  });
  return { seating: await getSeating(tournamentId), ...result };
}

const tableNotFound = () => new HttpError(404, "TABLE_NOT_FOUND", "That table is not part of this tournament");
const tableLimit = () => conflict("TABLE_LIMIT", `A tournament can have at most ${SEATING_LIMITS.maxActiveTables} tables in play`);

function findTable({ tables }: SeatingState, tableId: string): TournamentTable {
  const table = tables.find((candidate) => candidate.id === tableId);
  if (!table) throw tableNotFound();
  return table;
}

/** A refused plan as the API answers it: 400 for a seat the table does not have, else 409. */
function planOrThrow(plan: SeatingPlan): Extract<SeatingPlan, { ok: true }> {
  if (plan.ok) return plan;
  if (plan.problem === "SEAT_OUT_OF_RANGE") throw badRequest(plan.message, plan.problem, plan.details);
  throw conflict(plan.problem, plan.message, plan.details);
}

const STALE_PLAN_MESSAGE = "The seating changed since that was suggested: check the new suggestion";

/**
 * Balance, Break, a redraw, the final table, a confirmed move or swap and Undo apply what was shown: a
 * seating changed since is 409 STALE_PLAN with the current one.
 */
function assertVersion({ tournament, state }: Locked, expectedVersion: string | undefined, message = STALE_PLAN_MESSAGE): void {
  if (expectedVersion === undefined || expectedVersion === seatingVersion(state.snapshot)) return;
  throw conflict("STALE_PLAN", message, { seating: toSeatingDto(tournament, state) });
}

function releaseReasonOf(reason: SeatReason): ReleaseReason {
  if (reason === "draw" || reason === "restored" || reason === "auto_seat") throw new Error(`INVARIANT: a ${reason} move vacates no seat`);
  return RELEASE_REASON[reason];
}

/**
 * Writes a plan: checks it against the domain's invariants (a broken plan is a bug, never a
 * half-written seating), releases every vacated seat, then inserts every new one in one statement (so
 * two players can trade seats), then archives the tables the plan retires. Answers the seating
 * version it leaves (what Undo checks against).
 */
async function persist(
  req: Request,
  { tx, tournament, state }: Locked,
  { moves, archiveTableIds = [] }: { moves: readonly SeatMove[]; archiveTableIds?: readonly string[] },
): Promise<string> {
  const tables = state.snapshot.tables.map((table) => (archiveTableIds.includes(table.id) ? { ...table, status: "broken" as const } : table));
  const seats = applyMoves(state.snapshot.seats, moves, tables);
  const vacating = new Map<ReleaseReason, string[]>();
  for (const move of moves) {
    if (!move.from) continue;
    const reason = releaseReasonOf(move.reason);
    vacating.set(reason, [...(vacating.get(reason) ?? []), move.registrationId]);
  }
  for (const [reason, registrationIds] of Array.from(vacating)) await seatingRepo.releaseSeats(tx, registrationIds, reason);
  const assignedBy = actingUserId(req);
  await seatingRepo.insertSeats(
    tx,
    moves.flatMap((move) =>
      move.to ? [{ tournamentId: tournament.id, tableId: move.to.tableId, registrationId: move.registrationId, seatNumber: move.to.seatNumber, assignedBy }] : [],
    ),
  );
  await seatingRepo.archiveTables(tx, tournament.id, archiveTableIds);
  return seatingVersion({ tables, seats, eligible: state.snapshot.eligible });
}

/**
 * The activity data a table break, draw, balance or final table keeps besides its figures: every move,
 * as screens name it, and what Undo needs (the version it left and the tables it archived).
 */
const changeData = (moves: readonly SeatMoveDto[], versionAfter: string, archivedTableIds: readonly string[] = []) => ({
  moves,
  undo: { versionAfter, archivedTableIds },
});

/** One activity row. `playerId` for an event about one player; `data` never holds a user id. */
async function logSeating(
  ex: Executor,
  tournamentId: string,
  eventType: ActivityEventType,
  description: string,
  { playerId, data }: { playerId?: string; data?: Record<string, unknown> } = {},
): Promise<void> {
  await insertActivity(ex, {
    tournamentId,
    playerId: playerId ?? null,
    eventType,
    description,
    eventData: data ? JSON.stringify(data) : undefined,
  });
}

const playerIdOf = ({ entries }: SeatingState, registrationId: string) =>
  entries.find((entry) => entry.registrationId === registrationId)?.player.id;

/** Where a move leaves a player, for activity data: { tableNumber, seatNumber } or null. */
const spotData = (move: SeatMoveDto, side: "from" | "to") => {
  const ref = move[side];
  return ref ? { tableNumber: ref.tableNumber, seatNumber: ref.seatNumber } : null;
};

/** `ids` without the entries whose payment is not confirmed, unless they are included, and how many that left out. */
function drawable(state: SeatingState, ids: readonly string[], includeUnconfirmed: boolean): { ids: string[]; excludedUnconfirmed: number } {
  if (includeUnconfirmed) return { ids: [...ids], excludedUnconfirmed: 0 };
  const unpaid = new Set(state.snapshot.eligible.filter((player) => !player.paymentConfirmed).map((player) => player.registrationId));
  const kept = ids.filter((id) => !unpaid.has(id));
  return { ids: kept, excludedUnconfirmed: ids.length - kept.length };
}

const unseatedIds = ({ snapshot }: SeatingState): string[] => waitingPlayers(snapshot).map((player) => player.registrationId);

/** A table's shape as the activity feed says it: "Table 3 is now a rectangle". */
const SHAPE_TEXT: Readonly<Record<TableShape, string>> = { oval: "an oval", rectangle: "a rectangle", round: "a round table" };

/** Adds `count` tables of `seatCount` seats and `shape`, numbered after the highest the tournament has had (archived ones included). */
async function addTablesTo({ tx, tournament, state }: Locked, count: number, seatCount: number, shape: TableShape): Promise<TournamentTable[]> {
  if (state.snapshot.tables.filter((table) => table.status === "active").length + count > SEATING_LIMITS.maxActiveTables) throw tableLimit();
  const first = nextTableNumber(state.tables);
  if (first + count - 1 > SEATING_LIMITS.maxTableNumber) {
    throw conflict("TABLE_LIMIT", `Table numbers go up to ${SEATING_LIMITS.maxTableNumber}: renumber or remove a table first`);
  }
  return seatingRepo.insertTables(
    tx,
    Array.from({ length: count }, (_, i) => ({ tournamentId: tournament.id, tableNumber: first + i, seatCount, shape })),
  );
}

// ---------------------------------------------------------------------------------------------------
// Tables

/**
 * The tables a room opens with become the tournament's starting tables (R5REV1-ADV-01): the advisor
 * never breaks those while players are still arriving, so a TD who starts with 3 is not told to
 * break one straight away. Stored only when it differs from the settings in force.
 */
async function keepStartingTables({ tx, tournament }: Locked, settings: SeatingSettings, tableCount: number): Promise<void> {
  if (tableCount !== settings.startingTables) await setTournamentColumns(tx, tournament.id, { startingTables: tableCount });
}

/**
 * POST /api/tournaments/:id/tables: seats and shape default to the tournament's seating settings.
 * Tables added before anyone sits down (nobody seated, none broken) are the room's starting tables.
 */
export async function addTables(tournamentId: string, input: CreateTablesInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { state } = locked;
    const settings = seatingSettingsOf(locked.tournament, state);
    const seatCount = input.seatCount ?? settings.seatsPerTable;
    const shape = input.shape ?? settings.tableShape;
    const created = await addTablesTo(locked, input.count, seatCount, shape);
    const unplayed = state.snapshot.seats.length === 0 && state.snapshot.tables.every((table) => table.status === "active");
    if (unplayed) await keepStartingTables(locked, settings, state.snapshot.tables.length + created.length);
    await logSeating(locked.tx, tournamentId, "tables_added", `Added ${plural(input.count, "table")} (${seatCount} seats)`, {
      data: { tableNumbers: created.map((table) => table.tableNumber), seatCount, shape },
    });
    return { moves: [] };
  });
}

/** PATCH /api/tournaments/:id/tables/:tableId: rename, resize, renumber or reopen. Nothing changed logs nothing. */
export async function updateTable(tournamentId: string, tableId: string, input: UpdateTableInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { tx, state } = locked;
    const table = findTable(state, tableId);
    const label = `Table ${table.tableNumber}`;
    const changes: Partial<InsertTournamentTable> = {};
    const descriptions: string[] = [];

    if (input.name !== undefined && input.name !== table.name) {
      changes.name = input.name;
      descriptions.push(input.name === null ? `${label}'s name was cleared` : `${label} renamed ${input.name}`);
    }
    if (input.tableNumber !== undefined && input.tableNumber !== table.tableNumber) {
      if (state.tables.some((other) => other.tableNumber === input.tableNumber)) {
        throw conflict("TABLE_NUMBER_TAKEN", `There is already a Table ${input.tableNumber} in this tournament`);
      }
      changes.tableNumber = input.tableNumber;
      descriptions.push(`${label} is now Table ${input.tableNumber}`);
    }
    if (input.seatCount !== undefined && input.seatCount !== table.seatCount) {
      const seatCount = input.seatCount;
      const seatNumbers = state.snapshot.seats
        .filter((seat) => seat.tableId === table.id && seat.seatNumber > seatCount)
        .map((seat) => seat.seatNumber)
        .sort((a, b) => a - b);
      if (seatNumbers.length > 0) {
        const seats = `${seatNumbers.length === 1 ? "seat" : "seats"} ${seatNumbers.join(", ")}`;
        throw conflict("SEATS_OCCUPIED", `Move the ${plural(seatNumbers.length, "player")} in ${seats} first`, { seatNumbers });
      }
      changes.seatCount = seatCount;
      descriptions.push(`${label} now has ${seatCount} seats`);
    }
    if (input.status === "active" && table.status !== "active") {
      if (state.snapshot.tables.filter((other) => other.status === "active").length >= SEATING_LIMITS.maxActiveTables) throw tableLimit();
      changes.status = "active";
      changes.brokenAt = null;
      descriptions.push(`${label} reopened`);
    }
    // Compared with how it is drawn now, so choosing the shape it already has (from the tournament or club) changes nothing.
    if (input.shape !== undefined && input.shape !== resolveTableShape(table.shape, seatingSettingsOf(locked.tournament, state).tableShape)) {
      changes.shape = input.shape;
      descriptions.push(`${label} is now ${SHAPE_TEXT[input.shape]}`);
    }

    if (descriptions.length > 0) {
      await seatingRepo.updateTable(tx, table.id, changes);
      await logSeating(tx, tournamentId, "table_updated", descriptions.join("; "), { data: { tableNumber: table.tableNumber, changes } });
    }
    return { moves: [] };
  });
}

/**
 * DELETE /api/tournaments/:id/tables/:tableId: a table nobody ever sat at is deleted; one with seat
 * history is archived, so the history and its number survive. 409 TABLE_OCCUPIED while anyone sits there.
 */
export async function removeTable(tournamentId: string, tableId: string): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async ({ tx, state }) => {
    const table = findTable(state, tableId);
    const occupied = state.snapshot.seats.filter((seat) => seat.tableId === table.id).length;
    if (occupied > 0) {
      throw conflict("TABLE_OCCUPIED", `${tableName(table)} still has ${plural(occupied, "player")}: break the table or move them first`);
    }
    const hasHistory = await seatingRepo.hasSeatHistory(tx, table.id);
    if (!hasHistory) await seatingRepo.deleteTable(tx, table.id);
    else if (table.status === "active") await seatingRepo.archiveTables(tx, tournamentId, [table.id]);
    else return { moves: [], removed: "archived" }; // archived already: nothing to do
    const removed = hasHistory ? "archived" : "deleted";
    await logSeating(tx, tournamentId, "table_removed", `Removed ${tableName(table)}`, { data: { tableNumber: table.tableNumber, removed } });
    return { moves: [], removed };
  });
}

/** POST /api/tournaments/:id/tables/:tableId/break: its players drawn onto the other tables, then archived. */
export async function breakTable(req: Request, tournamentId: string, tableId: string, input: BreakTableInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const table = findTable(locked.state, tableId);
    assertVersion(locked, input.expectedVersion);
    const plan = planOrThrow(planBreak(locked.state.snapshot, table.id, cryptoRng));
    const versionAfter = await persist(req, locked, plan);
    const moves = toMoveDtos(locked.state, plan.moves);
    await logSeating(locked.tx, tournamentId, "table_broken", `Broke ${tableName(table)}: ${plural(plan.moves.length, "player")} moved`, {
      data: { tableNumber: table.tableNumber, moved: plan.moves.length, ...changeData(moves, versionAfter, plan.archiveTableIds) },
    });
    return { moves };
  });
}

// ---------------------------------------------------------------------------------------------------
// Seating

/**
 * Who of `ids` setup seats when its tables cannot take everyone: those who have paid first, then in
 * sign-up order (the order `ids` come in), as many as there are seats; the rest wait for the
 * advisor's "Open Table N".
 */
function firstToSit(state: SeatingState, ids: readonly string[], seats: number): string[] {
  if (ids.length <= seats) return [...ids];
  const paid = new Set(state.snapshot.eligible.filter((player) => player.paymentConfirmed).map((player) => player.registrationId));
  return [...ids.filter((id) => paid.has(id)), ...ids.filter((id) => !paid.has(id))].slice(0, seats);
}

/**
 * POST /api/tournaments/:id/seating/setup (round 5): the starting tables (setupTableCount from the
 * seating settings, unless `tableCount`), of the settings' seats and shape (unless sent), then
 * everyone still in drawn; when the tables cannot take everyone, those who have paid sit first and the
 * rest wait (the advisor then says to open a table). Seats or a shape sent become the tournament's
 * own settings, so tables opened later match, and the number of tables its starting tables, which the
 * advisor never breaks while players are still arriving (R5REV1-ADV-01). 409 TABLES_EXIST when a table is in play, TABLE_LIMIT.
 */
export async function setUpSeating(req: Request, tournamentId: string, input: SeatingSetupInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { tx, tournament, state } = locked;
    if (state.snapshot.tables.some((table) => table.status === "active")) {
      throw conflict("TABLES_EXIST", "Tables are already set up: add tables or draw seats instead");
    }
    const settings = seatingSettingsOf(tournament, state);
    const { ids, excludedUnconfirmed } = drawable(state, unseatedIds(state), input.includeUnconfirmed);
    const seatCount = input.seatCount ?? settings.seatsPerTable;
    const shape = input.shape ?? settings.tableShape;
    // The starting tables as they would be at the seats chosen (a 6-handed setup needs more tables than 9-handed).
    const atSeats = resolveSeatingSettings({ tournament: { ...tournament, seatsPerTable: seatCount }, club: state.club });
    const tableCount = input.tableCount ?? setupTableCount(atSeats, ids.length);
    const ownSettings = {
      ...(input.seatCount !== undefined && input.seatCount !== settings.seatsPerTable ? { seatsPerTable: input.seatCount } : {}),
      ...(input.shape !== undefined && input.shape !== settings.tableShape ? { tableShape: input.shape } : {}),
      // The tables the room opens with are its starting tables (R5REV1-ADV-01).
      ...(tableCount !== settings.startingTables ? { startingTables: tableCount } : {}),
    };
    if (Object.keys(ownSettings).length > 0) await setTournamentColumns(tx, tournament.id, ownSettings);
    const created = await addTablesTo(locked, tableCount, seatCount, shape);
    const withTables = { ...state, ...seatingState([...state.tables, ...created], state.entries, state.snapshot.seats, state.club, state.maxPlayers) };
    const seating = firstToSit(state, ids, tableCount * seatCount);
    const plan = planOrThrow(planDraw(withTables.snapshot, seating, cryptoRng));
    const versionAfter = await persist(req, { ...locked, state: withTables }, plan);
    const moves = toMoveDtos(withTables, plan.moves);
    await logSeating(tx, tournamentId, "tables_added", `Added ${plural(tableCount, "table")} (${seatCount} seats)`, {
      data: { tableNumbers: created.map((table) => table.tableNumber), seatCount, shape },
    });
    if (plan.moves.length > 0) {
      const left = ids.length - seating.length;
      await logSeating(
        tx,
        tournamentId,
        "seating_drawn",
        `Seats drawn for ${plural(plan.moves.length, "player")}${left > 0 ? `; ${plural(left, "player")} waiting for a seat` : ""}`,
        { data: { scope: "unseated", players: plan.moves.length, ...(left > 0 ? { waiting: left } : {}), ...changeData(moves, versionAfter) } },
      );
    }
    return { moves, excludedUnconfirmed };
  });
}

/**
 * POST /api/tournaments/:id/seating/draw: "unseated" seats players still in who have no seat (or just
 * `registrationIds`), skipping anyone seated meanwhile, so a repeated tap seats nobody twice; "all"
 * redraws them, seated or not. `expectedVersion` makes a repeated redraw a 409 STALE_PLAN.
 */
export async function drawSeats(req: Request, tournamentId: string, input: DrawSeatsInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { state } = locked;
    assertVersion(locked, input.expectedVersion);
    const everyone = input.scope === "all" ? state.snapshot.eligible.map((player) => player.registrationId) : unseatedIds(state);
    const { ids, excludedUnconfirmed } = drawable(state, input.registrationIds ?? everyone, input.includeUnconfirmed);
    const plan = planOrThrow(
      input.scope === "all" ? planRedrawAll(state.snapshot, ids, cryptoRng) : planDraw(state.snapshot, ids, cryptoRng),
    );
    const versionAfter = await persist(req, locked, plan);
    const moves = toMoveDtos(state, plan.moves);
    if (plan.moves.length > 0) {
      const players = input.scope === "all" ? new Set(ids).size : plan.moves.length;
      await logSeating(
        locked.tx,
        tournamentId,
        "seating_drawn",
        `Seats ${input.scope === "all" ? "redrawn" : "drawn"} for ${plural(players, "player")}`,
        { data: { scope: input.scope, players, ...changeData(moves, versionAfter) } },
      );
    }
    return { moves, excludedUnconfirmed };
  });
}

/**
 * POST /api/tournaments/:id/seating/assign: move or seat a player, or swap two (`swap`). With
 * `expectedVersion` it applies only to the seating the TD confirmed against (P4REV1-CC-03).
 */
export async function assignSeat(req: Request, tournamentId: string, input: AssignSeatInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { tx, state } = locked;
    const table = findTable(state, input.tableId);
    assertVersion(locked, input.expectedVersion, "The seats have changed since you chose that: check them and try again");
    const plan = planOrThrow(planAssign(state.snapshot, input.registrationId, table.id, input.seatNumber, input.swap));
    await persist(req, locked, plan);
    const moves = toMoveDtos(state, plan.moves);
    const [mover, other] = moves;
    if (other) {
      await logSeating(tx, tournamentId, "seats_swapped", `${mover.playerName} and ${other.playerName} swapped seats`, {
        data: { moves: moves.map((move) => ({ registrationId: move.registrationId, from: spotData(move, "from"), to: spotData(move, "to") })) },
      });
    } else if (mover) {
      await logSeating(
        tx,
        tournamentId,
        "seat_assigned",
        `${mover.playerName} ${mover.from ? "moved to" : "seated at"} ${tableName(table)}, Seat ${input.seatNumber}`,
        { playerId: playerIdOf(state, mover.registrationId), data: { registrationId: mover.registrationId, from: spotData(mover, "from"), to: spotData(mover, "to") } },
      );
    }
    return { moves };
  });
}

/** POST /api/tournaments/:id/seating/unseat: idempotent; 409 PLAYER_NOT_ACTIVE for a registration of another tournament. */
export async function unseatPlayer(req: Request, tournamentId: string, input: UnseatInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { tx, state } = locked;
    const entry = state.entries.find((candidate) => candidate.registrationId === input.registrationId);
    if (!entry) {
      throw conflict("PLAYER_NOT_ACTIVE", "That player is not registered for this tournament", { registrationId: input.registrationId });
    }
    const plan = planOrThrow(planUnseat(state.snapshot, entry.registrationId));
    await persist(req, locked, plan);
    const moves = toMoveDtos(state, plan.moves);
    if (moves.length > 0) {
      await logSeating(tx, tournamentId, "seat_released", `${entry.player.name} was unseated`, {
        playerId: entry.player.id,
        data: { registrationId: entry.registrationId, from: spotData(moves[0], "from") },
      });
    }
    return { moves };
  });
}

/** POST /api/tournaments/:id/seating/balance: exactly suggestions.balance (deterministic); no moves when balanced. */
export async function balanceTables(req: Request, tournamentId: string, input: BalanceInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    assertVersion(locked, input.expectedVersion);
    const plan = planBalance(locked.state.snapshot);
    const versionAfter = await persist(req, locked, { moves: plan });
    const moves = toMoveDtos(locked.state, plan);
    if (moves.length > 0) {
      await logSeating(locked.tx, tournamentId, "seating_balanced", `Tables balanced: ${plural(moves.length, "player")} moved`, {
        data: { moved: moves.length, ...changeData(moves, versionAfter) },
      });
    }
    return { moves };
  });
}

/**
 * POST /api/tournaments/:id/seating/final-table: everyone seated redrawn at one table (and those
 * waiting for a seat too, with `includeWaiting`); the others archived. Anyone left waiting is said in
 * the activity entry. `expectedVersion` makes a second confirm (another TD's phone) a 409 STALE_PLAN
 * rather than a second draw.
 */
export async function drawFinalTable(req: Request, tournamentId: string, input: FinalTableInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { tx, state } = locked;
    const chosen = input.tableId === undefined ? null : findTable(state, input.tableId).id;
    assertVersion(locked, input.expectedVersion);
    const includeWaiting = input.includeWaiting === true;
    const plan = planOrThrow(planFinalTable(state.snapshot, chosen, cryptoRng, includeWaiting));
    const versionAfter = await persist(req, locked, plan);
    const moves = toMoveDtos(state, plan.moves);
    const waiting = includeWaiting ? [] : waitingPlayers(state.snapshot);
    const left = waitingText(waiting.length, waiting.filter((player) => !player.paymentConfirmed).length);
    // The plan archives every active table but the final one.
    const table = state.tables.find((candidate) => candidate.status === "active" && !plan.archiveTableIds.includes(candidate.id));
    if (table && (plan.moves.length > 0 || plan.archiveTableIds.length > 0)) {
      await logSeating(tx, tournamentId, "final_table", `Final table drawn at ${tableName(table)}${left ? `; ${left}` : ""}`, {
        data: {
          tableNumber: table.tableNumber,
          players: state.snapshot.eligible.length - waiting.length,
          waiting: waiting.length,
          archivedTables: state.tables.filter((candidate) => plan.archiveTableIds.includes(candidate.id)).map((candidate) => candidate.tableNumber),
          ...changeData(moves, versionAfter, plan.archiveTableIds),
        },
      });
    }
    return { moves };
  });
}

/**
 * POST /api/tournaments/:id/seating/open-table (round 5, the advisor's "Open Table N"): one more table
 * (the next number; the settings' seats and shape unless sent), the waiting players seated and the
 * tables evened out to within one player (planOpenTable), all in one transaction. The plan is the one
 * the advice showed: the same snapshot and the same seeded draw (openTableRng), so with the
 * `expectedVersion` the advice came with Apply does exactly what was shown, and a seating changed
 * since (a seat, or who is waiting for one: seatingVersion) is 409 STALE_PLAN. Logged as table_opened with its moves, so Undo can put them back
 * (the table then stays, empty, for the TD to remove).
 */
export async function openTable(req: Request, tournamentId: string, input: OpenTableInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { tx, tournament, state } = locked;
    assertVersion(locked, input.expectedVersion);
    const settings = seatingSettingsOf(tournament, state);
    const seatCount = input.seatCount ?? settings.seatsPerTable;
    const shape = input.shape ?? settings.tableShape;
    const before = state.snapshot;
    const rng = openTableRng(before);
    const [table] = await addTablesTo(locked, 1, seatCount, shape);
    const plan = planOpenTable(before, settings, { id: table.id, tableNumber: table.tableNumber, seatCount: table.seatCount, status: "active" }, rng);
    const withTable = { ...state, ...seatingState([...state.tables, table], state.entries, state.snapshot.seats, state.club, state.maxPlayers) };
    const versionAfter = await persist(req, { ...locked, state: withTable }, plan);
    const moves = toMoveDtos(withTable, plan.moves);
    const seated = moves.filter((move) => move.from === null).length;
    const moved = moves.length - seated;
    const parts = [...(seated > 0 ? [`${plural(seated, "player")} seated`] : []), ...(moved > 0 ? [`${moved} moved`] : [])];
    await logSeating(tx, tournamentId, "table_opened", `Opened ${tableName(table)}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`, {
      data: { tableNumber: table.tableNumber, seatCount, shape, seated, moved, sizes: plan.sizes, ...changeData(moves, versionAfter) },
    });
    return { moves };
  });
}

/**
 * POST /api/tournaments/:id/seating/undo: everyone the last table break, draw, balance or final table
 * moved goes back to the seat they had before it (players it seated are unseated again), and the
 * tables it archived reopen. Only the last such change, and only while the seats are exactly as it
 * left them: any later seating change or bust makes it 409 STALE_PLAN (move players by hand instead).
 * Logged as seating_undone ("Undid …"), with its moves; an undo cannot itself be undone.
 */
export async function undoSeatingChange(req: Request, tournamentId: string, input: UndoSeatingInput): Promise<SeatingMutationDto> {
  return seatingWrite(tournamentId, async (locked) => {
    const { tx, tournament, state } = locked;
    const entry = state.lastChange;
    const record = entry ? seatingChangeOf(entry) : null;
    const undo = record?.undo;
    if (!entry || !record || !undo || entry.id !== input.activityId) {
      throw conflict("NOTHING_TO_UNDO", "That seating change can no longer be undone: it was undone already, or a newer one replaced it", {
        seating: toSeatingDto(tournament, state),
      });
    }
    const stale = "The seats have changed since, so that can no longer be undone: move players by hand";
    assertVersion(locked, input.expectedVersion, stale);
    assertVersion(locked, undo.versionAfter, stale);

    const reopen = state.tables.filter((table) => table.status === "broken" && undo.archivedTableIds.includes(table.id));
    await seatingRepo.reopenTables(tx, tournamentId, reopen.map((table) => table.id));
    const reopened = {
      ...state,
      ...seatingState(
        state.tables.map((table) => (reopen.includes(table) ? { ...table, status: "active" as const, brokenAt: null } : table)),
        state.entries,
        state.snapshot.seats,
        state.club,
        state.maxPlayers,
      ),
    };
    // Back the way each player came: from where the change put them to where it found them.
    const spot = (ref: SeatMoveDto["from"]) => (ref ? { tableId: ref.tableId, seatNumber: ref.seatNumber } : null);
    const back: SeatMove[] = record.moves.map((move) => ({
      registrationId: move.registrationId,
      from: spot(move.to),
      to: spot(move.from),
      reason: move.from ? "move" : "unseat",
    }));
    await persist(req, { ...locked, state: reopened }, { moves: back });
    const moves = toMoveDtos(reopened, back);
    await logSeating(tx, tournamentId, "seating_undone", `Undid “${entry.description}”`, {
      data: { undid: entry.eventType as SeatingChangeEvent, players: moves.length, reopenedTables: reopen.map((table) => table.tableNumber), moves },
    });
    return { moves };
  });
}

// ---------------------------------------------------------------------------------------------------
// Hooks for the registrations service (inside its transaction, which holds the tournament lock)

/** A bust: the player's seat is released (reason "eliminated"); the elimination itself is what is logged. */
export async function releaseSeatOnElimination(tx: Executor, registrationId: string): Promise<void> {
  await seatingRepo.releaseSeats(tx, [registrationId], "eliminated");
}

/** The seating as a hook plans from it: seats held by players who are out released first, so they never look taken. */
async function loadHealed(tx: Executor, tournament: SeatingTournament): Promise<SeatingState> {
  await seatingRepo.healSeats(tx, tournament.id);
  return loadState(tx, tournament);
}

/**
 * Auto-seat (round 5, item 9): sits a player who has just come into play down at the open table
 * with the fewest players, in a random empty seat (planAutoSeat), when the tournament's setting
 * allows it now (autoSeatDecision) and they are not on the waiting list (round 5, item 15: seated
 * once they are accepted, autoSeatOnPayment). The seat row is the app's (assigned_by null), logged as "Alice seated at Table 2, Seat 7"
 * with `auto: true`. With every seat taken the player waits; `logWaiting` then tells the TD so
 * ("seat_waiting", staff-only), and the advisor says to open a table.
 */
async function seatAutomatically(
  tx: Executor,
  tournament: Tournament,
  state: SeatingState,
  registrationId: string,
  { logWaiting, returning = false }: { logWaiting: boolean; returning?: boolean },
): Promise<AutoSeatResultDto> {
  const entry = state.entries.find((candidate) => candidate.registrationId === registrationId);
  if (!entry || entry.isEliminated) return { status: "waiting", reason: "not_eligible" };
  const settings = seatingSettingsOf(tournament, state);
  const decision = autoSeatDecision(settings.autoSeat, entry.paymentConfirmed);
  if (decision !== "seat") return { status: "waiting", reason: decision };
  // On the waiting list: seated once accepted at the desk (autoSeatOnPayment).
  if (state.waitingList.has(registrationId)) return { status: "waiting", reason: "awaiting_payment" };
  const plan = planAutoSeat(state.snapshot, registrationId, cryptoRng);
  if (!plan.ok) {
    if (plan.skip === "tables_full" && logWaiting) {
      await logSeating(tx, tournament.id, "seat_waiting", `${entry.player.name} is waiting for a seat: every table is full`, {
        playerId: entry.player.id,
        data: { registrationId },
      });
    }
    return { status: "waiting", reason: plan.skip };
  }
  const { to } = plan.move;
  await seatingRepo.insertSeats(tx, [{ tournamentId: tournament.id, tableId: to.tableId, registrationId, seatNumber: to.seatNumber, assignedBy: null }]);
  const seat = toSeatRef(state.tables, to);
  await logSeating(tx, tournament.id, "seat_assigned", `${entry.player.name} ${returning ? "is back in, seated at" : "seated at"} ${seatText(seat)}`, {
    playerId: entry.player.id,
    data: { registrationId, from: null, to: { tableNumber: seat.tableNumber, seatNumber: seat.seatNumber }, tableNumber: seat.tableNumber, seatNumber: seat.seatNumber, auto: true },
  });
  return { status: "seated", seat };
}

/**
 * A new registration (POST /api/tournaments/:id/registrations), inside its transaction: seated by
 * auto-seat when the setting allows it now ("when they register", or "once they've paid" with the
 * payment ticked at the desk), else waiting and why (no tables yet: setup seats them; off; not paid;
 * every table full, which tells the TD).
 */
export async function autoSeatNewRegistration(tx: Executor, tournament: Tournament, registrationId: string): Promise<AutoSeatResultDto> {
  return seatAutomatically(tx, tournament, await loadHealed(tx, tournament), registrationId, { logWaiting: true });
}

/**
 * A payment just confirmed (PATCH /api/registrations/:id/confirm-payment), inside its transaction: a
 * player still in who has no seat is seated by auto-seat, unless it is off: "once they've paid" seats
 * them now, and "when they register" seats a player held back until then (accepted off the waiting
 * list, or left out of a paid-players-only draw). Null when auto-seat had nothing to do (off, seated, out, or no
 * table in play yet: setup seats them).
 */
export async function autoSeatOnPayment(tx: Executor, tournament: Tournament, registrationId: string): Promise<AutoSeatResultDto | null> {
  const state = await loadHealed(tx, tournament);
  const settings = seatingSettingsOf(tournament, state);
  const inPlay = state.snapshot.eligible.some((player) => player.registrationId === registrationId);
  const seated = state.snapshot.seats.some((seat) => seat.registrationId === registrationId);
  const tablesInPlay = state.snapshot.tables.some((table) => table.status === "active");
  if (settings.autoSeat === "off" || !inPlay || seated || !tablesInPlay) return null;
  // "When they register" told the TD already if the tables were full then.
  return seatAutomatically(tx, tournament, state, registrationId, { logWaiting: settings.autoSeat === "once_paid" });
}

/**
 * An undone bust, or a re-buy that brings a busted player back: they get back the seat they were
 * busted from, when their last seat was released by that bust, its table is still in play, the seat
 * still exists and nobody sits in it (planRestore), logged as "Alice is back at Table 2, Seat 4".
 * Otherwise auto-seat seats them as it would a new arrival when the setting allows (round 5: "Alice
 * is back in, seated at Table 1, Seat 3"), else they wait as unseated.
 */
export async function restoreSeatAfterReturn(tx: Executor, tournament: Tournament, registrationId: string): Promise<void> {
  const last = await seatingRepo.latestSeatOf(tx, registrationId);
  const state = await loadHealed(tx, tournament);
  if (state.snapshot.tables.every((table) => table.status !== "active")) return;
  const move = last?.releaseReason === "eliminated" ? planRestore(state.snapshot, registrationId, { tableId: last.tableId, seatNumber: last.seatNumber }) : null;
  if (!last || !move) {
    await seatAutomatically(tx, tournament, state, registrationId, { logWaiting: true, returning: true });
    return;
  }
  const tournamentId = tournament.id;
  await seatingRepo.insertSeats(tx, [{ tournamentId, tableId: last.tableId, registrationId, seatNumber: last.seatNumber, assignedBy: null }]);
  const table = findTable(state, last.tableId);
  const [restored] = toMoveDtos(state, [move]);
  await logSeating(tx, tournamentId, "seat_assigned", `${restored.playerName} is back at ${tableName(table)}, Seat ${last.seatNumber}`, {
    playerId: playerIdOf(state, registrationId),
    data: { registrationId, from: null, to: spotData(restored, "to"), restored: true },
  });
}
