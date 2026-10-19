import crypto from "crypto";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { getPool } from "../db";
import type { AppEnv } from "./env";

export const SESSION_COOKIE_NAME = "pokerpal.sid";

/** The Postgres table sessions live in. server/repositories/sessions.ts revokes rows in it directly. */
export const SESSION_TABLE = "session";

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Postgres-backed session store (table `session`, created on first use if missing).
 *
 * Touching is off: sessions are not rolling, so the browser's cookie expires 7 days after sign-in
 * whatever the store says, and a touch would only rewrite the row's expiry on every request (CC-12).
 */
export function createPgSessionStore(pool: Pool = getPool()): connectPgSimple.PGStore {
  const PgStore = connectPgSimple(session);
  return new PgStore({
    pool,
    tableName: SESSION_TABLE,
    createTableIfMissing: true,
    disableTouch: true,
  });
}

export function createSessionMiddleware(
  env: AppEnv,
  store: session.Store = createPgSessionStore(),
): RequestHandler {
  let secret = env.SESSION_SECRET;
  if (!secret) {
    // Only reachable outside production: loadEnv() requires SESSION_SECRET there.
    secret = crypto.randomBytes(32).toString("hex");
    console.warn("⚠️  SESSION_SECRET not set in .env, using random generated secret (sessions will reset on server restart)");
  }

  return session({
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: SESSION_MAX_AGE_MS,
      httpOnly: true,
      secure: env.NODE_ENV === "production", // HTTPS only in production
      sameSite: "lax",
    },
    name: SESSION_COOKIE_NAME,
  });
}

/**
 * What a session stores. Only `userId` identifies the user: role and active status are read from the
 * database on every request (server/http/authz.ts), never from here.
 */
declare module "express-session" {
  interface SessionData {
    userId: string;
    /** The admin who started an impersonation of `userId`; restored by stop-impersonation. */
    originalAdminId?: string;
    /** When the impersonation started (ISO 8601). */
    impersonationStartedAt?: string;
    /**
     * Written but never read, for one release (P2-PROD-03): the build before Phase 2 authorized admin
     * routes from `role` and restored `originalAdminRole` after an impersonation, and shares the cookie
     * and session table, so a rollback keeps sessions started after the deploy working. Remove once
     * Phase 2 is the oldest build a rollback could go to.
     */
    role?: string;
    originalAdminRole?: string;
  }
}
