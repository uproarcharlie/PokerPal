import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import { auditLog, type AuditLogEntry } from "@shared/schema";
import type { AuditLogQuery } from "@shared/api/admin";
import type { Executor } from "../db";

/** Writes one audit_log row (server/services/audit.ts decides what goes in it). */
export async function insertAuditEntry(ex: Executor, entry: typeof auditLog.$inferInsert): Promise<void> {
  await ex.insert(auditLog).values(entry);
}

/** audit_log rows, newest first, filtered as the query asks. Rows are written by server/services/audit.ts. */
export async function listAuditLog(ex: Executor, query: AuditLogQuery): Promise<AuditLogEntry[]> {
  const filters: SQL[] = [];
  if (query.before) filters.push(lt(auditLog.createdAt, query.before));
  if (query.actorUserId) filters.push(eq(auditLog.actorUserId, query.actorUserId));
  if (query.targetType) filters.push(eq(auditLog.targetType, query.targetType));
  if (query.targetId) filters.push(eq(auditLog.targetId, query.targetId));

  return ex
    .select()
    .from(auditLog)
    .where(and(...filters))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(query.limit);
}
