import { and, asc, eq, exists, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { pickFields, PUBLIC_PLAYER_FIELDS } from "@shared/api/public";
import { clubs, playerHomeClubs, players, tournamentRegistrations, tournaments, type InsertPlayer, type Player } from "@shared/schema";
import type { Executor } from "../db";

/** The columns of PUBLIC_PLAYER_FIELDS, for a select that returns a PublicPlayer (activity, leaderboard). */
export const publicPlayerColumns = pickFields(players, PUBLIC_PLAYER_FIELDS);

export async function getPlayer(ex: Executor, id: string): Promise<Player | undefined> {
  const [player] = await ex.select().from(players).where(eq(players.id, id));
  return player || undefined;
}

export async function createPlayer(ex: Executor, insertPlayer: InsertPlayer): Promise<Player> {
  const [player] = await ex.insert(players).values(insertPlayer).returning();
  return player;
}

export async function updatePlayer(ex: Executor, id: string, playerData: Partial<InsertPlayer>): Promise<Player | undefined> {
  const [player] = await ex.update(players).set(playerData).where(eq(players.id, id)).returning();
  return player || undefined;
}

/** `%text%` for ILIKE, with the pattern characters in `text` matched literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * "Known at a club", as (player_id, club_id) pairs: the player registered for one of the club's
 * tournaments, or it is their home club (the club that added them: a player staff create, or a QR
 * sign-up whose registration did not go through, has a home club before any registration). The one
 * statement of the rule: the staff Players list, the QR search, an anonymous sign-up's reach and the
 * member counts (a club's page, the clubs list, the staff dashboard) are all built on it
 * (P2REV4-CQ2-12). A pair can appear more than once, so count distinct players.
 */
const knownPlayerClubs = sql`(
  SELECT r.player_id, t.club_id FROM ${tournamentRegistrations} r JOIN ${tournaments} t ON t.id = r.tournament_id
  UNION ALL
  SELECT h.player_id, h.club_id FROM ${playerHomeClubs} h
)`;

/** `known.club_id IN (clubIds)`, or false for no clubs. */
const knownClubIn = (clubIds: readonly string[]): SQL =>
  clubIds.length === 0 ? sql`false` : sql`known.club_id IN (${sql.join(clubIds.map((id) => sql`${id}`), sql`, `)})`;

/** The player belongs with one of these clubs (knownPlayerClubs). */
function knownAtClubs(clubIds: readonly string[]): SQL {
  return exists(sql`(SELECT 1 FROM ${knownPlayerClubs} known WHERE known.player_id = ${players.id} AND ${knownClubIn(clubIds)})`);
}

/** The player belongs with some club. */
function knownAnywhere(): SQL {
  return exists(sql`(SELECT 1 FROM ${knownPlayerClubs} known WHERE known.player_id = ${players.id})`);
}

/** How many players are known at any of these clubs (each counted once). */
export async function countPlayersKnownAt(ex: Executor, clubIds: readonly string[]): Promise<number> {
  if (clubIds.length === 0) return 0;
  const { rows } = await ex.execute<{ count: string }>(
    sql`SELECT count(DISTINCT known.player_id) AS count FROM ${knownPlayerClubs} known WHERE ${knownClubIn(clubIds)}`,
  );
  return Number(rows[0]?.count ?? 0);
}

/** Every club's count of players known at it, in one query; a club with none counts 0. */
export async function countPlayersKnownAtEachClub(ex: Executor): Promise<Map<string, number>> {
  const { rows } = await ex.execute<{ club_id: string; count: string }>(sql`
    SELECT c.id AS club_id, count(DISTINCT known.player_id) AS count
      FROM ${clubs} c
      LEFT JOIN ${knownPlayerClubs} known ON known.club_id = c.id
     GROUP BY c.id`);
  return new Map(rows.map((row) => [row.club_id, Number(row.count)]));
}

export interface PlayerFilter {
  /**
   * Only players known at one of these clubs (registered there, or it is their home club); "known"
   * for anyone known at some club; "all" for no restriction (players nobody owns included).
   */
  clubIds: readonly string[] | "known" | "all";
  /** Name contains this (case-insensitive). */
  nameContains?: string;
  limit?: number;
}

/** Players matching `filter`, ordered by `order` (then id). Empty when `clubIds` is an empty list. */
export async function findPlayers(ex: Executor, filter: PlayerFilter, order: "created" | "name"): Promise<Player[]> {
  if (Array.isArray(filter.clubIds) && filter.clubIds.length === 0) return [];
  const conditions: SQL[] = [];
  if (filter.clubIds === "known") conditions.push(knownAnywhere());
  else if (filter.clubIds !== "all") conditions.push(knownAtClubs(filter.clubIds));
  if (filter.nameContains) conditions.push(ilike(players.name, containsPattern(filter.nameContains)));
  const query = ex
    .select()
    .from(players)
    .where(and(...conditions))
    .orderBy(...(order === "name" ? [asc(players.name)] : [asc(players.createdAt)]), asc(players.id));
  return filter.limit === undefined ? await query : await query.limit(filter.limit);
}

/**
 * Players whose phone has these digits once everything else is stripped, oldest first. Callers
 * compare `normalisePhone` themselves (a leading "+" matters), so one indexed-or-not scan in SQL
 * replaces loading the whole table (perf-24).
 */
export async function findPlayersByPhoneDigits(ex: Executor, digits: string): Promise<Player[]> {
  return await ex
    .select()
    .from(players)
    .where(sql`regexp_replace(${players.phone}, '[^0-9]', '', 'g') = ${digits}`)
    .orderBy(asc(players.createdAt), asc(players.id));
}

/**
 * Serialises sign-ups that use the same phone number until the transaction ends, so two at once
 * cannot both create a player for it.
 */
export async function lockPhoneNumber(ex: Executor, normalisedPhone: string): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`player-phone:${normalisedPhone}`}))`);
}

/** Player names by player id (players missing from the table are left out). */
export async function playerNames(ex: Executor, playerIds: readonly string[]): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map();
  const rows = await ex
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(inArray(players.id, Array.from(new Set(playerIds))));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Each player's home club (player_home_clubs): the club that added them (staff creating the player,
 * or the QR page of one of its tournaments), else the club of their first registration; recorded once
 * and never changed. Players with none are left out. Deleting that club's tournaments, or the club
 * itself, does not move it, so nothing anyone does later hands the player's contact details or edits
 * to another club (see canManagePlayer in server/http/authz.ts).
 */
export async function homeClubIds(ex: Executor, playerIds: readonly string[]): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map();
  const rows = await ex
    .select({ playerId: playerHomeClubs.playerId, clubId: playerHomeClubs.clubId })
    .from(playerHomeClubs)
    .where(inArray(playerHomeClubs.playerId, Array.from(new Set(playerIds))));
  return new Map(rows.map((row) => [row.playerId, row.clubId]));
}

/**
 * Records `clubId` as a new player's home club: the club that is adding them (P2REV0-SEC-03). Call it
 * with the transaction that creates the player. A home club already recorded is never replaced.
 */
export async function claimHomeClub(ex: Executor, playerId: string, clubId: string): Promise<void> {
  await ex.insert(playerHomeClubs).values({ playerId, clubId }).onConflictDoNothing({ target: playerHomeClubs.playerId });
}

/**
 * Records the club of the player's first surviving registration (registration time, then id) as
 * their home club, unless they already have one: the rule the boot seed applies, so the result is
 * the same whichever build wrote their earlier registrations (P2REV3-PROD-03). Call it with the
 * transaction that creates a registration, after inserting it.
 */
export async function claimHomeClubFromFirstRegistration(ex: Executor, playerId: string): Promise<void> {
  await ex.execute(sql`
    INSERT INTO ${playerHomeClubs} (player_id, club_id)
    SELECT r.player_id, t.club_id
      FROM ${tournamentRegistrations} r
      JOIN ${tournaments} t ON t.id = r.tournament_id
     WHERE r.player_id = ${playerId}
     ORDER BY r.registration_time, r.id
     LIMIT 1
    ON CONFLICT (player_id) DO NOTHING`);
}

export interface RegistrationHistory {
  /** Their latest registration anywhere, or null. */
  lastRegisteredAt: Date | null;
  /** Their latest registration at the club asked about, or null. */
  lastRegisteredAtClub: Date | null;
}

/** For each of `playerIds` who has registered: when they last did, anywhere and at `clubId`. */
export async function registrationHistory(
  ex: Executor,
  playerIds: readonly string[],
  clubId: string | null,
): Promise<Map<string, RegistrationHistory>> {
  if (playerIds.length === 0) return new Map();
  const rows = await ex
    .select({
      playerId: tournamentRegistrations.playerId,
      lastRegisteredAt: sql<Date | null>`max(${tournamentRegistrations.registrationTime})`.mapWith(tournamentRegistrations.registrationTime),
      lastRegisteredAtClub: sql<Date | null>`max(${tournamentRegistrations.registrationTime}) filter (where ${tournaments.clubId} = ${clubId})`.mapWith(
        tournamentRegistrations.registrationTime,
      ),
    })
    .from(tournamentRegistrations)
    .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
    .where(inArray(tournamentRegistrations.playerId, Array.from(new Set(playerIds))))
    .groupBy(tournamentRegistrations.playerId);
  return new Map(rows.map(({ playerId, ...history }) => [playerId, history]));
}

/** Whether the player is known at the club, registered there or added by it (who the QR page's search finds for it). */
export async function isKnownAtClub(ex: Executor, playerId: string, clubId: string): Promise<boolean> {
  const [row] = await ex
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.id, playerId), knownAtClubs([clubId])))
    .limit(1);
  return row !== undefined;
}
