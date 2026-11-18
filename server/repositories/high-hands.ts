/**
 * A tournament's listed high hands (round 10, migrations/0019): the high hands (tournament_high_hands,
 * removed ones kept), who entered which (registration_high_hands) and who won what (high_hand_awards).
 * Every write here runs under the tournament's lock, which every change to its registrations and its
 * high hands takes first (server/services/high-hands), so these rows are never written concurrently.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  highHandAwards,
  registrationHighHands,
  tournamentHighHands,
  type HighHandAwardRow,
  type InsertTournamentHighHand,
  type RegistrationHighHand,
  type TournamentHighHand,
} from "@shared/schema";
import type { Executor } from "../db";

const LIST_ORDER = [asc(tournamentHighHands.position), asc(tournamentHighHands.createdAt), asc(tournamentHighHands.id)];

/** Every high hand the tournament has listed, removed ones included, in list order. */
export async function highHandRowsOf(ex: Executor, tournamentId: string): Promise<TournamentHighHand[]> {
  return await ex.select().from(tournamentHighHands).where(eq(tournamentHighHands.tournamentId, tournamentId)).orderBy(...LIST_ORDER);
}

/** The same for many tournaments in one query (the tournament list: perf-19). */
export async function highHandRowsOfTournaments(ex: Executor, tournamentIds: readonly string[]): Promise<TournamentHighHand[]> {
  if (tournamentIds.length === 0) return [];
  return await ex
    .select()
    .from(tournamentHighHands)
    .where(inArray(tournamentHighHands.tournamentId, [...tournamentIds]))
    .orderBy(asc(tournamentHighHands.tournamentId), ...LIST_ORDER);
}

/** Who entered which of the tournament's high hands. */
export async function entrantRowsOf(ex: Executor, tournamentId: string): Promise<RegistrationHighHand[]> {
  return await ex
    .select()
    .from(registrationHighHands)
    .where(eq(registrationHighHands.tournamentId, tournamentId))
    .orderBy(asc(registrationHighHands.createdAt), asc(registrationHighHands.id));
}

/** Every prize awarded from the tournament's high hands, in award order. */
export async function awardRowsOf(ex: Executor, tournamentId: string): Promise<HighHandAwardRow[]> {
  return await ex
    .select()
    .from(highHandAwards)
    .where(eq(highHandAwards.tournamentId, tournamentId))
    .orderBy(asc(highHandAwards.awardedAt), asc(highHandAwards.id));
}

export async function insertHighHand(ex: Executor, row: InsertTournamentHighHand): Promise<TournamentHighHand> {
  const [created] = await ex.insert(tournamentHighHands).values(row).returning();
  return created;
}

/** Changes a listed high hand's settings, stamping updated_at. */
export async function updateHighHand(
  ex: Executor,
  tournamentId: string,
  id: string,
  values: Partial<Pick<InsertTournamentHighHand, "name" | "position" | "entryFee" | "rakeType" | "rakeAmount" | "winners" | "note" | "removedAt">>,
): Promise<void> {
  await ex
    .update(tournamentHighHands)
    .set({ ...values, updatedAt: sql`now()` })
    .where(and(eq(tournamentHighHands.id, id), eq(tournamentHighHands.tournamentId, tournamentId)));
}

/** Enters registrations in a high hand (a pair already stored is left as it is). */
export async function insertEntrants(
  ex: Executor,
  tournamentId: string,
  rows: ReadonlyArray<{ registrationId: string; highHandId: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await ex
    .insert(registrationHighHands)
    .values(rows.map((row) => ({ ...row, tournamentId })))
    .onConflictDoNothing({ target: [registrationHighHands.registrationId, registrationHighHands.highHandId] });
}

/** Takes a registration out of some high hands. */
export async function deleteEntrants(ex: Executor, registrationId: string, highHandIds: readonly string[]): Promise<void> {
  if (highHandIds.length === 0) return;
  await ex
    .delete(registrationHighHands)
    .where(and(eq(registrationHighHands.registrationId, registrationId), inArray(registrationHighHands.highHandId, [...highHandIds])));
}

export async function insertAward(
  ex: Executor,
  row: Pick<HighHandAwardRow, "tournamentId" | "highHandId" | "registrationId" | "amountCents" | "splitWithRegistrationId" | "awardedBy">,
): Promise<HighHandAwardRow> {
  const [created] = await ex.insert(highHandAwards).values(row).returning();
  return created;
}

export async function setAwardAmount(ex: Executor, highHandId: string, registrationId: string, amountCents: number): Promise<void> {
  await ex
    .update(highHandAwards)
    .set({ amountCents })
    .where(and(eq(highHandAwards.highHandId, highHandId), eq(highHandAwards.registrationId, registrationId)));
}

export async function deleteAward(ex: Executor, highHandId: string, registrationId: string): Promise<void> {
  await ex.delete(highHandAwards).where(and(eq(highHandAwards.highHandId, highHandId), eq(highHandAwards.registrationId, registrationId)));
}
