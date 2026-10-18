import { players, type Player } from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { uniqueSuffix } from "./sequence";

export type NewPlayer = typeof players.$inferInsert;

export function buildPlayer(overrides: Partial<NewPlayer> = {}): NewPlayer {
  const id = uniqueSuffix();
  return {
    name: `Test Player ${id}`,
    email: `player-${id}@example.test`,
    ...overrides,
  };
}

export async function createPlayer(overrides: Partial<NewPlayer> = {}, db: Database = getDb()): Promise<Player> {
  const [player] = await db.insert(players).values(buildPlayer(overrides)).returning();
  return player;
}
