import crypto from "crypto";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { getPool } from "../db";
import type { AppEnv } from "./env";

const SESSION_COOKIE_NAME = "pokerpal.sid";

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Postgres-backed session store (table `session`, created on first use if missing). */
export function createPgSessionStore(pool: Pool = getPool()): connectPgSimple.PGStore {
  const PgStore = connectPgSimple(session);
  return new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: true,
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

declare module "express-session" {
  interface SessionData {
    userId: string;
    role: string;
    /** Set while an admin impersonates another user; restored by stop-impersonation. */
    originalAdminId?: string;
    originalAdminRole?: string;
  }
}
