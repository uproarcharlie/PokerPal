import type { Request, Response } from "express";
import type { SessionData } from "express-session";
import { db, type Executor } from "../db";
import { SESSION_COOKIE_NAME } from "../config/auth";
import { HttpError } from "../http/errors";
import { deleteSessionsOfUser } from "../repositories/sessions";

export type SessionIdentity = Pick<SessionData, "userId" | "role"> &
  Partial<Pick<SessionData, "originalAdminId" | "impersonationStartedAt" | "originalAdminRole">>;

/** express-session skips a request (no `req.session`) while its store is disconnected. */
function sessionOf(req: Request) {
  const current = req.session as Request["session"] | undefined;
  if (!current) throw new HttpError(503, "SERVICE_UNAVAILABLE", "Signing in is unavailable right now. Please try again.");
  return current;
}

/**
 * Signs the browser in as `identity` under a brand-new session id (SEC-12): the old session is
 * deleted from the store, so a session id known before sign-in (or before an impersonation starts or
 * ends) is useless afterwards. express-session saves the new session before the response is sent.
 */
export function startSession(req: Request, identity: SessionIdentity): Promise<void> {
  const current = sessionOf(req);
  return new Promise((resolve, reject) => {
    current.regenerate((error: unknown) => {
      if (error) return reject(error);
      Object.assign(req.session, identity);
      resolve();
    });
  });
}

/** Signs the browser out: the session is deleted from the store and the cookie cleared. Idempotent. */
export async function endSession(req: Request, res: Response): Promise<void> {
  const current = req.session as Request["session"] | undefined;
  if (current) {
    await new Promise<void>((resolve, reject) => current.destroy((error: unknown) => (error ? reject(error) : resolve())));
  }
  res.clearCookie(SESSION_COOKIE_NAME);
}

/**
 * Signs the user out everywhere (SEC-11): after a password change (keeping `exceptSid`, the
 * caller's own session), a demotion or a deactivation. Also ends impersonations they started.
 */
export function revokeUserSessions(userId: string, options: { exceptSid?: string; executor?: Executor } = {}): Promise<number> {
  return deleteSessionsOfUser(options.executor ?? db, userId, options.exceptSid);
}
