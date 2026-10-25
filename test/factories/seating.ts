/**
 * Tables and seat rows for seating tests (migrations/0005), written straight to the database, for
 * states the API reaches only through many steps (a seat held by a player marked out by a path that
 * did not release it, a table's history). Import it by path (the factories' index is frozen).
 */
import { tournamentSeats, tournamentTables, type TournamentRegistration, type TournamentSeat, type TournamentTable } from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { createPlayer } from "./players";
import { createRegistration, type NewRegistration } from "./tournaments";

export type NewTable = typeof tournamentTables.$inferInsert;
export type NewSeat = typeof tournamentSeats.$inferInsert;

export async function createTable(
  overrides: Partial<NewTable> & Pick<NewTable, "tournamentId" | "tableNumber">,
  db: Database = getDb(),
): Promise<TournamentTable> {
  const [table] = await db
    .insert(tournamentTables)
    .values({ seatCount: 9, ...overrides, brokenAt: overrides.status === "broken" ? (overrides.brokenAt ?? new Date()) : overrides.brokenAt })
    .returning();
  return table;
}

/** A seat row: active unless `releasedAt` (with its `releaseReason`) is given. */
export async function createSeat(
  overrides: Partial<NewSeat> & Pick<NewSeat, "tournamentId" | "tableId" | "registrationId" | "seatNumber">,
  db: Database = getDb(),
): Promise<TournamentSeat> {
  const [seat] = await db.insert(tournamentSeats).values(overrides).returning();
  return seat;
}

/** One paid registration per name, in sign-up order; every player has an email and a phone, which no public body may show. */
export async function registerPlayers(
  tournamentId: string,
  names: readonly string[],
  overrides: Partial<NewRegistration> = {},
): Promise<TournamentRegistration[]> {
  const registrations: TournamentRegistration[] = [];
  for (const name of names) {
    const player = await createPlayer({ name, phone: "021 555 0100" });
    registrations.push(await createRegistration({ tournamentId, playerId: player.id, paymentConfirmed: true, ...overrides }));
  }
  return registrations;
}
