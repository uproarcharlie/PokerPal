import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { createIndexStatements, findGuardViolations, splitSqlStatements, type SqlStatement } from "./migration-guard";
import { assertSchemaCurrent, SchemaBehindError } from "./schema-check";
import { runBootSeeds } from "./seeds";

/**
 * Boot-time migration runner. `migrations/NNNN_name.sql` files are applied, in
 * name order, before the server listens:
 *
 * - All files pass the destructive-SQL guard (./migration-guard) before any of them runs.
 *   Then, against the database, no file about to run may build a UNIQUE index
 *   on a table that already exists (the guard can only read the SQL), nor
 *   create an index whose name an INVALID index already holds.
 * - One connection holds advisory lock 727274, so concurrent boots take turns.
 *   A boot gives up (naming the holder) if it cannot get the lock within `lockWaitMs`.
 * - `_app_migrations` records the sha256 of every applied file. A file whose
 *   sha256 matches is skipped, so an unchanged file runs once and later boots
 *   take no table locks. A new or edited file runs; the guard still requires
 *   every statement to be re-runnable, because an edited file runs again.
 * - Each file runs in its own transaction with `lock_timeout = 5s` and
 *   `statement_timeout = 60s` (the guard refuses SET, so a file cannot lift
 *   them), together with its ledger row, so a recorded sha256 means the whole
 *   file applied. A transaction that loses a lock conflict with the old
 *   instance still serving (a deadlock, 40P01, or the lock timeout, 55P03) is
 *   rolled back whole and tried again after a jittered backoff, up to
 *   `lockRetry.attempts` times, before the boot gives up (P4REV3-PROD-01): no
 *   order of locks is free of cycles against every app transaction, and a TD
 *   editing a tournament during a deploy must not fail it. A file whose first
 *   line is `-- runner:no-transaction` (e.g. for CREATE INDEX CONCURRENTLY)
 *   runs statement by statement instead, is never retried, and is recorded at
 *   the end. If one of those fails part-way it can leave an
 *   INVALID index behind, which `IF NOT EXISTS` would skip: later boots refuse
 *   to run the file until that index is dropped, rather than record it as
 *   applied. It can also leave a table without the UNIQUE index meant for it,
 *   which later boots refuse to add. Either way it needs a manual look.
 */

/** `NNNN_lower_snake_case.sql`, applied in name order. */
export const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
/** First-line directive for files that must run outside a transaction. */
export const NO_TRANSACTION_DIRECTIVE = "-- runner:no-transaction";
/** Advisory lock key held while migrating. */
export const MIGRATION_LOCK_KEY = 727274;
/** Default for `ApplyMigrationsOptions.lockWaitMs`. */
export const DEFAULT_LOCK_WAIT_MS = 120_000;
/** How long a boot keeps retrying while the database cannot be reached (a Postgres restart, a network blip). */
export const BOOT_DATABASE_WAIT_MS = 180_000;
/** Connect timeout for the boot's own connection, so a database that never answers counts as unreachable and is retried. */
export const BOOT_CONNECT_TIMEOUT_MS = 10_000;

export interface MigrationLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface MigrationFile {
  /** File name without `.sql`, e.g. `0000_baseline`; also the ledger key. */
  name: string;
  sha256: string;
  transactional: boolean;
  statements: SqlStatement[];
}

/**
 * How a file compares with the ledger: never applied, applied as-is (so it is
 * skipped), or edited since it was last applied (so it runs again).
 */
export type LedgerStatus = "new" | "unchanged" | "changed";

export interface MigrationFileResult {
  name: string;
  sha256: string;
  transactional: boolean;
  statements: number;
  status: LedgerStatus;
  /** 0 for a skipped ("unchanged") file. */
  durationMs: number;
}

export interface MigrationReport {
  dryRun: boolean;
  files: MigrationFileResult[];
  /** Tables that did not exist before the run. */
  createdTables: string[];
  /** `table.column` added to tables that already existed. */
  addedColumns: string[];
  /** Indexes added to tables that already existed. */
  createdIndexes: string[];
  durationMs: number;
}

/** How often a file's transaction is tried when it loses a lock conflict, and the backoff before each retry. */
export interface LockRetry {
  /** Attempts in all (1: no retry). */
  attempts: number;
  /** The first backoff; each later one doubles, and each is jittered to between half and one and a half times it. */
  baseDelayMs: number;
}

/** Default for `ApplyMigrationsOptions.lockRetry`: three attempts, about 1s and then 2s apart. */
export const DEFAULT_LOCK_RETRY: Readonly<LockRetry> = Object.freeze({ attempts: 3, baseDelayMs: 1_000 });

/** deadlock_detected and lock_not_available (lock_timeout): a lock conflict with the live app, worth another try. */
const LOCK_CONFLICT_CODES: ReadonlySet<string> = new Set(["40P01", "55P03"]);

/** The SQLSTATE of a lock conflict anywhere in `error`'s cause chain, or null for any other failure. */
export function lockConflictCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && LOCK_CONFLICT_CODES.has(code)) return code;
  }
  return null;
}

export interface ApplyMigrationsOptions {
  pool: Pool;
  dir: string;
  logger?: MigrationLogger;
  /** Check the guard and report what would run against the ledger, without executing anything. */
  dryRun?: boolean;
  /** Give up if another session holds the migration lock for longer than this. */
  lockWaitMs?: number;
  /** Retries of a transactional file that loses a lock conflict (default DEFAULT_LOCK_RETRY). */
  lockRetry?: LockRetry;
}

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
  }
}

const CREATE_LEDGER = `
  CREATE TABLE IF NOT EXISTS _app_migrations (
    name text PRIMARY KEY,
    sha256 text NOT NULL,
    first_applied_at timestamptz NOT NULL DEFAULT now(),
    last_applied_at timestamptz NOT NULL DEFAULT now()
  )`;

const UPSERT_LEDGER = `
  INSERT INTO _app_migrations (name, sha256) VALUES ($1, $2)
  ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256, last_applied_at = now()`;

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: unknown }).code;
  const message = error.message || error.name;
  return typeof code === "string" ? `${message} [${code}]` : message;
}

/** Read, parse and order the migration files in `dir`. Sub-directories and non-SQL files are ignored. */
export function loadMigrationFiles(dir: string): MigrationFile[] {
  if (!fs.existsSync(dir)) throw new MigrationError(`Migrations directory not found: ${dir}`);

  const fileNames = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  // A misnamed or duplicate-numbered file would otherwise be skipped or run in a surprising order.
  const misnamed = fileNames.filter((name) => !MIGRATION_FILE_PATTERN.test(name));
  if (misnamed.length > 0) {
    throw new MigrationError(`Migration files must be named NNNN_lower_snake_case.sql; rename: ${misnamed.join(", ")}`);
  }
  const byNumber = new Map<string, string>();
  for (const fileName of fileNames) {
    const number = fileName.slice(0, 4);
    const clash = byNumber.get(number);
    if (clash) throw new MigrationError(`Migrations ${clash} and ${fileName} share the number ${number}; renumber one`);
    byNumber.set(number, fileName);
  }

  return fileNames.map((fileName) => {
    const bytes = fs.readFileSync(path.join(dir, fileName));
    const source = bytes.toString("utf8").replace(/^\uFEFF/, "");
    try {
      return {
        name: fileName.slice(0, -".sql".length),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        transactional: source.split(/\r?\n/, 1)[0].trim() !== NO_TRANSACTION_DIRECTIVE,
        statements: splitSqlStatements(source),
      };
    } catch (error) {
      throw new MigrationError(`${fileName}: ${describeError(error)}`, { cause: error });
    }
  });
}

/** Throw one error listing every statement, in every file, that the destructive-SQL guard rejects. */
export function assertMigrationsSafe(files: readonly MigrationFile[]): void {
  const violations = files.flatMap((file) =>
    findGuardViolations(file.statements).map((violation) => ({ location: `${file.name}.sql:${violation.line}`, violation })),
  );
  const problems = violations.map(
    ({ location, violation }) => `  ${location}: ${violation.rule}\n      ${violation.excerpt}`,
  );
  if (problems.length > 0) {
    const statements = new Set(violations.map(({ location, violation }) => `${location} ${violation.excerpt}`)).size;
    throw new MigrationError(
      `Refusing to run migrations: the destructive-SQL guard rejected ${statements} statement(s):\n` +
        `${problems.join("\n")}\n` +
        "Anything the guard refuses needs sign-off and a hand-run plan; it never runs at boot.",
    );
  }
}

/**
 * Refuse, before any file runs, a UNIQUE index on a table that already exists.
 * The guard allows one only after the same file's CREATE TABLE IF NOT EXISTS,
 * but on an existing table that creates nothing, so the index would land on
 * live rows: the build fails on legacy duplicates, or it succeeds and starts
 * rejecting writes the deployed code makes. An index that already exists is
 * skipped by IF NOT EXISTS, so re-running a file whose first run built it is fine.
 */
async function assertUniqueIndexesOnNewTables(client: PoolClient, files: readonly MigrationFile[]): Promise<void> {
  const problems: string[] = [];
  for (const file of files) {
    for (const { line, index, table, unique } of createIndexStatements(file.statements)) {
      if (!unique) continue;
      const { rows } = await client.query<{ index_exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_class i WHERE i.relnamespace = t.relnamespace AND i.relname = $2) AS index_exists
           FROM pg_class t
          WHERE t.oid = to_regclass($1)`,
        [table, index],
      );
      if (rows[0] && !rows[0].index_exists) {
        problems.push(`  ${file.name}.sql:${line}: CREATE UNIQUE INDEX ${index} on ${table}, which already exists`);
      }
    }
  }
  if (problems.length > 0) {
    throw new MigrationError(
      "Refusing to run migrations: a UNIQUE index may only be built on a table the same migration creates, and these " +
        "tables already exist, so the index would land on live rows (failing on duplicates, or rejecting writes the " +
        `deployed code makes):\n${problems.join("\n")}\n` +
        "Anything like this needs sign-off and a hand-run plan; it never runs at boot.",
    );
  }
}

/**
 * Refuse, before any file runs, a CREATE INDEX … IF NOT EXISTS whose name an
 * INVALID index already holds: what a CREATE INDEX CONCURRENTLY that failed
 * part-way (a lock or statement timeout, a lost connection) leaves behind.
 * IF NOT EXISTS would skip it and the file would be recorded as applied, with
 * an index Postgres never uses. Only indexes the pending files name are
 * checked, so an unrelated invalid index never stops a boot.
 */
async function assertNoInvalidIndexesInTheWay(client: PoolClient, files: readonly MigrationFile[]): Promise<void> {
  const problems: string[] = [];
  for (const file of files) {
    for (const { line, index, table } of createIndexStatements(file.statements)) {
      const { rows } = await client.query<{ qualified: string }>(
        `SELECT format('%I.%I', n.nspname, i.relname) AS qualified
           FROM pg_class t
           JOIN pg_class i ON i.relnamespace = t.relnamespace AND i.relname = $2
           JOIN pg_index x ON x.indexrelid = i.oid
           JOIN pg_namespace n ON n.oid = i.relnamespace
          WHERE t.oid = to_regclass($1) AND NOT x.indisvalid`,
        [table, index],
      );
      if (rows[0]) problems.push(`  ${file.name}.sql:${line}: index ${rows[0].qualified} exists but is INVALID`);
    }
  }
  if (problems.length > 0) {
    throw new MigrationError(
      "Refusing to run migrations: an earlier build of these indexes failed part-way (usually CREATE INDEX " +
        "CONCURRENTLY hitting a timeout) and left them INVALID, so Postgres never uses them, and IF NOT EXISTS " +
        `would skip them:\n${problems.join("\n")}\n` +
        "Once nothing is still building them, drop each one with DROP INDEX CONCURRENTLY IF EXISTS <index> and " +
        "boot again; the migration then builds it afresh.",
    );
  }
}

/** The live-database checks every file about to run must pass, before any of them runs. */
async function assertPendingFilesCanRun(client: PoolClient, pending: readonly MigrationFile[]): Promise<void> {
  await assertUniqueIndexesOnNewTables(client, pending);
  await assertNoInvalidIndexesInTheWay(client, pending);
}

async function readLedger(client: PoolClient): Promise<Map<string, string>> {
  const { rows } = await client.query<{ present: boolean }>(
    "SELECT to_regclass('_app_migrations') IS NOT NULL AS present",
  );
  if (!rows[0]?.present) return new Map();
  const ledger = await client.query<{ name: string; sha256: string }>("SELECT name, sha256 FROM _app_migrations");
  return new Map(ledger.rows.map((row) => [row.name, row.sha256]));
}

function ledgerStatus(file: MigrationFile, ledger: ReadonlyMap<string, string>): LedgerStatus {
  const recorded = ledger.get(file.name);
  if (recorded === undefined) return "new";
  return recorded === file.sha256 ? "unchanged" : "changed";
}

interface SchemaObject {
  table: string;
  name: string;
}

interface SchemaSnapshot {
  tables: Set<string>;
  columns: SchemaObject[];
  indexes: SchemaObject[];
}

async function snapshotSchema(client: PoolClient): Promise<SchemaSnapshot> {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  const columns = await client.query<SchemaObject>(
    `SELECT c.table_name AS "table", c.column_name AS name
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'`,
  );
  const indexes = await client.query<SchemaObject>(
    `SELECT tablename AS "table", indexname AS name FROM pg_indexes WHERE schemaname = current_schema()`,
  );
  return {
    tables: new Set(tables.rows.map((row) => row.table_name)),
    columns: columns.rows,
    indexes: indexes.rows,
  };
}

function diffSchema(before: SchemaSnapshot, after: SchemaSnapshot) {
  const key = (object: SchemaObject) => `${object.table}\u0000${object.name}`;
  // Objects on brand-new tables are implied by "created table X", so only changes to existing tables are listed.
  const addedToExistingTables = (previous: SchemaObject[], current: SchemaObject[]) => {
    const seen = new Set(previous.map(key));
    return current.filter((object) => before.tables.has(object.table) && !seen.has(key(object)));
  };
  return {
    createdTables: Array.from(after.tables).filter((table) => !before.tables.has(table)).sort(),
    addedColumns: addedToExistingTables(before.columns, after.columns)
      .map((column) => `${column.table}.${column.name}`)
      .sort(),
    createdIndexes: addedToExistingTables(before.indexes, after.indexes)
      .map((index) => index.name)
      .sort(),
  };
}

function summarize(report: MigrationReport): string {
  const changes = [
    report.createdTables.length > 0 && `created tables ${report.createdTables.join(", ")}`,
    report.addedColumns.length > 0 && `added columns ${report.addedColumns.join(", ")}`,
    report.createdIndexes.length > 0 && `created indexes ${report.createdIndexes.join(", ")}`,
  ].filter(Boolean);
  return `Migrations complete in ${report.durationMs}ms: ${changes.length > 0 ? changes.join("; ") : "schema unchanged"}`;
}

const LOCK_POLL_MS = 1_000;
const LOCK_REPORT_EVERY_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Who holds the migration lock in this database, for logs (no query text, which could carry data). */
async function describeLockHolder(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{
    pid: number;
    application_name: string | null;
    client_addr: string | null;
    state: string | null;
    connected_seconds: number | null;
  }>(
    // A bigint advisory key is stored as classid (high 32 bits), objid (low 32 bits), objsubid 1.
    `SELECT l.pid, a.application_name, host(a.client_addr) AS client_addr, a.state,
            extract(epoch FROM now() - a.backend_start)::int AS connected_seconds
       FROM pg_locks l
       LEFT JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.granted AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND l.classid = 0 AND l.objid = $1 AND l.objsubid = 1`,
    [MIGRATION_LOCK_KEY],
  );
  const holder = rows[0];
  if (!holder) return "a session that has just released it";
  const details = [
    holder.application_name && `application "${holder.application_name}"`,
    holder.client_addr && `from ${holder.client_addr}`,
    holder.state,
    holder.connected_seconds != null && `connected ${holder.connected_seconds}s ago`,
  ].filter(Boolean);
  return `pid ${holder.pid}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

/** Take the migration lock, polling rather than blocking so a lock that is never released cannot hang the boot. */
async function acquireLock(client: PoolClient, logger: MigrationLogger, lockWaitMs: number): Promise<void> {
  const startedAt = Date.now();
  let reportedAt: number | undefined;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [
      MIGRATION_LOCK_KEY,
    ]);
    if (rows[0]?.locked) return;

    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= lockWaitMs) {
      throw new MigrationError(
        `Gave up after ${Math.round(waitedMs / 1000)}s waiting for migration lock ${MIGRATION_LOCK_KEY}, ` +
          `held by ${await describeLockHolder(client)}. If that session is stuck, end it with pg_terminate_backend(<pid>).`,
      );
    }
    if (reportedAt === undefined || Date.now() - reportedAt >= LOCK_REPORT_EVERY_MS) {
      logger.info(
        `Waiting for migration lock ${MIGRATION_LOCK_KEY}, held by ${await describeLockHolder(client)} ` +
          `(another instance applying migrations?); giving up after ${Math.round(lockWaitMs / 1000)}s`,
      );
      reportedAt = Date.now();
    }
    await sleep(Math.min(LOCK_POLL_MS, lockWaitMs - waitedMs));
  }
}

async function runStatements(client: PoolClient, file: MigrationFile): Promise<void> {
  for (const statement of file.statements) {
    try {
      await client.query(statement.sql);
    } catch (error) {
      throw new MigrationError(`${file.name}.sql:${statement.line} failed: ${describeError(error)}`, { cause: error });
    }
  }
}

async function applyFile(client: PoolClient, file: MigrationFile): Promise<void> {
  if (!file.transactional) {
    // Session-level is fine: the runner's connection is discarded when it finishes.
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '60s'");
    await runStatements(client, file);
    await client.query(UPSERT_LEDGER, [file.name, file.sha256]);
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await runStatements(client, file);
    await client.query(UPSERT_LEDGER, [file.name, file.sha256]);
    await client.query("COMMIT");
  } catch (error) {
    // If the connection itself broke there is nothing left to roll back; the original error matters.
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/**
 * applyFile, tried again after a jittered backoff while a transactional file loses a lock conflict
 * (lockConflictCode). Its transaction rolled back whole each time, so every try starts clean. A
 * `-- runner:no-transaction` file is never retried here: one that failed part-way may have left an
 * INVALID index, which only the checks before the run catch.
 */
async function applyFileRetrying(client: PoolClient, file: MigrationFile, logger: MigrationLogger, retry: LockRetry): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await applyFile(client, file);
      return;
    } catch (error) {
      const code = lockConflictCode(error);
      if (!file.transactional || code === null || attempt >= retry.attempts) throw error;
      const delayMs = Math.round(retry.baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random()));
      logger.warn(
        `${file.name}.sql lost a lock conflict with the running app [${code}] on attempt ${attempt} of ${retry.attempts}; ` +
          `rolled back, trying again in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function runMigrations(
  client: PoolClient,
  files: readonly MigrationFile[],
  logger: MigrationLogger,
  startedAt: number,
  lockRetry: LockRetry,
): Promise<MigrationReport> {
  const before = await snapshotSchema(client);
  await client.query(CREATE_LEDGER);
  const ledger = await readLedger(client);

  const pending = files.filter((file) => ledgerStatus(file, ledger) !== "unchanged");
  await assertPendingFilesCanRun(client, pending);
  logger.info(`${files.length - pending.length} of ${files.length} migration file(s) already applied; applying ${pending.length}`);
  const results: MigrationFileResult[] = [];
  for (const file of files) {
    const status = ledgerStatus(file, ledger);
    const result = {
      name: file.name,
      sha256: file.sha256,
      transactional: file.transactional,
      statements: file.statements.length,
      status,
    };
    if (status === "unchanged") {
      results.push({ ...result, durationMs: 0 });
      continue;
    }
    if (status === "changed") {
      logger.warn(
        `${file.name}.sql changed since it was last applied (sha256 ${ledger.get(file.name)?.slice(0, 12)} -> ` +
          `${file.sha256.slice(0, 12)}); edits to applied migrations must stay idempotent`,
      );
    }
    const fileStartedAt = performance.now();
    await applyFileRetrying(client, file, logger, lockRetry);
    const durationMs = Math.round(performance.now() - fileStartedAt);
    results.push({ ...result, durationMs });
    logger.info(`${file.name}: ok in ${durationMs}ms${status === "new" ? " (first run)" : ""}`);
  }

  const after = await snapshotSchema(client);
  const report: MigrationReport = {
    dryRun: false,
    files: results,
    ...diffSchema(before, after),
    durationMs: Math.round(performance.now() - startedAt),
  };
  logger.info(summarize(report));
  return report;
}

async function planMigrations(
  client: PoolClient,
  files: readonly MigrationFile[],
  logger: MigrationLogger,
  startedAt: number,
): Promise<MigrationReport> {
  const ledger = await readLedger(client);
  await assertPendingFilesCanRun(
    client,
    files.filter((file) => ledgerStatus(file, ledger) !== "unchanged"),
  );
  const plan: Record<LedgerStatus, string> = {
    new: "would run for the first time",
    unchanged: "already applied and unchanged; would be skipped",
    changed: "changed since it was last applied; would run again",
  };
  const results = files.map((file): MigrationFileResult => {
    const status = ledgerStatus(file, ledger);
    logger.info(`${file.name}: ${plan[status]}`);
    return {
      name: file.name,
      sha256: file.sha256,
      transactional: file.transactional,
      statements: file.statements.length,
      status,
      durationMs: 0,
    };
  });
  logger.info(`Dry run: ${files.length} file(s) passed the safety guard; nothing was executed`);
  return {
    dryRun: true,
    files: results,
    createdTables: [],
    addedColumns: [],
    createdIndexes: [],
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/** Guard, then apply (or with `dryRun`, only plan) every migration file in `dir`. Rejects on the first failure. */
export async function applyMigrations({
  pool,
  dir,
  logger = console,
  dryRun = false,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
  lockRetry = DEFAULT_LOCK_RETRY,
}: ApplyMigrationsOptions): Promise<MigrationReport> {
  const startedAt = performance.now();
  const files = loadMigrationFiles(dir);
  assertMigrationsSafe(files);

  const client = await pool.connect();
  // pg-pool stops listening for a client's errors while it is checked out, and this one is held for
  // the whole run, lock wait included. Without a listener of its own, a connection lost meanwhile (a
  // Postgres restart, a network blip) is an unhandled 'error' that kills the process; with one, the
  // next query rejects instead, which retryWhileUnreachable treats as the database being unreachable.
  const onConnectionLost = (error: Error) => logger.warn(`Lost the migration connection: ${describeError(error)}`);
  client.on("error", onConnectionLost);
  try {
    if (dryRun) return await planMigrations(client, files, logger, startedAt);

    await acquireLock(client, logger, lockWaitMs);
    try {
      return await runMigrations(client, files, logger, startedAt, lockRetry);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
        .catch((error) => logger.warn(`Could not release the migration lock explicitly: ${describeError(error)}`));
    }
  } finally {
    // Discarded rather than returned to the pool, so no session setting or lock from the run reaches app
    // queries. The pool listens for the client's errors again as soon as it takes it back.
    client.off("error", onConnectionLost);
    client.release(true);
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** `host:port/database` for logs (never credentials), and whether it is this machine. */
export function describeDatabaseTarget(connectionString: string): { label: string; isLocal: boolean } {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { label: "(unparseable connection string)", isLocal: false };
  }
  // libpq lets ?host= override the URL authority (e.g. with a socket directory), so it decides the target.
  const host = url.searchParams.get("host") ?? url.hostname.replace(/^\[(.*)\]$/, "$1");
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)";
  return {
    label: `${host || "(default host)"}:${url.port || "5432"}/${database}`,
    isLocal: LOCAL_HOSTS.has(host) || host.startsWith("/"),
  };
}

/**
 * Where the migrations ship: beside the production bundle (dist/index.js →
 * dist/migrations), or at the repo root when running from source (server/db → migrations).
 */
export function resolveMigrationsDir(moduleDir: string = import.meta.dirname): string {
  const candidates = [path.join(moduleDir, "migrations"), path.resolve(moduleDir, "..", "..", "migrations")];
  const found = candidates.find((dir) => fs.existsSync(dir));
  if (!found) throw new MigrationError(`No migrations directory found (looked in ${candidates.join(", ")})`);
  return found;
}

export type BootMigrationStatus = { files: number; lastFile: string | null } | { skipped: true };

let bootStatus: BootMigrationStatus | undefined;

/** What `runBootMigrations` did in this process, for /api/health; undefined if it never ran. */
export function getBootMigrationStatus(): BootMigrationStatus | undefined {
  return bootStatus;
}

const bootLogger: MigrationLogger = {
  info: (message) => console.log(`[migrate] ${message}`),
  warn: (message) => console.warn(`[migrate] ${message}`),
  error: (message) => console.error(`[migrate] ${message}`),
};

/** Node network errors that mean the database server could not be reached (or went away). */
const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);
/** SQLSTATEs for a server that is restarting, shutting down or full: 08xxx, admin/crash shutdown, starting up, too many connections. */
const TRANSIENT_SQLSTATE = /^(?:08[0-9A-Z]{3}|57P0[123]|53300)$/;
/** node-postgres's own messages for a connection that timed out or dropped. */
const PG_CONNECTION_MESSAGE =
  /^(?:timeout exceeded when trying to connect|Connection terminated(?: unexpectedly| due to connection timeout)?|Client has encountered a connection error and is not queryable)$/;

/**
 * Whether `error` (or what it wraps: `cause`, AggregateError members) means
 * the database could not be reached, as opposed to a guard refusal or a SQL error.
 */
export function isConnectionError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 5) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && (CONNECTION_ERROR_CODES.has(code) || TRANSIENT_SQLSTATE.test(code))) return true;
  if (PG_CONNECTION_MESSAGE.test(error.message)) return true;
  if (error instanceof AggregateError && error.errors.some((member) => isConnectionError(member, depth + 1))) return true;
  return isConnectionError(error.cause, depth + 1);
}

const RETRY_FIRST_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;

/**
 * Run `work`, retrying with backoff while it fails only because the database
 * cannot be reached, for up to `waitMs`. Any other error, or the last
 * connection error once `waitMs` has passed, rejects.
 */
export async function retryWhileUnreachable<T>(
  work: () => Promise<T>,
  { waitMs, logger }: { waitMs: number; logger: MigrationLogger },
): Promise<T> {
  const startedAt = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const waitedMs = Date.now() - startedAt;
      if (!isConnectionError(error) || waitedMs >= waitMs) throw error;
      const delayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_FIRST_DELAY_MS * 2 ** (attempt - 1), waitMs - waitedMs);
      logger.warn(
        `Database unreachable (${describeError(error)}); retrying in ${Math.round(delayMs / 1000)}s ` +
          `(waited ${Math.round(waitedMs / 1000)}s of ${Math.round(waitMs / 1000)}s)`,
      );
      await sleep(delayMs);
    }
  }
}

/**
 * Apply the shipped migrations before the server listens (unless
 * `MIGRATE_ON_BOOT=false`). While the database cannot be reached it retries
 * for up to BOOT_DATABASE_WAIT_MS; any other failure (a guard refusal, a SQL
 * error, the lock never freeing) rejects at once, so the process exits non-zero
 * before it listens. Either way the database must then have every table and
 * column this build declares (./schema-check), or the boot is refused the same
 * way: with MIGRATE_ON_BOOT=false left set, a deploy whose code needs a new
 * migration never takes traffic behind a green healthcheck (P2REV3-PRODSAFE-01).
 * Then it runs the boot data seeds (./seeds), also when the migrations are
 * skipped: they change only data, skip any seed whose tables do not exist yet,
 * log their own failures and never stop the boot (P2REV3-PROD-03).
 */
export async function runBootMigrations(env: AppEnv): Promise<void> {
  // Its own pool, not the app's: the boot needs a connect timeout, which the app pool deliberately does not have.
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: BOOT_CONNECT_TIMEOUT_MS });
  pool.on("error", (error) => bootLogger.warn(`Idle migration connection lost: ${describeError(error)}`));

  if (!env.MIGRATE_ON_BOOT) {
    bootLogger.warn("MIGRATE_ON_BOOT=false: not applying migrations; checking the database already has the schema this build needs");
    try {
      await retryWhileUnreachable(() => assertSchemaCurrent(pool), { waitMs: BOOT_DATABASE_WAIT_MS, logger: bootLogger });
      bootStatus = { skipped: true };
      await runBootSeeds(pool);
    } catch (error) {
      if (error instanceof SchemaBehindError) {
        bootLogger.error(
          `SCHEMA BEHIND THIS BUILD: refusing to start with MIGRATE_ON_BOOT=false. ${error.message}. ` +
            "During a deploy the previous deployment keeps serving. Remove MIGRATE_ON_BOOT=false so the migrations " +
            'run, or fix the failing one (see DEPLOYMENT.md, "When a boot migration fails").',
        );
      }
      throw error;
    } finally {
      await pool.end().catch((error: unknown) => bootLogger.warn(`Could not close the migration pool: ${describeError(error)}`));
    }
    return;
  }

  try {
    const dir = resolveMigrationsDir();
    bootLogger.info(`Target database ${describeDatabaseTarget(env.DATABASE_URL).label}`);
    const report = await retryWhileUnreachable(() => applyMigrations({ pool, dir, logger: bootLogger }), {
      waitMs: BOOT_DATABASE_WAIT_MS,
      logger: bootLogger,
    });
    // The migrations must have built what this build queries; a gap is a release mistake, caught here, not by 500s.
    await assertSchemaCurrent(pool);
    bootStatus = { files: report.files.length, lastFile: report.files.at(-1)?.name ?? null };
    await runBootSeeds(pool);
  } catch (error) {
    bootLogger.error(
      "MIGRATIONS FAILED: refusing to start. During a deploy the previous deployment keeps serving; " +
        "after a crash or restart nothing serves traffic until a boot succeeds. MIGRATE_ON_BOOT=false starts " +
        "the server without migrating, but only if the database already has the schema this build needs " +
        "(see DEPLOYMENT.md, \"When a boot migration fails\").",
    );
    throw error;
  } finally {
    await pool.end().catch((error: unknown) => bootLogger.warn(`Could not close the migration pool: ${describeError(error)}`));
  }
}
