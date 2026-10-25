import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import {
  players,
  tournamentRegistrations,
  tournaments,
  type InsertTournamentRegistration,
  type Player,
  type Tournament,
  type TournamentRegistration,
} from "@shared/schema";
import type { Executor } from "../db";

export async function getTournamentRegistration(ex: Executor, id: string): Promise<TournamentRegistration | undefined> {
  const [registration] = await ex.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id));
  return registration || undefined;
}

/**
 * A new registration. Its sign-up time is the statement's (clock_timestamp), not its transaction's
 * start (the column's now()): sign-ups take the tournament's lock in turn, so their times come in the
 * order they were taken, and the waiting list (sign-up order) never puts an entry already told it is
 * in behind one written after it (round 5, item 15).
 */
export async function createTournamentRegistration(
  ex: Executor,
  insertReg: InsertTournamentRegistration,
): Promise<TournamentRegistration> {
  const [registration] = await ex
    .insert(tournamentRegistrations)
    .values({ registrationTime: sql`clock_timestamp()`, ...insertReg })
    .returning();
  return registration;
}

export async function updateTournamentRegistration(
  ex: Executor,
  id: string,
  regData: Partial<InsertTournamentRegistration>,
): Promise<TournamentRegistration | undefined> {
  const [registration] = await ex
    .update(tournamentRegistrations)
    .set(regData)
    .where(eq(tournamentRegistrations.id, id))
    .returning();
  return registration || undefined;
}

/** Deletes the registration (its tournament and registration rows locked by the caller). */
export async function deleteTournamentRegistration(ex: Executor, id: string): Promise<void> {
  await ex.delete(tournamentRegistrations).where(eq(tournamentRegistrations.id, id));
}

/**
 * The tournament row, locked until the transaction ends. Every change to a tournament's registrations
 * takes this lock first, then the registration rows it touches, so their checks and writes never
 * interleave with each other, with finalize (FOR UPDATE) or with an update of the tournament itself.
 * NO KEY UPDATE rather than UPDATE: it blocks all of those just the same, but not the foreign-key
 * checks of rows that merely reference the tournament (an activity entry written elsewhere), which
 * could otherwise deadlock against a transaction that holds a registration row.
 */
export async function lockTournamentForRegistrationWrite(ex: Executor, id: string): Promise<Tournament | undefined> {
  const [tournament] = await ex.select().from(tournaments).where(eq(tournaments.id, id)).for("no key update");
  return tournament;
}

/** A tournament's registrations by id. Pass `lock` inside a transaction to hold them FOR UPDATE until it ends (finalize). */
export async function registrationsOf(
  ex: Executor,
  tournamentId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<TournamentRegistration[]> {
  const query = ex
    .select()
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, tournamentId))
    .orderBy(asc(tournamentRegistrations.id));
  return lock ? await query.for("update") : await query;
}

/** The registration row, locked until the transaction ends (take the tournament's lock first). */
export async function lockRegistration(ex: Executor, id: string): Promise<TournamentRegistration | undefined> {
  const [registration] = await ex
    .select()
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.id, id))
    .for("no key update");
  return registration;
}

/** A player's registration for a tournament, locked (legacy data may hold two: the first is used). */
export async function lockPlayerRegistration(
  ex: Executor,
  tournamentId: string,
  playerId: string,
): Promise<TournamentRegistration | undefined> {
  const [registration] = await ex
    .select()
    .from(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.playerId, playerId)))
    .orderBy(asc(tournamentRegistrations.registrationTime), asc(tournamentRegistrations.id))
    .limit(1)
    .for("no key update");
  return registration;
}

export async function countRegistrations(ex: Executor, tournamentId: string): Promise<number> {
  const [row] = await ex
    .select({ value: count() })
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, tournamentId));
  return Number(row?.value ?? 0);
}

export interface RegistrationWithPlayer {
  registration: TournamentRegistration;
  player: Player | null;
}

/** A tournament's registrations with their players, in sign-up order; optionally only paid or unpaid ones. */
export async function listRegistrationsWithPlayers(
  ex: Executor,
  tournamentId: string,
  filter: { paymentConfirmed?: boolean } = {},
): Promise<RegistrationWithPlayer[]> {
  const paid = sql`coalesce(${tournamentRegistrations.paymentConfirmed}, false)`;
  return await ex
    .select({ registration: tournamentRegistrations, player: players })
    .from(tournamentRegistrations)
    .leftJoin(players, eq(players.id, tournamentRegistrations.playerId))
    .where(
      and(
        eq(tournamentRegistrations.tournamentId, tournamentId),
        filter.paymentConfirmed === undefined ? undefined : sql`${paid} = ${filter.paymentConfirmed}`,
      ),
    )
    .orderBy(asc(tournamentRegistrations.registrationTime), asc(tournamentRegistrations.id));
}

export interface CountDeltas {
  rebuys?: number;
  addons?: number;
  knockouts?: number;
}

/** Adds the deltas in SQL (`n = n + delta`), so concurrent changes are never lost. */
export async function addToCounts(ex: Executor, id: string, deltas: CountDeltas): Promise<TournamentRegistration | undefined> {
  const set: Partial<Record<keyof CountDeltas, SQL>> = {};
  for (const key of ["rebuys", "addons", "knockouts"] as const) {
    const delta = deltas[key];
    if (delta) set[key] = sql`coalesce(${tournamentRegistrations[key]}, 0) + ${delta}`;
  }
  if (Object.keys(set).length === 0) return getTournamentRegistration(ex, id);
  const [registration] = await ex
    .update(tournamentRegistrations)
    .set(set)
    .where(eq(tournamentRegistrations.id, id))
    .returning();
  return registration;
}

/** Takes one knockout off the registration's count, never below zero (a restored player's eliminator). */
export async function removeKnockout(ex: Executor, id: string): Promise<void> {
  await ex
    .update(tournamentRegistrations)
    .set({ knockouts: sql`greatest(coalesce(${tournamentRegistrations.knockouts}, 0) - 1, 0)` })
    .where(eq(tournamentRegistrations.id, id));
}

/** Marks the payment confirmed; undefined when it already was (or the registration is gone). */
export async function confirmPayment(ex: Executor, id: string): Promise<TournamentRegistration | undefined> {
  const [registration] = await ex
    .update(tournamentRegistrations)
    .set({ paymentConfirmed: true })
    .where(and(eq(tournamentRegistrations.id, id), sql`${tournamentRegistrations.paymentConfirmed} IS NOT TRUE`))
    .returning();
  return registration;
}
