import type connectPgSimple from "connect-pg-simple";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../../server/app";
import { createPgSessionStore } from "../../server/config/auth";
import { loadEnv, setEnv } from "../../server/config/env";
import { closePool, getPool } from "../../server/db";

let app: Promise<Express> | undefined;
let sessionStore: connectPgSimple.PGStore | undefined;

/**
 * The app under test, built once per test file with createApp() from the
 * worker's env (test/setup/api.ts) and the same Postgres session store as
 * production. Use it with supertest: `request(await getApp()).get(...)`.
 */
export function getApp(): Promise<Express> {
  app ??= (async () => {
    const env = loadEnv(process.env);
    setEnv(env);
    sessionStore = createPgSessionStore(getPool());
    return createApp({ env, sessionStore });
  })();
  return app;
}

/** A supertest client with no session cookie, i.e. an anonymous visitor. */
export const anon = async () => request(await getApp());

/** Release the session store and DB pool so the worker can exit (registered by test/setup/api.ts). */
export async function closeTestApp(): Promise<void> {
  await sessionStore?.close();
  sessionStore = undefined;
  app = undefined;
  await closePool();
}
