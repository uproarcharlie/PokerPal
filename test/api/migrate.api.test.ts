/**
 * The boot migration runner (server/db/migrate.ts) against real, empty
 * Postgres databases: what it skips, what it rolls back, the advisory lock,
 * and how it treats a database it cannot reach. Production runs this on every
 * boot, before the server listens.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../server/config/env";
import {
  applyMigrations,
  getBootMigrationStatus,
  isConnectionError,
  loadMigrationFiles,
  MIGRATION_LOCK_KEY,
  MigrationError,
  retryWhileUnreachable,
  runBootMigrations,
  type MigrationLogger,
} from "../../server/db/migrate";
import { findGuardViolations, splitSqlStatements } from "../../server/db/migration-guard";
import { assertSchemaCurrent, missingSchema, SchemaBehindError } from "../../server/db/schema-check";
import { createScratchDatabase, dropScratchDatabase, pushAppSchema, type ScratchDatabase } from "../helpers/scratch-db";
import { MIGRATIONS_DIR } from "../setup/databases";
import { withDatabase } from "../setup/db-guard";

function recordingLogger(): MigrationLogger & { lines: Record<"info" | "warn" | "error", string[]> } {
  const lines = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  return {
    lines,
    info: (message) => lines.info.push(message),
    warn: (message) => lines.warn.push(message),
    error: (message) => lines.error.push(message),
  };
}

/** The shipped migrations, by file name, to extend in a temporary directory. */
function shippedFiles(): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => [name, fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")]),
  );
}

const tempDirs: string[] = [];
function migrationsDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokerpal-migrate-api-"));
  tempDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), contents);
  return dir;
}

let scratch: ScratchDatabase | undefined;
const db = () => {
  if (!scratch) throw new Error("no scratch database");
  return scratch;
};
const migrate = (dir: string, logger: MigrationLogger = recordingLogger(), lockWaitMs?: number) =>
  applyMigrations({ pool: db().pool, dir, logger, lockWaitMs });

/** Wait (up to 10s) until a line matching `pattern` has been logged. */
async function waitForLine(lines: readonly string[], pattern: RegExp): Promise<void> {
  await vi.waitFor(() => expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(pattern)])), {
    timeout: 10_000,
    interval: 20,
  });
}

/** A second session on the scratch database, e.g. to hold a lock while the runner works. */
async function otherSession(applicationName = "pokerpal-test-holder"): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: db().url, application_name: applicationName });
  await client.connect();
  return client;
}

async function tables(): Promise<string[]> {
  const { rows } = await db().pool.query<{ name: string }>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
  );
  return rows.map((row) => row.name);
}

async function ledger(): Promise<string[]> {
  const { rows } = await db().pool.query<{ name: string }>("SELECT name FROM _app_migrations ORDER BY name");
  return rows.map((row) => row.name);
}

/** Granted or waiting holds of the migration advisory lock in the scratch database. */
async function migrationLocks(): Promise<number> {
  const { rows } = await db().pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND objid = $1 AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    [MIGRATION_LOCK_KEY],
  );
  return rows[0].n;
}

/** Row count and content hash of each table, to prove a run left existing data alone. */
async function fingerprint(names: readonly string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const { rows } = await db().pool.query<{ summary: string }>(
      `SELECT count(*) || ':' || md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS summary FROM "${name}" t`,
    );
    result[name] = rows[0].summary;
  }
  return result;
}

async function seedLegacyRows(): Promise<void> {
  await db().pool.query(`
    INSERT INTO users (email, password_hash, name) VALUES ('owner@example.com', 'hash', 'Owner');
    INSERT INTO clubs (name, slug, owner_id) SELECT 'Central Stars', 'central-stars', id FROM users;
    INSERT INTO players (name, email) VALUES ('Alice', 'alice@example.com'), ('Bob', NULL);
    INSERT INTO session (sid, sess, expire) VALUES ('s1', '{"cookie":{}}', now() + interval '1 day');`);
}

const APP_TABLES = ["users", "clubs", "players", "session"];

beforeEach(async () => {
  scratch = await createScratchDatabase("migrate");
});

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  await dropScratchDatabase(scratch);
  scratch = undefined;
});

describe("applyMigrations: the shipped migrations", () => {
  it("builds the schema once, then skips every applied file, so a boot takes no table locks", async () => {
    const first = await migrate(MIGRATIONS_DIR);
    expect(first.files.map((file) => file.status)).toEqual(first.files.map(() => "new"));
    expect(first.createdTables).toEqual(expect.arrayContaining(["_app_migrations", "clubs", "session", "tournaments", "users"]));
    await seedLegacyRows();
    const before = await fingerprint(APP_TABLES);

    // A live write transaction on tables the baseline indexes: re-running CREATE INDEX would wait 5s, then fail the boot.
    const writer = await otherSession();
    await writer.query("BEGIN");
    await writer.query("INSERT INTO players (name) VALUES ('Mid-hand')");
    await writer.query("UPDATE session SET expire = expire WHERE sid = 's1'");
    const startedAt = Date.now();
    const logger = recordingLogger();
    try {
      const second = await migrate(MIGRATIONS_DIR, logger);

      expect(Date.now() - startedAt).toBeLessThan(3_000);
      expect(second.files.map((file) => [file.status, file.durationMs])).toEqual(first.files.map(() => ["unchanged", 0]));
      expect(second).toMatchObject({ createdTables: [], addedColumns: [], createdIndexes: [] });
      expect(logger.lines.info).toContain(`${first.files.length} of ${first.files.length} migration file(s) already applied; applying 0`);
    } finally {
      await writer.query("ROLLBACK");
      await writer.end();
    }
    expect(await fingerprint(APP_TABLES)).toEqual(before);
  });

  it("can run every shipped file again without failing or touching data, as an edited file would", async () => {
    await migrate(MIGRATIONS_DIR);
    await seedLegacyRows();
    const before = await fingerprint(APP_TABLES);
    // Forget what ran, so every file runs a second time on the same database.
    await db().pool.query("TRUNCATE _app_migrations");

    const again = await migrate(MIGRATIONS_DIR);

    expect(again.files.map((file) => file.status)).toEqual(again.files.map(() => "new"));
    expect(again).toMatchObject({ createdTables: [], addedColumns: [], createdIndexes: [] });
    expect(await fingerprint(APP_TABLES)).toEqual(before);
  });

  it("adds only its ledger to a database built the legacy way (drizzle-kit push plus connect-pg-simple)", async () => {
    await pushAppSchema(db().pool, { apply: true });
    const sessionTable = fileURLToPath(new URL("../../node_modules/connect-pg-simple/table.sql", import.meta.url));
    await db().pool.query(fs.readFileSync(sessionTable, "utf8"));
    await seedLegacyRows();
    const before = await fingerprint(APP_TABLES);

    const report = await migrate(MIGRATIONS_DIR);

    expect(report).toMatchObject({ createdTables: ["_app_migrations"], addedColumns: [], createdIndexes: [] });
    expect(await fingerprint(APP_TABLES)).toEqual(before);
  });
});

describe("applyMigrations: the runner", () => {
  it("applies only new files, and runs an edited file again with a warning", async () => {
    const dir = migrationsDir({ "0000_a.sql": "CREATE TABLE IF NOT EXISTS t_a (id int);" });
    await migrate(dir);

    fs.writeFileSync(path.join(dir, "0001_b.sql"), "CREATE TABLE IF NOT EXISTS t_b (id int);");
    const added = await migrate(dir);
    expect(added.files.map((file) => [file.name, file.status])).toEqual([
      ["0000_a", "unchanged"],
      ["0001_b", "new"],
    ]);

    fs.appendFileSync(path.join(dir, "0000_a.sql"), "\nCREATE INDEX IF NOT EXISTS idx_t_a_id ON t_a (id);");
    const logger = recordingLogger();
    const edited = await migrate(dir, logger);

    expect(edited.files.map((file) => file.status)).toEqual(["changed", "unchanged"]);
    expect(edited.createdIndexes).toEqual(["idx_t_a_id"]);
    expect(logger.lines.warn).toEqual([expect.stringMatching(/^0000_a\.sql changed since it was last applied \(sha256 \w{12} -> \w{12}\)/)]);
  });

  it("rolls a failing file back whole, leaves it out of the ledger, names the file and line, and releases the lock", async () => {
    const dir = migrationsDir({
      "0000_ok.sql": "CREATE TABLE IF NOT EXISTS t_ok (id int);",
      "0001_bad.sql": "CREATE TABLE IF NOT EXISTS t_partial (id int);\nINSERT INTO t_missing (id) VALUES (1) ON CONFLICT (id) DO NOTHING;",
    });

    const failure = await migrate(dir).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MigrationError);
    expect((failure as Error).message).toBe('0001_bad.sql:2 failed: relation "t_missing" does not exist [42P01]');
    expect(await tables()).toEqual(["_app_migrations", "t_ok"]);
    expect(await ledger()).toEqual(["0000_ok"]);
    expect(await migrationLocks()).toBe(0);

    fs.writeFileSync(path.join(dir, "0001_bad.sql"), "CREATE TABLE IF NOT EXISTS t_partial (id int);");
    const fixed = await migrate(dir);
    expect(fixed.files.map((file) => file.status)).toEqual(["unchanged", "new"]);
    expect(fixed.createdTables).toEqual(["t_partial"]);
  });

  it("runs a `-- runner:no-transaction` file outside a transaction, and every other file inside one", async () => {
    const table = "CREATE TABLE IF NOT EXISTS t (c int);";
    const concurrently = "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_t_c ON t (c);";

    await expect(migrate(migrationsDir({ "0000_t.sql": table, "0001_i.sql": concurrently }))).rejects.toThrow(
      /^0001_i\.sql:1 failed: CREATE INDEX CONCURRENTLY cannot run inside a transaction block \[25001\]$/,
    );
    const report = await migrate(migrationsDir({ "0000_t.sql": table, "0001_i.sql": `-- runner:no-transaction\n${concurrently}` }));

    expect(report.files.map((file) => [file.name, file.transactional])).toEqual([
      ["0000_t", true],
      ["0001_i", false],
    ]);
    expect(report.createdIndexes).toEqual(["idx_t_c"]);
    expect(await ledger()).toEqual(["0000_t", "0001_i"]);
  });

  it("only reports the plan on a dry run, creating nothing", async () => {
    const logger = recordingLogger();

    const report = await applyMigrations({ pool: db().pool, dir: MIGRATIONS_DIR, logger, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.files.every((file) => file.status === "new")).toBe(true);
    expect(logger.lines.info).toContain("0000_baseline: would run for the first time");
    expect(await tables()).toEqual([]);
  });

  it("refuses a file the guard rejects before running any file", async () => {
    const dir = migrationsDir({
      "0000_ok.sql": "CREATE TABLE IF NOT EXISTS t_ok (id int);",
      "0001_enum.sql": "CREATE TYPE ante_mode AS ENUM ('none', 'bb_ante', 'everyone');",
    });

    await expect(migrate(dir)).rejects.toThrow(/0001_enum\.sql:1: CREATE TYPE and CREATE DOMAIN have no IF NOT EXISTS/);
    expect(await tables()).toEqual([]);
  });

  it("runs a CREATE TYPE wrapped for re-runs, again and again", async () => {
    const dir = migrationsDir({
      "0000_enum.sql":
        "DO $$ BEGIN CREATE TYPE ante_mode AS ENUM ('none', 'bb_ante', 'everyone'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    });

    await migrate(dir);
    await db().pool.query("TRUNCATE _app_migrations");
    await migrate(dir);

    const { rows } = await db().pool.query<{ labels: string[] }>("SELECT enum_range(NULL::ante_mode)::text[] AS labels");
    expect(rows[0].labels).toEqual(["none", "bb_ante", "everyone"]);
  });
});

describe("applyMigrations: unique indexes on tables that already exist", () => {
  const indexes = async (table: string) => {
    const { rows } = await db().pool.query<{ name: string }>("SELECT indexname AS name FROM pg_indexes WHERE tablename = $1", [table]);
    return rows.map((row) => row.name).sort();
  };

  it("refuses one after the same file's CREATE TABLE IF NOT EXISTS, which creates nothing on a live table", async () => {
    await migrate(MIGRATIONS_DIR);
    await db().pool.query("INSERT INTO players (name) VALUES ('Alice'), ('Bob')");
    const before = await indexes("players");
    const dir = migrationsDir({
      ...shippedFiles(),
      "9000_redeclare.sql":
        "CREATE TABLE IF NOT EXISTS players (id varchar PRIMARY KEY);\n" +
        "CREATE UNIQUE INDEX IF NOT EXISTS players_name_uq ON players (name);",
    });

    await expect(migrate(dir)).rejects.toThrow(/\n {2}9000_redeclare\.sql:2: CREATE UNIQUE INDEX players_name_uq on "players", which already exists\n/);
    await expect(applyMigrations({ pool: db().pool, dir, logger: recordingLogger(), dryRun: true })).rejects.toThrow(/players_name_uq/);

    expect(await indexes("players")).toEqual(before);
    expect(await ledger()).not.toContain("9000_redeclare");
    // Writes today's code makes still succeed.
    await db().pool.query("INSERT INTO players (name) VALUES ('Alice')");
  });

  it("refuses one added to an applied file that re-declares a live table, before the edited file runs again", async () => {
    await migrate(MIGRATIONS_DIR);
    const shipped = shippedFiles();
    const dir = migrationsDir({
      ...shipped,
      "0000_baseline.sql": `${shipped["0000_baseline.sql"]}\nCREATE UNIQUE INDEX IF NOT EXISTS tr_one_entry ON tournament_registrations (tournament_id, player_id);\n`,
    });

    await expect(migrate(dir)).rejects.toThrow(/0000_baseline\.sql:\d+: CREATE UNIQUE INDEX tr_one_entry on "tournament_registrations", which already exists/);
    expect(await indexes("tournament_registrations")).not.toContain("tr_one_entry");
  });

  it("lets a file whose first run created the table and its index run again after an edit", async () => {
    const dir = migrationsDir({
      "0000_seats.sql":
        "CREATE TABLE IF NOT EXISTS seats (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), n int);\n" +
        "CREATE UNIQUE INDEX IF NOT EXISTS seats_n_uq ON seats (n);",
    });
    expect((await migrate(dir)).createdTables).toContain("seats");
    await db().pool.query("INSERT INTO seats (n) VALUES (1), (2)");

    fs.appendFileSync(path.join(dir, "0000_seats.sql"), "\n-- edited\n");
    const again = await migrate(dir);

    expect(again.files.map((file) => file.status)).toEqual(["changed"]);
    expect(await indexes("seats")).toEqual(["seats_n_uq", "seats_pkey"]);
  });
});

describe("applyMigrations: an index left INVALID by a build that failed part-way", () => {
  const table = "CREATE TABLE IF NOT EXISTS t (c int);";

  /** What a CREATE INDEX CONCURRENTLY that fails part-way leaves behind; here it fails on duplicate rows. */
  async function leaveInvalidIndex(): Promise<void> {
    await db().pool.query("INSERT INTO t (c) VALUES (1), (1)");
    await expect(db().pool.query("CREATE UNIQUE INDEX CONCURRENTLY idx_t_c ON t (c)")).rejects.toThrow(/could not create unique index/);
  }

  const validity = async () => {
    const { rows } = await db().pool.query<{ valid: boolean }>("SELECT indisvalid AS valid FROM pg_index WHERE indexrelid = 'idx_t_c'::regclass");
    return rows.map((row) => row.valid);
  };

  it.each([
    ["a `-- runner:no-transaction` file", "-- runner:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_t_c ON t (c);"],
    ["a transactional file", "CREATE INDEX IF NOT EXISTS idx_t_c ON t (c);"],
  ])("refuses %s whose IF NOT EXISTS would skip it, until it is dropped and built afresh", async (_label, sql) => {
    await migrate(migrationsDir({ "0000_t.sql": table }));
    await leaveInvalidIndex();
    expect(await validity()).toEqual([false]);
    const dir = migrationsDir({ "0000_t.sql": table, "0001_i.sql": sql });

    await expect(migrate(dir)).rejects.toThrow(
      /\n {2}0001_i\.sql:\d: index public\.idx_t_c exists but is INVALID\n[\s\S]*DROP INDEX CONCURRENTLY IF EXISTS <index>/,
    );
    await expect(applyMigrations({ pool: db().pool, dir, logger: recordingLogger(), dryRun: true })).rejects.toThrow(/idx_t_c exists but is INVALID/);
    expect(await ledger()).toEqual(["0000_t"]);

    await db().pool.query("DROP INDEX CONCURRENTLY idx_t_c");
    const report = await migrate(dir);

    expect(report.createdIndexes).toEqual(["idx_t_c"]);
    expect(await validity()).toEqual([true]);
    expect(await ledger()).toEqual(["0000_t", "0001_i"]);
  });

  it("ignores an invalid index no pending file names", async () => {
    await migrate(migrationsDir({ "0000_t.sql": table }));
    await leaveInvalidIndex();

    await expect(migrate(migrationsDir({ "0000_t.sql": table, "0001_z.sql": "ALTER TABLE t ADD COLUMN IF NOT EXISTS z int;" }))).resolves.toMatchObject({
      addedColumns: ["t.z"],
    });
  });
});

describe("the guard's ADD COLUMN rules, against what Postgres does", () => {
  const storage = async () => {
    const { rows } = await db().pool.query<{ node: string }>("SELECT pg_relation_filenode('t')::text AS node");
    return rows[0].node;
  };

  it.each([
    ["no default", "text"],
    ["a constant default", "text DEFAULT 'x'"],
    ["NOT NULL with a constant default", "integer NOT NULL DEFAULT 0"],
    ["now()", "timestamptz DEFAULT now()"],
    ["CURRENT_TIMESTAMP", "timestamp DEFAULT CURRENT_TIMESTAMP"],
    ["gen_random_uuid()", "uuid DEFAULT gen_random_uuid()"],
    ["clock_timestamp()", "timestamptz DEFAULT clock_timestamp()"],
    ["serial", "serial"],
    ["an identity column", "integer GENERATED ALWAYS AS IDENTITY"],
    ["a stored generated column", "integer GENERATED ALWAYS AS (id * 2) STORED"],
  ])("refuses a column exactly when adding it rewrites the table: %s", async (_label, column) => {
    await db().pool.query("CREATE TABLE t (id int); INSERT INTO t SELECT generate_series(1, 100)");
    const sql = `ALTER TABLE t ADD COLUMN IF NOT EXISTS c ${column}`;
    const before = await storage();

    // Run directly, past the guard, to see whether Postgres rewrote the table (it then gets new storage).
    await db().pool.query(sql);

    const rewritten = (await storage()) !== before;
    expect({ refused: findGuardViolations(splitSqlStatements(sql)).length > 0 }).toEqual({ refused: rewritten });
  });
});

describe("applyMigrations: the runner's timeouts", () => {
  it("refuses a file that switches them off, before running anything", async () => {
    const dir = migrationsDir({
      "0000_ok.sql": "CREATE TABLE IF NOT EXISTS t_ok (id int);",
      "0001_unbounded.sql": "SET lock_timeout = 0;\nSET statement_timeout = 0;\nALTER TABLE t_ok ADD COLUMN IF NOT EXISTS z int;",
    });

    await expect(migrate(dir)).rejects.toThrow(/0001_unbounded\.sql:1: SET and RESET belong to the runner[\s\S]*0001_unbounded\.sql:2:/);
    expect(await tables()).toEqual([]);
  });

  it("gives up on a table lock after 5s, so the queued ALTER stops blocking the live site's reads", async () => {
    await migrate(migrationsDir({ "0000_t.sql": "CREATE TABLE IF NOT EXISTS t (id int);" }));
    const reader = await otherSession();
    await reader.query("BEGIN");
    await reader.query("SELECT count(*) FROM t");
    try {
      const startedAt = Date.now();
      const failure = await migrate(
        migrationsDir({ "0000_t.sql": "CREATE TABLE IF NOT EXISTS t (id int);", "0001_z.sql": "ALTER TABLE t ADD COLUMN IF NOT EXISTS z int;" }),
      ).catch((error: unknown) => error);

      expect((failure as Error).message).toBe("0001_z.sql:1 failed: canceling statement due to lock timeout [55P03]");
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      const { rows } = await db().pool.query<{ n: number }>("SELECT count(*)::int AS n FROM t");
      expect(rows[0].n).toBe(0);
    } finally {
      await reader.query("ROLLBACK");
      await reader.end();
    }
  });
});

describe("applyMigrations: seed rows", () => {
  it("adds the rows an approved INSERT seeds once, however often its file runs", async () => {
    const dir = migrationsDir({
      "0000_presets.sql": `
        CREATE TABLE IF NOT EXISTS presets (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, name text NOT NULL);
        INSERT INTO presets (key, name) VALUES ('one-life-line', 'One Life Line'), ('turbo', 'Turbo') ON CONFLICT (key) DO NOTHING;
        INSERT INTO presets (key, name) SELECT 'deep', 'Deep Stack' WHERE NOT EXISTS (SELECT 1 FROM presets WHERE key = 'deep');`,
    });

    await migrate(dir);
    for (const edit of ["\n-- first edit\n", "\n-- second edit\n"]) {
      fs.appendFileSync(path.join(dir, "0000_presets.sql"), edit);
      await migrate(dir);
    }

    const { rows } = await db().pool.query<{ key: string }>("SELECT key FROM presets ORDER BY key");
    expect(rows.map((row) => row.key)).toEqual(["deep", "one-life-line", "turbo"]);
  });

  it("fails the boot, rather than inserting again, when the conflict columns are not a unique key", async () => {
    const dir = migrationsDir({
      "0000_t.sql": "CREATE TABLE IF NOT EXISTS t (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text);",
      "0001_seed.sql": "INSERT INTO t (name) VALUES ('House player') ON CONFLICT (name) DO NOTHING;",
    });

    await expect(migrate(dir)).rejects.toThrow(/^0001_seed\.sql:1 failed: there is no unique or exclusion constraint matching the ON CONFLICT specification \[42P10\]$/);
  });
});

describe("applyMigrations: the advisory lock", () => {
  const dir = () => migrationsDir({ "0000_a.sql": "CREATE TABLE IF NOT EXISTS t_a (id int);" });

  it("waits while another session holds the lock, then proceeds once it is released", async () => {
    const holder = await otherSession();
    await holder.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    const logger = recordingLogger();
    try {
      const run = migrate(dir(), logger, 20_000);
      // Logged only after a failed attempt and a look at who holds the lock, so the holder is named while it still holds it.
      await waitForLine(logger.lines.info, /^Waiting for migration lock 727274, held by pid \d+ \(application "pokerpal-test-holder"/);
      expect(await tables()).toEqual([]);
      await holder.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);

      await expect(run).resolves.toMatchObject({ createdTables: ["_app_migrations", "t_a"] });
    } finally {
      await holder.end();
    }
  });

  it("retries, rather than crashing the process, when its connection is cut while it waits", async () => {
    const holder = await otherSession();
    await holder.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    // Shaped like the boot's pool, under a name that finds the runner's session.
    const pool = new pg.Pool({ connectionString: db().url, max: 1, application_name: "pokerpal-test-runner" });
    pool.on("error", () => {});
    const logger = recordingLogger();
    try {
      const run = retryWhileUnreachable(() => applyMigrations({ pool, dir: dir(), logger, lockWaitMs: 20_000 }), {
        waitMs: 20_000,
        logger,
      });
      await waitForLine(logger.lines.info, /^Waiting for migration lock/);

      // As a Postgres restart or failover ends it (57P01), here while the runner sleeps between attempts.
      const { rows } = await holder.query(
        "SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name = 'pokerpal-test-runner' AND datname = current_database()",
      );
      expect(rows).toEqual([{ terminated: true }]);
      await waitForLine(logger.lines.warn, /^Database unreachable \(.+\); retrying in 1s/);
      await holder.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);

      await expect(run).resolves.toMatchObject({ createdTables: ["_app_migrations", "t_a"] });
      expect(logger.lines.warn).toEqual(expect.arrayContaining([expect.stringMatching(/^Lost the migration connection: /)]));
    } finally {
      await holder.end();
      await pool.end();
    }
  });

  it("gives up on a lock that is never released, naming the session that holds it", async () => {
    const holder = await otherSession("stuck-laptop");
    await holder.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await expect(migrate(dir(), recordingLogger(), 1_500)).rejects.toThrow(
        /^Gave up after \d+s waiting for migration lock 727274, held by pid \d+ \(application "stuck-laptop", (?:from \S+, )?idle, connected \d+s ago\)/,
      );
      expect(await tables()).toEqual([]);
    } finally {
      await holder.end();
    }
  });
});

describe("a boot that cannot reach the database", () => {
  it("classifies a refused connection as unreachable and retries it until the wait is over", async () => {
    const closed = new pg.Pool({ connectionString: "postgres://nobody@127.0.0.1:1/unreachable_test", max: 1 });
    const logger = recordingLogger();
    const startedAt = Date.now();
    try {
      const failure = await retryWhileUnreachable(() => applyMigrations({ pool: closed, dir: MIGRATIONS_DIR, logger }), {
        waitMs: 1_500,
        logger,
      }).catch((error: unknown) => error);

      expect(isConnectionError(failure)).toBe(true);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_400);
      expect(logger.lines.warn.length).toBeGreaterThanOrEqual(1);
      expect(logger.lines.warn[0]).toMatch(/^Database unreachable \(.*ECONNREFUSED.*\); retrying in 1s/);
    } finally {
      await closed.end();
    }
  });

  it("classifies a connection that never answers as unreachable", async () => {
    const silent = net.createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as net.AddressInfo;
    const pool = new pg.Pool({ connectionString: `postgres://nobody@127.0.0.1:${port}/silent_test`, connectionTimeoutMillis: 200 });
    try {
      const failure = await applyMigrations({ pool, dir: MIGRATIONS_DIR, logger: recordingLogger() }).catch((error: unknown) => error);

      expect(isConnectionError(failure)).toBe(true);
    } finally {
      await pool.end();
      silent.close();
    }
  });

  it("names the way to start without migrating when a boot fails for any other reason", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const env = loadEnv({ ...process.env, DATABASE_URL: withDatabase(db().url, "pokerpal_never_created_test") });

      await expect(runBootMigrations(env)).rejects.toMatchObject({ code: "3D000" });
      expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^\[migrate\] MIGRATIONS FAILED: refusing to start\. .*MIGRATE_ON_BOOT=false/));
    } finally {
      errors.mockRestore();
    }
  });

  it("refuses to start with MIGRATE_ON_BOOT=false on a database without the schema this build queries, naming what is missing (P2REV3-PRODSAFE-01)", async () => {
    // A database left at the Phase 1 state: the baseline and the FK indexes only.
    const files = shippedFiles();
    const phaseOne = Object.fromEntries(Object.entries(files).filter(([name]) => name < "0002"));
    await migrate(migrationsDir(phaseOne));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const env = loadEnv({ ...process.env, DATABASE_URL: db().url, MIGRATE_ON_BOOT: "false" });

      const boot = runBootMigrations(env);

      await expect(boot).rejects.toBeInstanceOf(SchemaBehindError);
      await expect(boot).rejects.toMatchObject({ missing: expect.arrayContaining(["audit_log", "club_managers", "clubs.rake_label", "tournaments.rake_override"]) });
      expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^\[migrate\] SCHEMA BEHIND THIS BUILD: refusing to start with MIGRATE_ON_BOOT=false\. .*clubs\.rake_label/));
      // Nothing ran against the old schema: the seeds never started.
      expect(logs).not.toHaveBeenCalledWith(expect.stringMatching(/^\[seed\]/));
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
      logs.mockRestore();
    }
  });

  it("still starts with MIGRATE_ON_BOOT=false when the database has the schema, the escape hatch for a failing newest migration", async () => {
    await migrate(migrationsDir({ ...shippedFiles(), "9999_not_yet_applied.sql": "CREATE TABLE IF NOT EXISTS later_feature (id int);" }));
    await db().pool.query("DELETE FROM _app_migrations WHERE name = '9999_not_yet_applied.sql'");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runBootMigrations(loadEnv({ ...process.env, DATABASE_URL: db().url, MIGRATE_ON_BOOT: "false" }));

      expect(getBootMigrationStatus()).toEqual({ skipped: true });
    } finally {
      warnings.mockRestore();
      logs.mockRestore();
    }
  });

  it("finds nothing missing once every shipped migration is applied, and names a table or column that is gone", async () => {
    await migrate(migrationsDir(shippedFiles()));
    expect(await missingSchema(db().pool)).toEqual([]);

    await db().pool.query("ALTER TABLE clubs DROP COLUMN rake_label; DROP TABLE audit_log");

    expect(await missingSchema(db().pool)).toEqual(["audit_log", "clubs.rake_label"]);
    await expect(assertSchemaCurrent(db().pool)).rejects.toThrow("The database lacks what this build queries: audit_log, clubs.rake_label");
  });

  it("still boots against a reachable database, reporting what it applied", async () => {
    // The worker database is a clone of the migrated template, so every shipped file is already applied.
    const shipped = loadMigrationFiles(MIGRATIONS_DIR);

    await runBootMigrations(loadEnv(process.env));

    expect(getBootMigrationStatus()).toEqual({ files: shipped.length, lastFile: shipped.at(-1)?.name });
  });
});
