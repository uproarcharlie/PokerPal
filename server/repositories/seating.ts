import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  clubs,
  players,
  tournamentRegistrations,
  tournaments,
  tournamentSeats,
  tournamentTables,
  type Club,
  type InsertTournamentSeat,
  type InsertTournamentTable,
  type TournamentSeat,
  type TournamentTable,
} from "@shared/schema";
import type { PublicPlayer } from "@shared/api/public";
import type { ReleaseReason, SeatPos } from "@shared/domain/seating";
import type { Executor } from "../db";
import { publicPlayerColumns } from "./players";

/**
 * Tables and seats of a tournament (migrations/0005). Seat rows are released (released_at + a reason),
 * never deleted, so a player's last seat survives their bust. Callers write inside a transaction that
 * holds the tournament's lock (lockTournamentForRegistrationWrite), which is what keeps two writes
 * from planning against the same seats; the partial unique indexes are the backstop. Seat times are
 * the statement's (clock_timestamp), not the transaction's start, so a registration's rows are ordered
 * as the lock let them be written, which is what latestSeatOf relies on.
 */

const statementTime = sql`clock_timestamp()`;

/**
 * A registration as seating sees it: whether it is still in, whether it has paid, its public player,
 * and what the waiting list reads (round 5, item 15: when it signed up, and whether it has played).
 */
export interface SeatingEntry {
  registrationId: string;
  isEliminated: boolean;
  paymentConfirmed: boolean;
  player: PublicPlayer;
  registrationTime: Date | null;
  rebuys: number | null;
  addons: number | null;
  knockouts: number | null;
  finalPosition: number | null;
}

/** What a tournament's seating settings fall back on: its club's table defaults (round 5). */
export type ClubSeatingDefaults = Pick<Club, "defaultSeatsPerTable" | "defaultTableShape">;

/** The club defaults of the tournament's club; null when there is no such tournament. */
export async function clubSeatingDefaultsOf(ex: Executor, tournamentId: string): Promise<ClubSeatingDefaults | null> {
  const [row] = await ex
    .select({ defaultSeatsPerTable: clubs.defaultSeatsPerTable, defaultTableShape: clubs.defaultTableShape })
    .from(tournaments)
    .innerJoin(clubs, eq(clubs.id, tournaments.clubId))
    .where(eq(tournaments.id, tournamentId));
  return row ?? null;
}

/** Every table of the tournament, archived ones included, by table number. */
export async function tablesOf(ex: Executor, tournamentId: string): Promise<TournamentTable[]> {
  return await ex
    .select()
    .from(tournamentTables)
    .where(eq(tournamentTables.tournamentId, tournamentId))
    .orderBy(asc(tournamentTables.tableNumber));
}

/** The tournament's registrations with their public players, in sign-up order. */
export async function seatingEntriesOf(ex: Executor, tournamentId: string): Promise<SeatingEntry[]> {
  const rows = await ex
    .select({
      registrationId: tournamentRegistrations.id,
      isEliminated: tournamentRegistrations.isEliminated,
      paymentConfirmed: tournamentRegistrations.paymentConfirmed,
      player: publicPlayerColumns,
      registrationTime: tournamentRegistrations.registrationTime,
      rebuys: tournamentRegistrations.rebuys,
      addons: tournamentRegistrations.addons,
      knockouts: tournamentRegistrations.knockouts,
      finalPosition: tournamentRegistrations.finalPosition,
    })
    .from(tournamentRegistrations)
    .innerJoin(players, eq(players.id, tournamentRegistrations.playerId))
    .where(eq(tournamentRegistrations.tournamentId, tournamentId))
    .orderBy(asc(tournamentRegistrations.registrationTime), asc(tournamentRegistrations.id));
  return rows.map((row) => ({ ...row, isEliminated: row.isEliminated === true, paymentConfirmed: row.paymentConfirmed === true }));
}

/**
 * Who sits where now: the active seats on active tables of players still in. A seat of a player who
 * went out, or on a table that was broken, is left out even before healSeats released it.
 */
export async function activeSeatsOf(ex: Executor, tournamentId: string): Promise<SeatPos[]> {
  return await ex
    .select({ registrationId: tournamentSeats.registrationId, tableId: tournamentSeats.tableId, seatNumber: tournamentSeats.seatNumber })
    .from(tournamentSeats)
    .innerJoin(tournamentTables, eq(tournamentTables.id, tournamentSeats.tableId))
    .innerJoin(tournamentRegistrations, eq(tournamentRegistrations.id, tournamentSeats.registrationId))
    .where(
      and(
        eq(tournamentSeats.tournamentId, tournamentId),
        isNull(tournamentSeats.releasedAt),
        eq(tournamentTables.status, "active"),
        sql`${tournamentRegistrations.isEliminated} IS NOT TRUE`,
      ),
    )
    .orderBy(asc(tournamentSeats.tableId), asc(tournamentSeats.seatNumber));
}

/**
 * Releases what activeSeatsOf leaves out: the seats of players who are out (reason "eliminated": a
 * bust recorded by a path that did not release it) and seats on broken tables ("table_broken"). Every
 * seating write runs this first, so its plan and the unique indexes agree on which seats are free.
 */
export async function healSeats(ex: Executor, tournamentId: string): Promise<void> {
  const active = and(eq(tournamentSeats.tournamentId, tournamentId), isNull(tournamentSeats.releasedAt));
  await ex
    .update(tournamentSeats)
    .set({ releasedAt: statementTime, releaseReason: "eliminated" })
    .where(
      and(
        active,
        inArray(
          tournamentSeats.registrationId,
          ex
            .select({ id: tournamentRegistrations.id })
            .from(tournamentRegistrations)
            .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.isEliminated, true))),
        ),
      ),
    );
  await ex
    .update(tournamentSeats)
    .set({ releasedAt: statementTime, releaseReason: "table_broken" })
    .where(
      and(
        active,
        inArray(
          tournamentSeats.tableId,
          ex
            .select({ id: tournamentTables.id })
            .from(tournamentTables)
            .where(and(eq(tournamentTables.tournamentId, tournamentId), eq(tournamentTables.status, "broken"))),
        ),
      ),
    );
}

/** Releases the active seats of these registrations (if they have one) with one reason. */
export async function releaseSeats(ex: Executor, registrationIds: readonly string[], reason: ReleaseReason): Promise<void> {
  if (registrationIds.length === 0) return;
  await ex
    .update(tournamentSeats)
    .set({ releasedAt: statementTime, releaseReason: reason })
    .where(and(inArray(tournamentSeats.registrationId, [...registrationIds]), isNull(tournamentSeats.releasedAt)));
}

/** New seat rows, in one INSERT (after the seats they replace were released). */
export async function insertSeats(ex: Executor, rows: readonly InsertTournamentSeat[]): Promise<void> {
  if (rows.length === 0) return;
  await ex.insert(tournamentSeats).values(rows.map((row) => ({ ...row, assignedAt: statementTime })));
}

/** The registration's newest seat row (active or released), if it ever had one. */
export async function latestSeatOf(ex: Executor, registrationId: string): Promise<TournamentSeat | undefined> {
  const [seat] = await ex
    .select()
    .from(tournamentSeats)
    .where(eq(tournamentSeats.registrationId, registrationId))
    .orderBy(desc(tournamentSeats.assignedAt), sql`${tournamentSeats.releasedAt} DESC NULLS FIRST`, desc(tournamentSeats.id))
    .limit(1);
  return seat;
}

/** Whether anyone was ever seated at the table (such a table is archived, not deleted). */
export async function hasSeatHistory(ex: Executor, tableId: string): Promise<boolean> {
  const [row] = await ex.select({ id: tournamentSeats.id }).from(tournamentSeats).where(eq(tournamentSeats.tableId, tableId)).limit(1);
  return row !== undefined;
}

export async function insertTables(ex: Executor, rows: readonly InsertTournamentTable[]): Promise<TournamentTable[]> {
  if (rows.length === 0) return [];
  return await ex.insert(tournamentTables).values([...rows]).returning();
}

export async function updateTable(ex: Executor, tableId: string, changes: Partial<InsertTournamentTable>): Promise<void> {
  await ex.update(tournamentTables).set(changes).where(eq(tournamentTables.id, tableId));
}

export async function deleteTable(ex: Executor, tableId: string): Promise<void> {
  await ex.delete(tournamentTables).where(eq(tournamentTables.id, tableId));
}

/** Archives active tables: status "broken", broken_at now. */
export async function archiveTables(ex: Executor, tournamentId: string, tableIds: readonly string[]): Promise<void> {
  if (tableIds.length === 0) return;
  await ex
    .update(tournamentTables)
    .set({ status: "broken", brokenAt: sql`now()` })
    .where(
      and(eq(tournamentTables.tournamentId, tournamentId), inArray(tournamentTables.id, [...tableIds]), eq(tournamentTables.status, "active")),
    );
}

/** Puts archived tables back in play (status "active"): undoing the change that archived them. */
export async function reopenTables(ex: Executor, tournamentId: string, tableIds: readonly string[]): Promise<void> {
  if (tableIds.length === 0) return;
  await ex
    .update(tournamentTables)
    .set({ status: "active", brokenAt: null })
    .where(
      and(eq(tournamentTables.tournamentId, tournamentId), inArray(tournamentTables.id, [...tableIds]), eq(tournamentTables.status, "broken")),
    );
}
