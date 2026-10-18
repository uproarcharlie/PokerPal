/**
 * The one gate in front of every database that tests, e2e runs and seed scripts
 * create, truncate or drop. It refuses to hand out a connection string unless
 * it points at a throwaway database on this machine, so neither the owner's dev
 * data nor production can ever be the target.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseDotEnv } from "dotenv";
import { parse as parseConnectionString } from "pg-connection-string";
import { reservedSegmentOf } from "./database-names";

export type GuardEnv = Readonly<Record<string, string | undefined>>;

export const DEFAULT_TEST_DB_NAME = "pokerpal_test";
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);
/** `…_test`, or `…_test_<suffix>` for per-unit, per-worker and template databases. */
export const TEST_DB_NAME_PATTERN = /_test(_[a-z0-9_]+)?$/;
/** Names are interpolated into CREATE/DROP DATABASE, so only plain lower-case identifiers are allowed. */
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

export interface SafeTestDb {
  /** Connection string for the test database. */
  url: string;
  host: string;
  port: string;
  database: string;
}

const nonEmpty = (value: string | undefined) => (value === undefined || value === "" ? undefined : value);

/** `url` with its database (path) replaced; credentials, host and query are kept. */
export function withDatabase(url: string, database: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never echo the input: it may carry a password.
    throw new UnsafeTestDatabaseError("The database connection string could not be parsed");
  }
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * The URL of a run's base test database, which its other databases are named
 * after (./database-names.ts): TEST_DATABASE_URL when set, otherwise the
 * (local) dev DATABASE_URL's server. TEST_DB_NAME, when set, always names the
 * database, so parallel runs can each use their own; it defaults to
 * `pokerpal_test` for the DATABASE_URL route. A name with a segment that only
 * derived names have (e.g. `pokerpal_test_w2`) is refused: it is another run's
 * worker clone, which that run would drop.
 */
export function resolveTestDbUrl(env: GuardEnv): string {
  const name = nonEmpty(env.TEST_DB_NAME);
  const explicit = nonEmpty(env.TEST_DATABASE_URL);
  const devUrl = nonEmpty(env.DATABASE_URL);
  let url: string;
  if (explicit) {
    url = name ? withDatabase(explicit, name) : explicit;
  } else if (devUrl) {
    url = withDatabase(devUrl, name ?? DEFAULT_TEST_DB_NAME);
  } else {
    throw new UnsafeTestDatabaseError(
      "No test database configured: set TEST_DATABASE_URL, or DATABASE_URL for a local Postgres server " +
        "(see test/README.md; `npm run db:test:up` starts one in Docker)",
    );
  }
  refuseDerivedBaseName(url);
  return url;
}

function refuseDerivedBaseName(url: string): void {
  let database: string | null | undefined;
  try {
    database = parseConnectionString(url).database;
  } catch {
    return; // assertSafeTestDbUrl reports a string it cannot parse.
  }
  const segment = database ? reservedSegmentOf(database) : undefined;
  if (segment) {
    throw new UnsafeTestDatabaseError(
      `Refusing to name a test run ${JSON.stringify(database)}: "_${segment}" is reserved for the databases a run ` +
        "derives from its name (_w<n> worker clones, _template, _e2e), so another run could drop it. " +
        "Choose a TEST_DB_NAME without it, e.g. TEST_DB_NAME=pokerpal_test_mybranch.",
    );
  }
}

/**
 * Validate an explicit connection string against the guard rules. It is parsed
 * with the same parser `pg` uses, so `?host=` overrides and the like are judged
 * by where pg would actually connect.
 */
export function assertSafeTestDbUrl(url: string, env: GuardEnv): SafeTestDb {
  const problems: string[] = [];

  if (env.NODE_ENV !== "test") {
    problems.push(`NODE_ENV must be "test" (it is ${JSON.stringify(env.NODE_ENV ?? "")})`);
  }

  const railwayVars = Object.keys(env).filter((key) => key.startsWith("RAILWAY_"));
  if (railwayVars.length > 0) {
    problems.push(`Railway variables are set (${railwayVars.join(", ")}); tests never run in a Railway environment`);
  }

  let host = "";
  let port = "5432";
  let database = "";
  try {
    const config = parseConnectionString(url);
    host = (config.host ?? "").replace(/^\[(.*)\]$/, "$1");
    port = config.port || port;
    database = config.database ?? "";
  } catch {
    problems.push("the connection string could not be parsed");
  }

  if (!LOCAL_HOSTS.has(host)) {
    problems.push(`host must be localhost, 127.0.0.1 or ::1 (it is ${JSON.stringify(host)})`);
  }
  if (!SAFE_IDENTIFIER.test(database) || !TEST_DB_NAME_PATTERN.test(database)) {
    problems.push(
      `database name must end in _test or _test_<suffix> and use only a-z, 0-9 and _ (it is ${JSON.stringify(database)})`,
    );
  }

  if (problems.length > 0) {
    throw new UnsafeTestDatabaseError(
      `Refusing to use ${host || "(no host)"}:${port}/${database || "(no database)"} as a test database:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
  }
  return { url, host, port, database };
}

/** Resolve the test database from `env` and validate it. Throws UnsafeTestDatabaseError otherwise. */
export function assertSafeTestDb(env: GuardEnv = guardEnv()): SafeTestDb {
  return assertSafeTestDbUrl(resolveTestDbUrl(env), env);
}

const DOTENV_KEYS = ["DATABASE_URL", "TEST_DATABASE_URL", "TEST_DB_NAME"] as const;

/**
 * `processEnv` plus the database settings from the repo's `.env` that the
 * process does not already set. Nothing else is taken from `.env`: its
 * NODE_ENV=development, for one, must never reach a test run.
 */
export function guardEnv(
  processEnv: GuardEnv = process.env,
  dotEnvPath: string = fileURLToPath(new URL("../../.env", import.meta.url)),
): GuardEnv {
  if (!fs.existsSync(dotEnvPath)) return processEnv;
  const fromFile = parseDotEnv(fs.readFileSync(dotEnvPath));
  const merged: Record<string, string | undefined> = { ...processEnv };
  for (const key of DOTENV_KEYS) {
    if (nonEmpty(merged[key]) === undefined && fromFile[key] !== undefined) merged[key] = fromFile[key];
  }
  return merged;
}
