import { asc, eq } from "drizzle-orm";
import { seasons, type Season } from "@shared/schema";
import type { Executor } from "../db";

/** A season's columns as written (an absent or null endDate is an open-ended season). */
export type SeasonValues = typeof seasons.$inferInsert;

export async function getSeason(ex: Executor, id: string): Promise<Season | undefined> {
  const [season] = await ex.select().from(seasons).where(eq(seasons.id, id));
  return season || undefined;
}

/** The season's row, locked until the transaction ends. */
export async function lockSeason(ex: Executor, id: string): Promise<Season | undefined> {
  const [season] = await ex.select().from(seasons).where(eq(seasons.id, id)).for("update");
  return season;
}

/** Every season, oldest first. */
export async function getSeasons(ex: Executor): Promise<Season[]> {
  return ex.select().from(seasons).orderBy(asc(seasons.createdAt), asc(seasons.id));
}

/** The club's seasons, oldest first. */
export async function getSeasonsByClub(ex: Executor, clubId: string): Promise<Season[]> {
  return ex.select().from(seasons).where(eq(seasons.clubId, clubId)).orderBy(asc(seasons.createdAt), asc(seasons.id));
}

export async function createSeason(ex: Executor, insertSeason: SeasonValues): Promise<Season> {
  const [season] = await ex.insert(seasons).values(insertSeason).returning();
  return season;
}

export async function updateSeason(ex: Executor, id: string, seasonData: Partial<SeasonValues>): Promise<Season | undefined> {
  const [season] = await ex.update(seasons).set(seasonData).where(eq(seasons.id, id)).returning();
  return season || undefined;
}

/** The deleted season, or undefined when there was none. Its points systems go with it (FK cascade). */
export async function deleteSeasonReturning(ex: Executor, id: string): Promise<Season | undefined> {
  const [season] = await ex.delete(seasons).where(eq(seasons.id, id)).returning();
  return season;
}
