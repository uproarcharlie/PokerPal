import { clubManagers, type ClubManager } from "@shared/schema";
import { getDb, type Database } from "../../server/db";

export type NewClubManager = typeof clubManagers.$inferInsert;

/** Makes `userId` a manager of `clubId`. Import by path (not via ./index): ./index is frozen in Phase 2. */
export async function createClubManager(
  manager: Pick<NewClubManager, "clubId" | "userId"> & Partial<NewClubManager>,
  db: Database = getDb(),
): Promise<ClubManager> {
  const [row] = await db.insert(clubManagers).values(manager).returning();
  return row;
}
