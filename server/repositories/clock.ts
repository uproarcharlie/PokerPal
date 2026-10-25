import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { CLOCK_ACTIONS, CLOCK_STATUSES, deriveClock, type ClockState, type ClockStructure, type ClockUndo } from "@shared/domain/clock";
import { isUpcomingStatus, type TournamentStatus } from "@shared/domain/tournaments";
import {
  tournamentClocks,
  tournamentRegistrations,
  tournaments,
  tournamentTables,
  type InsertTournamentClock,
  type TournamentClock,
} from "@shared/schema";
import type { Executor } from "../db";

/**
 * The tournament clock's rows (migrations/0005, phase4-contracts §1). The table holds anchors only;
 * every screen derives the time from them (shared/domain/clock). Times are `timestamptz` columns here
 * and epoch ms everywhere else: `clockStateOf` and `clockStateColumns` convert at this boundary.
 */

export async function getClock(ex: Executor, tournamentId: string): Promise<TournamentClock | undefined> {
  const [clock] = await ex.select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournamentId));
  return clock;
}

/** The tournament clock's time now (ms since level 1 began, breaks included); null without a clock. */
export async function clockElapsedMsNow(ex: Executor, tournamentId: string): Promise<number | null> {
  const clock = await getClock(ex, tournamentId);
  const derived = clock ? deriveClock(clockStateOf(clock), clock.levels, Date.now()) : null;
  return derived ? Math.round(derived.elapsedClockMs) : null;
}

/** The stored anchors as shared/domain/clock reads them (epoch ms). */
export function clockStateOf(row: TournamentClock): ClockState {
  return {
    status: row.status,
    currentLevelIndex: row.currentLevelIndex,
    periodEndsAt: row.periodEndsAt?.getTime() ?? null,
    pausedRemainingMs: row.pausedRemainingMs,
    startedAt: row.startedAt?.getTime() ?? null,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isClockState(value: unknown): value is ClockState {
  return (
    isRecord(value) &&
    (CLOCK_STATUSES as readonly unknown[]).includes(value.status) &&
    Number.isInteger(value.currentLevelIndex) &&
    (value.periodEndsAt === null || isTime(value.periodEndsAt)) &&
    (value.pausedRemainingMs === null || isTime(value.pausedRemainingMs)) &&
    (value.startedAt === null || isTime(value.startedAt))
  );
}

/**
 * The stored undo snapshot (shared/domain/clock ClockUndo), or null when there is none or it is not one:
 * an undo_state written before snapshots recorded what they revert and when gives nothing to undo. One
 * written before they recorded a tournament start (startedTournamentFrom) started none.
 */
export function clockUndoOf(row: Pick<TournamentClock, "undoState">): ClockUndo | null {
  const undo: unknown = row.undoState;
  if (!isRecord(undo) || !isClockState(undo.state) || !isRecord(undo.change)) return null;
  const { action, description } = undo.change;
  const knownAction = action !== "undo" && (CLOCK_ACTIONS as readonly unknown[]).includes(action);
  if (!knownAction || typeof description !== "string" || typeof undo.redo !== "boolean" || !isTime(undo.at) || !Number.isInteger(undo.levelIndex)) {
    return null;
  }
  const startedFrom = undo.startedTournamentFrom ?? null;
  if (startedFrom !== null && !(typeof startedFrom === "string" && isUpcomingStatus(startedFrom))) return null;
  return row.undoState && { ...row.undoState, startedTournamentFrom: startedFrom };
}

/** The stored structure: levels, ante mode and stacks. */
export function clockStructureOf(row: TournamentClock): ClockStructure {
  return {
    levels: row.levels,
    anteMode: row.anteMode,
    startingStack: row.startingStack,
    rebuyStack: row.rebuyStack,
    addonStack: row.addonStack,
    earlyBirdStack: row.earlyBirdStack,
  };
}

/** The columns that hold a ClockState. */
export function clockStateColumns(state: ClockState) {
  return {
    status: state.status,
    currentLevelIndex: state.currentLevelIndex,
    periodEndsAt: state.periodEndsAt === null ? null : new Date(state.periodEndsAt),
    pausedRemainingMs: state.pausedRemainingMs,
    startedAt: state.startedAt === null ? null : new Date(state.startedAt),
  };
}

/** The columns that hold a ClockStructure (store it normalized: normalizeStructure). */
export function clockStructureColumns(structure: ClockStructure) {
  return {
    levels: structure.levels,
    anteMode: structure.anteMode,
    startingStack: structure.startingStack,
    rebuyStack: structure.rebuyStack,
    addonStack: structure.addonStack,
    earlyBirdStack: structure.earlyBirdStack,
  };
}

/** What a clock write may set; the version, updated_at and the key are the repository's. */
export type ClockColumns = Partial<Omit<InsertTournamentClock, "tournamentId" | "version" | "updatedAt" | "createdAt">>;

/** Creates the tournament's clock unless it has one: the new row, or undefined when one already exists. */
export async function insertClockIfAbsent(
  ex: Executor,
  tournamentId: string,
  values: ClockColumns,
): Promise<TournamentClock | undefined> {
  const [clock] = await ex
    .insert(tournamentClocks)
    .values({ ...values, tournamentId })
    .onConflictDoNothing({ target: tournamentClocks.tournamentId })
    .returning();
  return clock;
}

/**
 * Compare-and-set: writes `values` only while the row is still at `version`, bumping it. Undefined
 * when another write got there first (or the clock is gone): read it again and retry.
 */
export async function compareAndSetClock(
  ex: Executor,
  tournamentId: string,
  version: number,
  values: ClockColumns,
): Promise<TournamentClock | undefined> {
  const [clock] = await ex
    .update(tournamentClocks)
    .set({ ...values, version: sql`${tournamentClocks.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(tournamentClocks.tournamentId, tournamentId), eq(tournamentClocks.version, version)))
    .returning();
  return clock;
}

export async function deleteClock(ex: Executor, tournamentId: string): Promise<boolean> {
  const deleted = await ex
    .delete(tournamentClocks)
    .where(eq(tournamentClocks.tournamentId, tournamentId))
    .returning({ tournamentId: tournamentClocks.tournamentId });
  return deleted.length > 0;
}

/** The clock-key columns with no key in force: spread into a clock write that ends the key (finalize, cancel). */
export const NO_CLOCK_KEY = { controlKeyHash: null, controlKeyIssuedAt: null, controlKeyIssuedBy: null } as const;

/**
 * Stops the clock for good on `currentLevelIndex` (the level it had reached: services/clock
 * finishClock works it out), inside finalize's transaction, which holds the tournament's lock. The
 * TV's clock key ends with it. A tournament with no clock is left alone.
 */
export async function markClockFinished(ex: Executor, tournamentId: string, currentLevelIndex: number): Promise<void> {
  await ex
    .update(tournamentClocks)
    .set({
      status: "finished",
      currentLevelIndex,
      periodEndsAt: null,
      pausedRemainingMs: 0,
      undoState: null,
      ...NO_CLOCK_KEY,
      version: sql`${tournamentClocks.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(tournamentClocks.tournamentId, tournamentId));
}

/**
 * Puts a TV clock key in force (its sha256, and the user who issued it), replacing any other, or ends
 * it (null). Not a clock state change: the version stays. Undefined when the tournament has no clock.
 */
export async function setClockKey(
  ex: Executor,
  tournamentId: string,
  key: { hash: string; issuedBy: string | null } | null,
): Promise<{ issuedAt: Date | null } | undefined> {
  const [row] = await ex
    .update(tournamentClocks)
    .set(key === null ? NO_CLOCK_KEY : { controlKeyHash: key.hash, controlKeyIssuedAt: sql`now()`, controlKeyIssuedBy: key.issuedBy })
    .where(eq(tournamentClocks.tournamentId, tournamentId))
    .returning({ issuedAt: tournamentClocks.controlKeyIssuedAt });
  return row;
}

/** A TV clock key as stored. */
export type StoredClockKey = Pick<TournamentClock, "controlKeyHash" | "controlKeyIssuedAt" | "controlKeyIssuedBy">;

/** The tournament's stored TV clock key with the club it belongs to, or undefined without a clock. */
export async function storedClockKeyOf(ex: Executor, tournamentId: string): Promise<(StoredClockKey & { clubId: string }) | undefined> {
  const [row] = await ex
    .select({
      controlKeyHash: tournamentClocks.controlKeyHash,
      controlKeyIssuedAt: tournamentClocks.controlKeyIssuedAt,
      controlKeyIssuedBy: tournamentClocks.controlKeyIssuedBy,
      clubId: tournaments.clubId,
    })
    .from(tournamentClocks)
    .innerJoin(tournaments, eq(tournaments.id, tournamentClocks.tournamentId))
    .where(eq(tournamentClocks.tournamentId, tournamentId));
  return row;
}

/**
 * Moves the tournament from status `from` to `to` for a clock write, inside its transaction (which
 * holds the tournament's lock): a start with "also start the tournament" (scheduled or registration →
 * in progress), or the undo of one (back again). Whether it moved: one no longer at `from` is left as it is.
 */
export async function moveTournamentStatusForClock(ex: Executor, tournamentId: string, from: TournamentStatus, to: TournamentStatus): Promise<boolean> {
  const moved = await ex
    .update(tournaments)
    .set({ status: to })
    .where(and(eq(tournaments.id, tournamentId), eq(tournaments.status, from)))
    .returning({ id: tournaments.id });
  return moved.length > 0;
}

/** How many of the tournament's tables are in play (archived ones left out). */
export async function countActiveTables(ex: Executor, tournamentId: string): Promise<number> {
  const [row] = await ex
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(tournamentTables)
    .where(and(eq(tournamentTables.tournamentId, tournamentId), eq(tournamentTables.status, "active")));
  return row?.count ?? 0;
}

export interface ClubClockRow {
  tournamentId: string;
  tournamentName: string;
  startDateTime: Date;
  clock: TournamentClock;
}

/** The clocks with at least one level of the club's tournaments, latest start first, at most `limit`. */
export async function clubClocks(ex: Executor, clubId: string, limit: number): Promise<ClubClockRow[]> {
  return ex
    .select({
      tournamentId: tournaments.id,
      tournamentName: tournaments.name,
      startDateTime: tournaments.startDateTime,
      clock: tournamentClocks,
    })
    .from(tournamentClocks)
    .innerJoin(tournaments, eq(tournaments.id, tournamentClocks.tournamentId))
    .where(and(eq(tournaments.clubId, clubId), sql`jsonb_array_length(${tournamentClocks.levels}) > 0`))
    .orderBy(desc(tournaments.startDateTime), asc(tournaments.id))
    .limit(limit);
}

/** Which of `ids` are registrations of the tournament. */
export async function registrationIdsIn(ex: Executor, tournamentId: string, ids: readonly string[]): Promise<Set<string>> {
  const rows = await ex
    .select({ id: tournamentRegistrations.id })
    .from(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), inArray(tournamentRegistrations.id, [...ids])));
  return new Set(rows.map((row) => row.id));
}

/** Sets the early-bird flag on the tournament's registrations among `ids`: the ids whose flag changed. */
export async function setEarlyBird(ex: Executor, tournamentId: string, ids: readonly string[], earlyBird: boolean): Promise<string[]> {
  const rows = await ex
    .update(tournamentRegistrations)
    .set({ earlyBird })
    .where(
      and(
        eq(tournamentRegistrations.tournamentId, tournamentId),
        inArray(tournamentRegistrations.id, [...ids]),
        ne(tournamentRegistrations.earlyBird, earlyBird),
      ),
    )
    .returning({ id: tournamentRegistrations.id });
  return rows.map((row) => row.id);
}

export async function countEarlyBirds(ex: Executor, tournamentId: string): Promise<number> {
  const [row] = await ex
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.earlyBird, true)));
  return row?.count ?? 0;
}

/** A season's tournaments that are completed, and all of them but the cancelled ones. */
export async function seasonTournamentCounts(ex: Executor, seasonId: string): Promise<{ completed: number; total: number }> {
  const [row] = await ex
    .select({
      completed: sql<number>`count(*) filter (where ${tournaments.status} = 'completed')`.mapWith(Number),
      total: sql<number>`count(*) filter (where ${tournaments.status} <> 'cancelled')`.mapWith(Number),
    })
    .from(tournaments)
    .where(eq(tournaments.seasonId, seasonId));
  return { completed: row?.completed ?? 0, total: row?.total ?? 0 };
}
