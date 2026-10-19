import { Router } from "express";
import { adminUpdateUserSchema, auditLogQuerySchema, type AdminUpdateUserInput } from "@shared/api/admin";
import { asyncHandler } from "../http/async-handler";
import { requireAdmin, requireAuth } from "../http/authz";
import { parseOrThrow, validateBody } from "../http/validate";
import {
  ADMIN_UPDATE_INVALID_MESSAGE,
  auditLogEntries,
  listUsersAndPlayers,
  startImpersonation,
  stopImpersonation,
  updateUserAsAdmin,
} from "../services/admin";

type UserParams = { userId: string };

/** Platform admin (users.role = 'admin', read from the database on every request): users, impersonation, audit log. */
export function adminRoutes(): Router {
  const router = Router();

  router.get(
    "/api/admin/users",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      res.json(await listUsersAndPlayers());
    }),
  );

  router.put(
    "/api/admin/users/:userId",
    requireAdmin,
    validateBody(adminUpdateUserSchema, { message: ADMIN_UPDATE_INVALID_MESSAGE }),
    asyncHandler<UserParams, unknown, AdminUpdateUserInput>(async (req, res) => {
      const user = await updateUserAsAdmin(req, req.params.userId, req.body);
      res.json({ message: "User updated successfully", user });
    }),
  );

  router.post(
    "/api/admin/users/:userId/impersonate",
    requireAdmin,
    asyncHandler<UserParams>(async (req, res) => {
      const user = await startImpersonation(req, req.params.userId);
      res.json({ message: "Impersonation started", user });
    }),
  );

  // Any signed-in user: while impersonating, the session's user is the impersonated (non-admin) one.
  router.post(
    "/api/admin/stop-impersonation",
    requireAuth,
    asyncHandler(async (req, res) => {
      const admin = await stopImpersonation(req, res);
      res.json({ message: "Impersonation ended", user: admin });
    }),
  );

  router.get(
    "/api/admin/audit-log",
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json(await auditLogEntries(parseOrThrow(auditLogQuerySchema, req.query, { message: "Invalid audit log query" })));
    }),
  );

  return router;
}
