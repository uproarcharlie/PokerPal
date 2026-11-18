/**
 * A tournament's listed high hands (round 10, migrations/0019), written straight to the database: the
 * high hands, who entered which and who won what, for states the API reaches only through many steps.
 * Import it by path (the factories' index is frozen). Money is decimal(10,2) text, awards are cents.
 */
import {
  highHandAwards,
  registrationHighHands,
  tournamentHighHands,
  type HighHandAwardRow,
  type TournamentHighHand,
  type TournamentRegistration,
} from "@shared/schema";
import { getDb, type Database } from "../../server/db";

export type NewHighHand = typeof tournamentHighHands.$inferInsert;

/** A listed high hand: "High hand 1" at $5, no AP, one prize, unless overridden. */
export async function createHighHand(
  overrides: Partial<NewHighHand> & Pick<NewHighHand, "tournamentId">,
  db: Database = getDb(),
): Promise<TournamentHighHand> {
  const [highHand] = await db
    .insert(tournamentHighHands)
    .values({ position: 1, name: "High hand 1", entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 1, ...overrides })
    .returning();
  return highHand;
}

/** Enters the registrations in the high hand (the legacy enteringHighHands summary is the caller's to set). */
export async function enterHighHand(
  highHand: Pick<TournamentHighHand, "id" | "tournamentId">,
  registrations: ReadonlyArray<Pick<TournamentRegistration, "id">>,
  db: Database = getDb(),
): Promise<void> {
  if (registrations.length === 0) return;
  await db
    .insert(registrationHighHands)
    .values(registrations.map((registration) => ({ registrationId: registration.id, highHandId: highHand.id, tournamentId: highHand.tournamentId })));
}

/** An award of the high hand to the registration, in cents. */
export async function createHighHandAward(
  highHand: Pick<TournamentHighHand, "id" | "tournamentId">,
  registration: Pick<TournamentRegistration, "id">,
  amountCents: number,
  overrides: Partial<typeof highHandAwards.$inferInsert> = {},
  db: Database = getDb(),
): Promise<HighHandAwardRow> {
  const [award] = await db
    .insert(highHandAwards)
    .values({ tournamentId: highHand.tournamentId, highHandId: highHand.id, registrationId: registration.id, amountCents, ...overrides })
    .returning();
  return award;
}
