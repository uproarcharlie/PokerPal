import { sql } from "drizzle-orm";
import type { Executor } from "../db";
import { SESSION_TABLE } from "../config/auth";

/**
 * Deletes every stored session signed in as the user, or in which they are the admin behind an
 * impersonation, except `exceptSid` (the caller's own session, e.g. after a password change).
 * Returns how many were deleted. `sess` is connect-pg-simple's json column.
 */
export async function deleteSessionsOfUser(ex: Executor, userId: string, exceptSid?: string): Promise<number> {
  const result = await ex.execute(sql`
    DELETE FROM ${sql.identifier(SESSION_TABLE)}
     WHERE (sess->>'userId' = ${userId} OR sess->>'originalAdminId' = ${userId})
       AND sid IS DISTINCT FROM ${exceptSid ?? null}`);
  return result.rowCount ?? 0;
}
