import { clubs, seasons, type Club, type Season } from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { uniqueSuffix } from "./sequence";

export type NewClub = typeof clubs.$inferInsert;
export type NewSeason = typeof seasons.$inferInsert;

export function buildClub(overrides: Partial<NewClub> = {}): NewClub {
  const id = uniqueSuffix();
  return {
    name: `Test Club ${id}`,
    slug: `test-club-${id}`,
    timezone: "Pacific/Auckland",
    ...overrides,
  };
}

export async function createClub(overrides: Partial<NewClub> = {}, db: Database = getDb()): Promise<Club> {
  const [club] = await db.insert(clubs).values(buildClub(overrides)).returning();
  return club;
}

export function buildSeason(overrides: Partial<NewSeason> & Pick<NewSeason, "clubId">): NewSeason {
  return {
    name: `Test Season ${uniqueSuffix()}`,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-12-31T00:00:00Z"),
    isActive: true,
    ...overrides,
  };
}

export async function createSeason(
  overrides: Partial<NewSeason> & Pick<NewSeason, "clubId">,
  db: Database = getDb(),
): Promise<Season> {
  const [season] = await db.insert(seasons).values(buildSeason(overrides)).returning();
  return season;
}
