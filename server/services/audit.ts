import type { Request } from "express";
import type { AuditAction, AuditData } from "@shared/api/admin";
import { db, type Executor } from "../db";
import { actingUserId } from "../http/authz";
import { clientIp } from "../http/rate-limits";
import { insertAuditEntry } from "../repositories/audit-log";

/**
 * One audit row: its action, what it is about, and that action's data as `AuditData` types it (what
 * changed: before/after, amounts, reasons; never passwords or session ids).
 */
export type AuditEntry = {
  [A in AuditAction]: { action: A; targetType?: string; targetId?: string } & (AuditData[A] extends null
    ? { data?: undefined }
    : { data: AuditData[A] });
}[AuditAction];

/**
 * Records a staff or admin action in audit_log. Pass the transaction that makes the change, so the
 * row exists exactly when the change does. The actor is the person at the keyboard: while an admin
 * impersonates someone, the admin, with the impersonated user in `data.asUserId`.
 */
export async function recordAudit(req: Request, entry: AuditEntry, executor: Executor = db): Promise<void> {
  const impersonating = req.impersonatorId !== undefined && req.user !== undefined;
  const data = impersonating ? { ...entry.data, asUserId: req.user?.id } : entry.data;
  await insertAuditEntry(executor, {
    actorUserId: actingUserId(req),
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    data: data ?? null,
    ip: clientIp(req),
  });
}
