import { and, asc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { tournamentRegistrations, tournaments, type Tournament } from "@shared/schema";
import type { Executor } from "../db";

/** Every column a service may write, including those the request schemas never accept. */
export type TournamentColumns = Partial<typeof tournaments.$inferInsert>;

export async function getTournament(ex: Executor, id: string): Promise<Tournament | undefined> {
  const [tournament] = await ex.select().from(tournaments).where(eq(tournaments.id, id));
  return tournament || undefined;
}

/**
 * The tournament row, locked until the transaction ends (SELECT ... FOR UPDATE): for changes to the
 * tournament itself (config, money, finalize). Registration writes take the lighter
 * `lockTournamentForRegistrationWrite` (repositories/registrations), which still queues behind this.
 */
export async function lockTournamentForUpdate(ex: Executor, id: string): Promise<Tournament | undefined> {
  const [tournament] = await ex.select().from(tournaments).where(eq(tournaments.id, id)).for("update");
  return tournament;
}

export interface TournamentListFilter {
  clubId?: string;
  seasonId?: string;
  status?: string;
  /**
   * Only tournaments still to come: scheduled or open for registration, starting no more than
   * UPCOMING_GRACE_HOURS ago (a game that began on time but whose status the TD has not moved on yet),
   * soonest start first. One left "scheduled" long after its date is not upcoming, so neither stale
   * games nor ones dated in the past can sit ahead of every real event on the home page (SEC-P2REV-04).
   */
  upcoming?: boolean;
  limit?: number;
}

/** How long after its start a scheduled tournament still counts as upcoming. */
export const UPCOMING_GRACE_HOURS = 12;

/**
 * Scheduled or open for registration, and starting no more than UPCOMING_GRACE_HOURS ago by the
 * database's clock. start_date_time holds UTC without a zone (as drizzle writes every time), so it is
 * compared with now() in UTC, whatever the session's time zone.
 */
function upcomingConditions(): SQL[] {
  return [
    inArray(tournaments.status, ["scheduled", "registration"]),
    gte(tournaments.startDateTime, sql`(now() AT TIME ZONE 'UTC') - make_interval(hours => ${UPCOMING_GRACE_HOURS})`),
  ];
}

export interface TournamentWithCounts {
  tournament: Tournament;
  registeredCount: number;
  confirmedPlayerCount: number;
  /** Registrations in the field by right: paid, or they have played (shared/domain/waiting-list inFieldByRight). */
  inFieldByRightCount: number;
}

/**
 * Tournaments matching every filter given, oldest created first (soonest start first for `upcoming`),
 * each with its registration counts: one query, however many tournaments (perf-19).
 */
export async function listTournamentsWithCounts(ex: Executor, filter: TournamentListFilter): Promise<TournamentWithCounts[]> {
  const conditions: SQL[] = [];
  if (filter.clubId) conditions.push(eq(tournaments.clubId, filter.clubId));
  if (filter.seasonId) conditions.push(eq(tournaments.seasonId, filter.seasonId));
  if (filter.status) conditions.push(eq(tournaments.status, filter.status));
  if (filter.upcoming) conditions.push(...upcomingConditions());
  const order = filter.upcoming
    ? [asc(tournaments.startDateTime), asc(tournaments.id)]
    : [asc(tournaments.createdAt), asc(tournaments.id)];

  const query = ex
    .select({
      tournament: tournaments,
      registeredCount: sql<number>`count(${tournamentRegistrations.id})`.mapWith(Number),
      confirmedPlayerCount: sql<number>`count(${tournamentRegistrations.id}) filter (where ${tournamentRegistrations.paymentConfirmed})`.mapWith(
        Number,
      ),
      // inFieldByRight in SQL: accepted (paid), or played (busted, placed, re-bought, added on or knocked someone out).
      inFieldByRightCount: sql<number>`count(${tournamentRegistrations.id}) filter (where ${tournamentRegistrations.paymentConfirmed} or ${tournamentRegistrations.isEliminated} or ${tournamentRegistrations.finalPosition} is not null or coalesce(${tournamentRegistrations.rebuys}, 0) > 0 or coalesce(${tournamentRegistrations.addons}, 0) > 0 or coalesce(${tournamentRegistrations.knockouts}, 0) > 0)`.mapWith(
        Number,
      ),
    })
    .from(tournaments)
    .leftJoin(tournamentRegistrations, eq(tournamentRegistrations.tournamentId, tournaments.id))
    .where(and(...conditions))
    .groupBy(tournaments.id)
    .orderBy(...order);
  return filter.limit === undefined ? await query : await query.limit(filter.limit);
}

/** How many tournaments there are of each club, season and status: one GROUP BY, for the counts. */
export async function countTournamentsByClubSeasonAndStatus(
  ex: Executor,
): Promise<Array<{ clubId: string; seasonId: string | null; status: string; count: number }>> {
  return ex
    .select({
      clubId: tournaments.clubId,
      seasonId: tournaments.seasonId,
      status: tournaments.status,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(tournaments)
    .groupBy(tournaments.clubId, tournaments.seasonId, tournaments.status);
}

/** A new tournament's columns, as the create service has checked them (its rates merged by mergeRakeRates). */
export type NewTournamentRow = typeof tournaments.$inferInsert;

export async function createTournament(ex: Executor, row: NewTournamentRow): Promise<Tournament> {
  const [tournament] = await ex.insert(tournaments).values(row).returning();
  return tournament;
}

/** Writes any columns, including the money and finalize ones the request schemas never accept (services only). */
export async function setTournamentColumns(ex: Executor, id: string, values: TournamentColumns): Promise<Tournament | undefined> {
  const [tournament] = await ex.update(tournaments).set(values).where(eq(tournaments.id, id)).returning();
  return tournament;
}

/** How many of the club's tournaments are upcoming (as the `upcoming` filter means it). */
export async function countUpcomingTournaments(ex: Executor, clubId: string): Promise<number> {
  const [row] = await ex
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(tournaments)
    .where(and(eq(tournaments.clubId, clubId), ...upcomingConditions()));
  return row?.count ?? 0;
}

/** Queues tournament creates for one club until the transaction ends, so its cap holds under concurrent requests. */
export async function lockClubTournamentCreates(ex: Executor, clubId: string): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`club-tournaments:${clubId}`}))`);
}

export async function deleteTournament(ex: Executor, id: string): Promise<boolean> {
  const result = await ex.delete(tournaments).where(eq(tournaments.id, id));
  return result.rowCount !== null && result.rowCount > 0;
}
