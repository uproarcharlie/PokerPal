import { tournamentRegistrations, tournaments, type Tournament, type TournamentRegistration } from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { uniqueSuffix } from "./sequence";

export type NewTournament = typeof tournaments.$inferInsert;
export type NewRegistration = typeof tournamentRegistrations.$inferInsert;

/** Money columns are decimal(10,2): pass strings, as drizzle returns them ("50.00"). */
export function buildTournament(overrides: Partial<NewTournament> & Pick<NewTournament, "clubId">): NewTournament {
  return {
    name: `Test Tournament ${uniqueSuffix()}`,
    startDateTime: new Date("2026-03-01T19:00:00Z"),
    status: "scheduled",
    buyInAmount: "50.00",
    rakeType: "none",
    rakeAmount: "0.00",
    payoutStructure: "standard",
    maxPlayers: 50,
    ...overrides,
  };
}

export async function createTournament(
  overrides: Partial<NewTournament> & Pick<NewTournament, "clubId">,
  db: Database = getDb(),
): Promise<Tournament> {
  const [tournament] = await db.insert(tournaments).values(buildTournament(overrides)).returning();
  return tournament;
}

export function buildRegistration(
  overrides: Partial<NewRegistration> & Pick<NewRegistration, "tournamentId" | "playerId">,
): NewRegistration {
  return {
    buyIns: 1,
    rebuys: 0,
    addons: 0,
    knockouts: 0,
    isEliminated: false,
    paymentConfirmed: false,
    ...overrides,
  };
}

export async function createRegistration(
  overrides: Partial<NewRegistration> & Pick<NewRegistration, "tournamentId" | "playerId">,
  db: Database = getDb(),
): Promise<TournamentRegistration> {
  const [registration] = await db.insert(tournamentRegistrations).values(buildRegistration(overrides)).returning();
  return registration;
}
