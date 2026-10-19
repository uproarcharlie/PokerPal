/** Platform admin: the user list, admin edits of accounts, impersonation and the audit log. */
import type { Request, Response } from "express";
import type { AdminUpdateUserInput, AdminUserRow, AuditLogQuery, UserRole } from "@shared/api/admin";
import type { AuditLogEntry } from "@shared/schema";
import { db } from "../db";
import { currentUser } from "../http/authz";
import { badRequest, conflict, HttpError, notFound, unauthenticated } from "../http/errors";
import { listAuditLog } from "../repositories/audit-log";
import {
  findUserById,
  isEmailTaken,
  listPlayersForAdmin,
  listSafeUsers,
  lockActiveAdminIds,
  lockUser,
  updateUserFields,
  type SafeUser,
} from "../repositories/users";
import { recordAudit } from "./audit";
import { assertEmailAcceptable, EMAIL_TAKEN_MESSAGE } from "./auth";
import { endSession, revokeUserSessions, startSession } from "./sessions";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Any role other than admin grants exactly what full_member does, so it is listed as that. */
const listedRole = (role: string): UserRole => (role === "admin" ? "admin" : "full_member");

const isActiveAdmin = (user: Pick<SafeUser, "role" | "isActive">) => user.role === "admin" && user.isActive === true;

/** Accounts and players in one list, newest first (the shape the user management page reads). */
export async function listUsersAndPlayers(): Promise<AdminUserRow[]> {
  const [accounts, players] = await Promise.all([listSafeUsers(db), listPlayersForAdmin(db)]);
  const rows: AdminUserRow[] = [
    ...accounts.map((user) => ({
      type: "user" as const,
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: listedRole(user.role),
      isActive: user.isActive,
      lastLoginAt: iso(user.lastLoginAt),
      createdAt: iso(user.createdAt),
    })),
    ...players.map((player) => ({
      type: "player" as const,
      id: player.id,
      name: player.name,
      email: player.email || null,
      phone: player.phone || null,
      role: "club_member" as const,
      isActive: true as const,
      lastLoginAt: null,
      createdAt: iso(player.createdAt),
      userId: player.userId,
    })),
  ];
  // Stable for equal times: users before players, each in creation order.
  return rows.sort((a, b) => Date.parse(b.createdAt ?? "1970-01-01") - Date.parse(a.createdAt ?? "1970-01-01"));
}

const EDITABLE_FIELDS = ["name", "email", "phone", "role", "isActive"] as const;

export const ADMIN_UPDATE_INVALID_MESSAGE = "Invalid user data";

/**
 * An admin's edit of another account. Only the fields sent change (an absent phone is kept: SEC-14).
 * Admins cannot demote or disable themselves, and the last active admin cannot be demoted or
 * disabled. Losing admin rights or being disabled signs the account out everywhere, including any
 * impersonation it started (SEC-11). The change, its audit row (`user.update`, before/after of the
 * changed fields) and the sign-outs commit together.
 */
export async function updateUserAsAdmin(req: Request, targetId: string, input: AdminUpdateUserInput): Promise<SafeUser> {
  const mayRemoveAdmin = (input.role !== undefined && input.role !== "admin") || input.isActive === false;
  if (targetId === req.user?.id && mayRemoveAdmin) {
    throw badRequest("You can't remove your own admin access or disable your own account", "CANNOT_MODIFY_SELF");
  }

  return db.transaction(async (tx) => {
    // Locked in a fixed order (active admins by id, then the target), so concurrent edits queue, never deadlock.
    const activeAdminIds = mayRemoveAdmin ? await lockActiveAdminIds(tx) : [];
    const before = await lockUser(tx, targetId);
    if (!before) throw notFound("User not found");

    if (input.email !== undefined) {
      assertEmailAcceptable(input.email, before.email, ADMIN_UPDATE_INVALID_MESSAGE);
      if (await isEmailTaken(tx, input.email, targetId)) throw conflict("EMAIL_TAKEN", EMAIL_TAKEN_MESSAGE);
    }
    const remainsActiveAdmin = isActiveAdmin({ role: input.role ?? before.role, isActive: input.isActive ?? before.isActive });
    if (isActiveAdmin(before) && !remainsActiveAdmin && !activeAdminIds.some((id) => id !== targetId)) {
      throw conflict("LAST_ADMIN", "There must always be at least one active admin");
    }

    const after = await updateUserFields(tx, targetId, {
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      isActive: input.isActive,
    });
    if (!after) throw notFound("User not found");

    const changed = EDITABLE_FIELDS.filter((field) => before[field] !== after[field]);
    if (changed.length > 0) {
      const pick = (user: SafeUser) => Object.fromEntries(changed.map((field) => [field, user[field]]));
      await recordAudit(req, { action: "user.update", targetType: "user", targetId, data: { before: pick(before), after: pick(after) } }, tx);
    }

    const lostAdmin = before.role === "admin" && after.role !== "admin";
    const disabled = before.isActive === true && after.isActive !== true;
    if (lostAdmin || disabled) await revokeUserSessions(targetId, { executor: tx });
    return after;
  });
}

/**
 * Switches the admin's browser to `targetId` under a new session id, remembering the admin so they
 * can switch back (SEC-12, SEC-13). Admins (including oneself) and disabled accounts cannot be
 * impersonated. Audited as `impersonation.start` before the switch, so none goes unrecorded.
 */
export async function startImpersonation(req: Request, targetId: string): Promise<SafeUser> {
  const admin = currentUser(req);
  const target = await findUserById(db, targetId);
  if (!target) throw notFound("User not found");
  if (target.role === "admin") throw new HttpError(403, "CANNOT_IMPERSONATE_ADMIN", "Admins can't be impersonated");
  if (target.isActive !== true) throw conflict("USER_INACTIVE", "That account is disabled");

  await recordAudit(req, { action: "impersonation.start", targetType: "user", targetId: target.id });
  await startSession(req, {
    userId: target.id,
    role: target.role,
    originalAdminId: admin.id,
    originalAdminRole: admin.role,
    impersonationStartedAt: new Date().toISOString(),
  });
  return target;
}

/** How an impersonation ended: the exit button, signing out, or signing in to another account. */
export type ImpersonationEnd = "stop" | "sign-out" | "sign-in";

/** Records the end of the impersonation this request's session is in, if any (`impersonation.stop`). */
export async function recordImpersonationEnd(req: Request, endedBy: ImpersonationEnd, restored = false): Promise<void> {
  if (!req.impersonatorId || !req.user) return;
  await recordAudit(req, {
    action: "impersonation.stop",
    targetType: "user",
    targetId: req.user.id,
    data: { startedAt: req.session.impersonationStartedAt ?? null, endedBy, restored },
  });
}

/**
 * Switches the browser back to the admin who started the impersonation, under a new session id,
 * but only if they are still an active admin in the database (SEC-11). Otherwise the session is
 * ended and the caller must sign in again (401).
 */
export async function stopImpersonation(req: Request, res: Response): Promise<SafeUser> {
  const adminId = req.session.originalAdminId;
  if (!adminId) throw badRequest("Not currently impersonating", "NOT_IMPERSONATING");

  const admin = await findUserById(db, adminId);
  const restore = admin !== undefined && isActiveAdmin(admin);
  await recordImpersonationEnd(req, "stop", restore);
  if (!admin || !restore) {
    await endSession(req, res);
    throw unauthenticated("Your admin access has ended. Please sign in again.");
  }

  await startSession(req, { userId: admin.id, role: admin.role });
  return admin;
}

/** GET /api/admin/audit-log: newest first, filtered and paged as the query asks. */
export function auditLogEntries(query: AuditLogQuery): Promise<AuditLogEntry[]> {
  return listAuditLog(db, query);
}
