import { and, asc, count, eq, isNotNull, ne, sql } from "drizzle-orm";
import { clubs, tournaments, type Club, type InsertClub } from "@shared/schema";
import type { Executor } from "../db";

export async function getClub(ex: Executor, id: string): Promise<Club | undefined> {
  const [club] = await ex.select().from(clubs).where(eq(clubs.id, id));
  return club || undefined;
}

/** The club's row, locked until the transaction ends, so concurrent edits of one club apply in turn. */
export async function lockClub(ex: Executor, id: string): Promise<Club | undefined> {
  const [club] = await ex.select().from(clubs).where(eq(clubs.id, id)).for("update");
  return club;
}

const slugIs = (slug: string) => sql`lower(${clubs.slug}) = lower(${slug})`;

/**
 * The club at `/club/<slug>`, ignoring case (CC-17). Legacy slugs may differ from each other only in
 * case, so an exact match wins, then the oldest club.
 */
export async function getClubBySlug(ex: Executor, slug: string): Promise<Club | undefined> {
  const [club] = await ex
    .select()
    .from(clubs)
    .where(slugIs(slug))
    .orderBy(sql`${clubs.slug} = ${slug} DESC`, asc(clubs.createdAt), asc(clubs.id))
    .limit(1);
  return club;
}

/** Whether a club other than `exceptId` already answers `slug`, ignoring case. */
export async function isSlugTaken(ex: Executor, slug: string, exceptId?: string): Promise<boolean> {
  const [row] = await ex
    .select({ id: clubs.id })
    .from(clubs)
    .where(exceptId ? and(slugIs(slug), ne(clubs.id, exceptId)) : slugIs(slug))
    .limit(1);
  return row !== undefined;
}

/** Every club, oldest first (the first `limit` when given). */
export async function getClubs(ex: Executor, limit?: number): Promise<Club[]> {
  const query = ex.select().from(clubs).orderBy(asc(clubs.createdAt), asc(clubs.id));
  return limit === undefined ? await query : await query.limit(limit);
}

/** How many clubs the account owns. */
export async function countClubsOwnedBy(ex: Executor, ownerId: string): Promise<number> {
  const [row] = await ex.select({ total: count() }).from(clubs).where(eq(clubs.ownerId, ownerId));
  return row?.total ?? 0;
}

/** Makes one account's club creates take turns until the transaction ends, so their count stays true. */
export async function lockClubsOfOwner(ex: Executor, ownerId: string): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`club-owner:${ownerId}`}))`);
}

export async function createClub(ex: Executor, insertClub: InsertClub): Promise<Club> {
  const [club] = await ex.insert(clubs).values(insertClub).returning();
  return club;
}

export async function updateClub(ex: Executor, id: string, clubData: Partial<InsertClub>): Promise<Club | undefined> {
  const [club] = await ex.update(clubs).set(clubData).where(eq(clubs.id, id)).returning();
  return club || undefined;
}

/** The banner of every tournament the club has that has one (what deleting the club leaves in storage). */
export async function clubTournamentImageUrls(ex: Executor, clubId: string): Promise<string[]> {
  const rows = await ex
    .select({ imageUrl: tournaments.imageUrl })
    .from(tournaments)
    .where(and(eq(tournaments.clubId, clubId), isNotNull(tournaments.imageUrl)));
  return rows.flatMap((row) => (row.imageUrl ? [row.imageUrl] : []));
}

/**
 * The deleted club, or undefined when there was none. Its seasons, tournaments and registrations go
 * with it (FK cascades); players stay.
 */
export async function deleteClubReturning(ex: Executor, id: string): Promise<Club | undefined> {
  const [club] = await ex.delete(clubs).where(eq(clubs.id, id)).returning();
  return club;
}
