import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertMigrationsSafe,
  describeDatabaseTarget,
  isConnectionError,
  loadMigrationFiles,
  MigrationError,
  resolveMigrationsDir,
  retryWhileUnreachable,
  type MigrationLogger,
} from "./migrate";
import { createIndexStatements, findGuardViolations, splitSqlStatements } from "./migration-guard";

const violationsOf = (sql: string) => findGuardViolations(splitSqlStatements(sql)).map((violation) => violation.rule);

describe("splitSqlStatements", () => {
  it("splits on top-level semicolons, not those in literals, identifiers, dollar quotes or comments", () => {
    const statements = splitSqlStatements(`
      INSERT INTO t VALUES ('a;b', $$c;d$$, $tag$e;$$;f$tag$); -- trailing; comment
      /* block; /* nested; */ still a comment; */ SELECT "odd;name" FROM t;
      SELECT 1`);

    expect(statements.map((statement) => statement.sql)).toEqual([
      "INSERT INTO t VALUES ('a;b', $$c;d$$, $tag$e;$$;f$tag$)",
      'SELECT "odd;name" FROM t',
      "SELECT 1",
    ]);
  });

  it("empties top-level string literals for the guard but keeps dollar-quoted bodies verbatim", () => {
    const [statement] = splitSqlStatements("INSERT INTO t VALUES ('drop it', $$DELETE FROM x$$)");

    expect(statement.scan).toBe("INSERT INTO t VALUES ('', $$DELETE FROM x$$)");
    expect(statement.sql).toBe("INSERT INTO t VALUES ('drop it', $$DELETE FROM x$$)");
  });

  it("collapses whitespace and comments in the scanned text", () => {
    const [statement] = splitSqlStatements("ALTER  TABLE\n\tclubs -- why\n  ADD COLUMN IF NOT EXISTS x text");

    expect(statement.scan).toBe("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS x text");
  });

  it("treats backslashes as escapes only in E'' strings", () => {
    expect(splitSqlStatements("SELECT E'it\\'s; fine'; SELECT 2")).toHaveLength(2);
    expect(splitSqlStatements("SELECT 'a\\'; SELECT 3")).toHaveLength(2);
  });

  it("does not mistake identifiers containing $ or positional parameters for dollar quotes", () => {
    expect(splitSqlStatements("SELECT a$b$ FROM t; SELECT $1; SELECT 4")).toHaveLength(3);
  });

  it("records the line each statement starts on", () => {
    const statements = splitSqlStatements("SELECT 1;\n\n-- note\n/* a\n b */\n  SELECT 2;");

    expect(statements.map((statement) => statement.line)).toEqual([1, 6]);
  });

  it("ignores empty statements", () => {
    expect(splitSqlStatements(";; -- only a comment\n;")).toEqual([]);
  });

  it.each([
    ["string literal", "SELECT 'abc", /Unterminated string literal \(line 1\)/],
    ["block comment", "SELECT 1;\n/* abc", /Unterminated block comment \(line 2\)/],
    ["dollar quote", "DO $body$ BEGIN END", /Unterminated dollar-quoted string \$body\$/],
    ["quoted identifier", 'SELECT "abc', /Unterminated quoted identifier/],
  ])("rejects an unterminated %s", (_label, sql, message) => {
    expect(() => splitSqlStatements(sql)).toThrow(message);
  });
});

describe("destructive-SQL guard", () => {
  it.each([
    [
      "CREATE TABLE IF NOT EXISTS with inline constraints",
      `CREATE TABLE IF NOT EXISTS tournament_tables (
         id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
         tournament_id varchar NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
         table_number integer NOT NULL,
         CONSTRAINT tournament_tables_number_unique UNIQUE (tournament_id, table_number),
         CHECK (table_number > 0)
       )`,
    ],
    ["a nullable ADD COLUMN", "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS rake_label text"],
    ["ADD without the COLUMN keyword", "ALTER TABLE tournaments ADD IF NOT EXISTS rake_override numeric(10, 2)"],
    ["NOT NULL with a constant string default", "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'dark'"],
    ["NOT NULL with a cast numeric default", "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bonus integer DEFAULT 0::integer NOT NULL"],
    ["NOT NULL with a boolean default", "ALTER TABLE ONLY public.tournaments ADD COLUMN IF NOT EXISTS clock_on boolean DEFAULT false NOT NULL"],
    ["a nullable column defaulting to now()", "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS seen_at timestamptz DEFAULT now()"],
    ["a nullable column defaulting to CURRENT_TIMESTAMP", "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS seen_at timestamp DEFAULT CURRENT_TIMESTAMP"],
    ["a constant default cast to jsonb", "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS clock jsonb DEFAULT '[]'::jsonb"],
    [
      "columns merely named like a serial type, a generated column or a default",
      'ALTER TABLE players ADD COLUMN IF NOT EXISTS serial text, ADD COLUMN IF NOT EXISTS generated_at timestamptz, ADD COLUMN IF NOT EXISTS "default" text',
    ],
    [
      "several ADD COLUMN actions",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS a numeric(10, 2), ADD COLUMN IF NOT EXISTS b text DEFAULT 'x, y'",
    ],
    ["CREATE INDEX IF NOT EXISTS", "CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments (status)"],
    ["CREATE INDEX CONCURRENTLY IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_name ON players (name)"],
    [
      "CREATE UNIQUE INDEX on a table created earlier in the same file",
      `CREATE TABLE IF NOT EXISTS tournament_seats (id varchar PRIMARY KEY, table_id varchar, seat_number integer);
       CREATE UNIQUE INDEX IF NOT EXISTS idx_seat ON public."tournament_seats" (table_id, seat_number) WHERE released_at IS NULL`,
    ],
    ["an insert that skips rows whose fixed key exists", "INSERT INTO t (id, name) VALUES ('a', 'b') ON CONFLICT (id) DO NOTHING"],
    ["an upsert on a named conflict target that does nothing", "INSERT INTO clubs (name, slug) VALUES ('a', 'b') ON CONFLICT (slug) DO NOTHING"],
    [
      "several rows and conflict columns, quoted names and a partial-index predicate",
      `INSERT INTO "Presets" ("Key", club_id, name) VALUES ('a', 'c1', 'A'), ('b', 'c1', 'B')
         ON CONFLICT ("Key", club_id) WHERE archived_at IS NULL DO NOTHING`,
    ],
    [
      "an INSERT … SELECT with a conflict target it supplies",
      "INSERT INTO presets (club_id, key, name) SELECT id, 'one-life-line', 'One Life Line' FROM clubs WHERE slug = 'central-stars' ON CONFLICT (club_id, key) DO NOTHING",
    ],
    [
      "an insert guarded by WHERE NOT EXISTS",
      "INSERT INTO clubs (name, slug) SELECT 'Central Stars', 'central-stars' WHERE NOT EXISTS (SELECT 1 FROM clubs WHERE slug = 'central-stars')",
    ],
    [
      "WHERE NOT EXISTS on its own table under another spelling, with generated ids left to the default",
      "INSERT INTO public.points_systems (season_id, name) SELECT s.id, 'League' FROM seasons s WHERE NOT EXISTS (SELECT 1 FROM \"points_systems\" p WHERE p.season_id = s.id)",
    ],
    [
      "CREATE TYPE wrapped so a re-run skips it",
      "DO $$ BEGIN CREATE TYPE ante_mode AS ENUM ('none', 'bb_ante', 'everyone'); EXCEPTION WHEN duplicate_object THEN NULL; END $$",
    ],
    [
      "the same wrapper as drizzle-kit writes it, with labels that look like keywords",
      `DO $$ BEGIN\n CREATE TYPE "public"."seat_action" AS ENUM('drop', 'delete from', 'update x set');\nEXCEPTION\n WHEN duplicate_object THEN null;\nEND $$;`,
    ],
    [
      "CREATE DOMAIN in the wrapper, with a named dollar tag and LANGUAGE",
      "DO LANGUAGE plpgsql $body$ BEGIN CREATE DOMAIN chips AS integer CHECK (VALUE >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $body$",
    ],
    ["CREATE SEQUENCE and CREATE SCHEMA IF NOT EXISTS", "CREATE SEQUENCE IF NOT EXISTS ticket_seq; CREATE SCHEMA IF NOT EXISTS reporting"],
    [
      "foreign-key actions",
      `CREATE TABLE IF NOT EXISTS t (
         a varchar REFERENCES players (id) ON DELETE SET NULL ON UPDATE CASCADE,
         b varchar REFERENCES users (id) ON UPDATE SET NULL
       )`,
    ],
    [
      "destructive words in comments and data",
      "-- DROP TABLE users;\n/* TRUNCATE players; */\nALTER TABLE clubs ADD COLUMN IF NOT EXISTS note text DEFAULT 'drop-in; delete from later'",
    ],
    [
      "identifiers that merely contain a keyword",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS drop_off_time timestamp, ADD COLUMN IF NOT EXISTS unique_code text",
    ],
    ["ALTER TYPE … ADD VALUE IF NOT EXISTS", "ALTER TYPE seat_status ADD VALUE IF NOT EXISTS 'reserved'"],
    ["CREATE EXTENSION and COMMENT ON", "CREATE EXTENSION IF NOT EXISTS pgcrypto; COMMENT ON TABLE clubs IS 'Poker clubs'"],
  ])("allows %s", (_label, sql) => {
    expect(violationsOf(sql)).toEqual([]);
  });

  it("allows the 0002 tables, clock and AP migration the feature spec plans", () => {
    const sql = `
      ALTER TABLE clubs       ADD COLUMN IF NOT EXISTS rake_label text;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rake_override numeric(10,2);
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_pool_snapshot jsonb;
      CREATE TABLE IF NOT EXISTS tournament_tables (
        id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tournament_id varchar NOT NULL,
        table_number  integer NOT NULL,
        status        text    NOT NULL DEFAULT 'active',
        CONSTRAINT fk_tournament_tables_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
        CONSTRAINT uq_tournament_tables_number UNIQUE (tournament_id, table_number),
        CONSTRAINT ck_tournament_tables_status CHECK (status IN ('active', 'broken'))
      );
      CREATE TABLE IF NOT EXISTS tournament_seats (
        id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id        varchar NOT NULL,
        registration_id varchar NOT NULL,
        seat_number     integer NOT NULL,
        released_at     timestamptz,
        CONSTRAINT fk_tournament_seats_registration FOREIGN KEY (registration_id) REFERENCES tournament_registrations(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_seats_active_seat
        ON tournament_seats (table_id, seat_number) WHERE released_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_tournament_seats_table_id ON tournament_seats (table_id);
      CREATE TABLE IF NOT EXISTS tournament_clocks (
        tournament_id varchar PRIMARY KEY,
        levels        jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT ck_tournament_clocks_levels_array CHECK (jsonb_typeof(levels) = 'array')
      );`;

    expect(violationsOf(sql)).toEqual([]);
  });

  it.each([
    ["DROP TABLE", "DROP TABLE IF EXISTS players", /^DROP/],
    ["DROP COLUMN", "ALTER TABLE players DROP COLUMN phone", /^DROP/],
    ["DROP INDEX", "DROP INDEX idx_players_email", /^DROP/],
    ["TRUNCATE", "TRUNCATE activity_log", /^TRUNCATE/],
    ["RENAME COLUMN", "ALTER TABLE clubs RENAME COLUMN slug TO handle", /^RENAME/],
    ["RENAME TABLE", "ALTER TABLE clubs RENAME TO venues", /^RENAME/],
    ["DELETE FROM", "DELETE FROM session WHERE expire < now()", /^DELETE FROM/],
    ["UPDATE … SET", "UPDATE tournament_registrations SET rebuys = 0 WHERE rebuys IS NULL", /^UPDATE … SET/],
    ["UPDATE with ONLY, a qualified name and an alias", 'UPDATE ONLY public."clubs" AS c SET name = upper(c.name)', /^UPDATE … SET/],
    [
      "an upsert that overwrites",
      "INSERT INTO clubs (id, name, slug) VALUES ('a', 'b', 'c') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name",
      /^ON CONFLICT DO UPDATE/,
    ],
    ["MERGE", "MERGE INTO players p USING staging s ON s.id = p.id WHEN MATCHED THEN DELETE", /^MERGE/],
    ["ALTER COLUMN", "ALTER TABLE tournaments ALTER COLUMN status DROP DEFAULT", /^ALTER COLUMN/],
    ["ALTER … TYPE without the COLUMN keyword", "ALTER TABLE tournaments ALTER status TYPE varchar(20)", /may only ADD COLUMN/],
    ["SET NOT NULL", "ALTER TABLE tournament_registrations ALTER COLUMN rebuys SET NOT NULL", /^SET NOT NULL/],
    ["SET DATA TYPE", 'ALTER TABLE activity_log ALTER COLUMN "timestamp" SET DATA TYPE timestamp', /^SET DATA TYPE/],
    [
      "ADD CONSTRAINT",
      "ALTER TABLE tournament_registrations ADD CONSTRAINT one_entry UNIQUE (tournament_id, player_id)",
      /^ADD CONSTRAINT/,
    ],
    [
      "a table constraint without the CONSTRAINT keyword",
      "ALTER TABLE tournament_registrations ADD UNIQUE (tournament_id, player_id)",
      /table constraint/,
    ],
    ["ADD COLUMN … NOT NULL without a default", "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS rake_label text NOT NULL", /needs a constant DEFAULT/],
    [
      "ADD COLUMN … NOT NULL defaulting to now(), which is not a constant",
      "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS stamp timestamp NOT NULL DEFAULT now()",
      /needs a constant DEFAULT/,
    ],
    [
      "ADD COLUMN … NOT NULL with an expression default",
      "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS n integer NOT NULL DEFAULT 1 + 1",
      /needs a constant DEFAULT/,
    ],
    ["ADD COLUMN … DEFAULT NULL NOT NULL", "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS n integer DEFAULT NULL NOT NULL", /needs a constant DEFAULT/],
    ["ADD COLUMN … UNIQUE", "ALTER TABLE players ADD COLUMN IF NOT EXISTS handle text UNIQUE", /UNIQUE adds a constraint/],
    ["ADD COLUMN … PRIMARY KEY", "ALTER TABLE session ADD COLUMN IF NOT EXISTS id serial PRIMARY KEY", /PRIMARY KEY adds a constraint/],
    [
      "ADD COLUMN … REFERENCES",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS venue_id varchar REFERENCES clubs (id)",
      /REFERENCES adds a constraint/,
    ],
    ["ADD COLUMN … CHECK", "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS seats integer CHECK (seats > 0)", /CHECK adds a constraint/],
    ["ADD COLUMN without IF NOT EXISTS", "ALTER TABLE clubs ADD COLUMN rake_label text", /must use IF NOT EXISTS/],

    // Columns Postgres fills per existing row, rewriting the whole table under an exclusive lock.
    [
      "a nullable ADD COLUMN with a volatile default",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS share_token uuid DEFAULT gen_random_uuid()",
      /^ADD COLUMN … DEFAULT must be a constant \(or now\(\)\)/,
    ],
    ["a random() default", "ALTER TABLE players ADD COLUMN IF NOT EXISTS r double precision DEFAULT random()", /DEFAULT must be a constant/],
    ["a clock_timestamp() default", "ALTER TABLE players ADD COLUMN IF NOT EXISTS t timestamptz DEFAULT clock_timestamp()", /DEFAULT must be a constant/],
    ["a nextval() default", "ALTER TABLE players ADD COLUMN IF NOT EXISTS n bigint DEFAULT nextval('ticket_seq')", /DEFAULT must be a constant/],
    ["an expression default", "ALTER TABLE players ADD COLUMN IF NOT EXISTS n integer DEFAULT 1 + 1", /DEFAULT must be a constant/],
    ["a serial column", "ALTER TABLE users ADD COLUMN IF NOT EXISTS n serial", /^ADD COLUMN … SERIAL fills every existing row/],
    ["a bigserial column", "ALTER TABLE users ADD COLUMN IF NOT EXISTS n bigserial", /^ADD COLUMN … BIGSERIAL fills every existing row/],
    ["a serial8 column", "ALTER TABLE users ADD COLUMN IF NOT EXISTS n serial8", /^ADD COLUMN … SERIAL8 fills every existing row/],
    [
      "an identity column",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS n integer GENERATED ALWAYS AS IDENTITY",
      /^ADD COLUMN … GENERATED fills every existing row/,
    ],
    [
      "a stored generated column",
      "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS double_buy_in numeric GENERATED ALWAYS AS (buy_in_amount * 2) STORED",
      /^ADD COLUMN … GENERATED fills every existing row/,
    ],
    [
      "CREATE UNIQUE INDEX on an existing table",
      "CREATE UNIQUE INDEX IF NOT EXISTS uniq_entry ON tournament_registrations (tournament_id, player_id)",
      /CREATE UNIQUE INDEX on "tournament_registrations", which this file did not create/,
    ],
    [
      "CREATE UNIQUE INDEX on a quoted, qualified existing table",
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uniq_slug ON ONLY public."clubs" (slug)',
      /CREATE UNIQUE INDEX on "clubs", which this file did not create/,
    ],
    ["CREATE TABLE without IF NOT EXISTS", "CREATE TABLE seats (id text)", /CREATE TABLE must use IF NOT EXISTS/],
    ["CREATE INDEX without IF NOT EXISTS", "CREATE INDEX idx_clubs_name ON clubs (name)", /CREATE INDEX must/],
    ["an unnamed CREATE INDEX", "CREATE INDEX ON clubs (name)", /CREATE INDEX must/],
    ["CREATE INDEX CONCURRENTLY without IF NOT EXISTS", "CREATE INDEX CONCURRENTLY idx_a ON clubs (name)", /CREATE INDEX must/],
    ["transaction control", "COMMIT", /transaction control belongs to the runner/],
    ["other ALTER statements", "ALTER SEQUENCE some_seq RESTART WITH 1", /only "ALTER TABLE/],
    ["destructive SQL inside a DO block", "DO $$ BEGIN EXECUTE 'DROP TABLE players'; END $$", /^DROP/],
    [
      "destructive SQL inside a function body",
      "CREATE OR REPLACE FUNCTION purge() RETURNS void AS $fn$ DELETE FROM players $fn$ LANGUAGE sql",
      /^DELETE FROM/,
    ],
    ["lower case and odd spacing", "alter   table\n  clubs\n  drop\tcolumn slug", /^DROP/],

    // Statements that work once and then fail (or duplicate rows) when the file runs again.
    ["a bare CREATE TYPE", "CREATE TYPE ante_mode AS ENUM ('none', 'bb_ante', 'everyone')", /CREATE TYPE and CREATE DOMAIN have no IF NOT EXISTS/],
    ["a bare, quoted CREATE TYPE", `CREATE TYPE "public"."ante_mode" AS ENUM('none')`, /no IF NOT EXISTS/],
    ["a bare CREATE DOMAIN", "CREATE DOMAIN chips AS integer", /no IF NOT EXISTS/],
    ["CREATE SEQUENCE without IF NOT EXISTS", "CREATE SEQUENCE ticket_seq", /CREATE SEQUENCE must use IF NOT EXISTS/],
    ["CREATE SCHEMA without IF NOT EXISTS", "CREATE SCHEMA app", /CREATE SCHEMA must use IF NOT EXISTS/],
    ["CREATE EXTENSION without IF NOT EXISTS", "CREATE EXTENSION pgcrypto", /CREATE EXTENSION must use IF NOT EXISTS/],
    ["CREATE VIEW", "CREATE VIEW v AS SELECT 1", /is not one of the additive, re-runnable statements/],
    ["CREATE OR REPLACE VIEW", "CREATE OR REPLACE VIEW v AS SELECT 1", /"CREATE OR REPLACE VIEW" is not one of/],
    ["a plain INSERT", "INSERT INTO clubs (name, slug) VALUES ('Central Stars', 'central-stars')", /^INSERT must use ON CONFLICT \(/],
    [
      "ON CONFLICT DO NOTHING without conflict columns, which a generated id never trips",
      "INSERT INTO points_systems (season_id, name) SELECT s.id, 'League' FROM seasons s ON CONFLICT DO NOTHING",
      /without conflict columns/,
    ],
    [
      "a conflict column the INSERT leaves to its default",
      "INSERT INTO players (name) VALUES ('House player') ON CONFLICT (id) DO NOTHING",
      /ON CONFLICT \(id\) names a column the INSERT does not supply/,
    ],
    [
      "a conflict key generated afresh on every run",
      "INSERT INTO players (id, name) VALUES (gen_random_uuid(), 'x') ON CONFLICT (id) DO NOTHING",
      /must insert fixed values/,
    ],
    ["DEFAULT among the values", "INSERT INTO clubs (id, name, slug) VALUES (DEFAULT, 'a', 'b') ON CONFLICT (slug) DO NOTHING", /must insert fixed values/],
    [
      "a conflict target named by constraint",
      "INSERT INTO clubs (name, slug) VALUES ('a', 'b') ON CONFLICT ON CONSTRAINT clubs_slug_key DO NOTHING",
      /must name plain columns/,
    ],
    ["an expression conflict target", "INSERT INTO users (email) VALUES ('a@b.c') ON CONFLICT ((lower(email))) DO NOTHING", /must name plain columns/],
    ["ON CONFLICT without a column list", "INSERT INTO clubs VALUES ('id', 'a', 'b') ON CONFLICT (slug) DO NOTHING", /must list its columns/],
    [
      "WHERE NOT EXISTS that looks in a different table",
      "INSERT INTO players (name) SELECT 'House' WHERE NOT EXISTS (SELECT 1 FROM clubs WHERE slug = 'none')",
      /WHERE NOT EXISTS must look in "players"/,
    ],
    [
      "CREATE FUNCTION",
      "CREATE FUNCTION f() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql",
      /functions and procedures run code the guard cannot check/,
    ],

    // SQL hidden in single-quoted bodies, which the splitter empties.
    ["a single-quoted DO body", "DO 'BEGIN DELETE FROM players; UPDATE tournaments SET status = ''x''; END'", /^DO blocks may only wrap/],
    ["an E'' DO body", "DO E'BEGIN DROP TABLE players; END'", /^DO blocks may only wrap/],
    [
      "a single-quoted function body",
      "CREATE OR REPLACE FUNCTION wipe() RETURNS void LANGUAGE sql AS 'TRUNCATE session'",
      /functions and procedures run code/,
    ],
    ["calling a function", "SELECT wipe()", /"SELECT wipe\(\)" is not one of/],
    ["CALL", "CALL purge()", /is not one of/],

    // DO blocks that would slip past the ALTER and CREATE checks.
    ["a retype inside a DO block", "DO $$ BEGIN ALTER TABLE tournaments ALTER buy_in_amount TYPE integer; END $$", /^DO blocks may only wrap/],
    ["SET UNLOGGED inside a DO block", "DO $$ BEGIN ALTER TABLE clubs SET UNLOGGED; END $$", /^DO blocks may only wrap/],
    [
      "ADD COLUMN … NOT NULL without a default inside a DO block",
      "DO $$ BEGIN ALTER TABLE clubs ADD COLUMN IF NOT EXISTS x int NOT NULL; END $$",
      /^DO blocks may only wrap/,
    ],
    [
      "dynamic SQL in a DO block",
      "DO $$ BEGIN EXECUTE format('ALTER TABLE %I ALTER %I TYPE int', 'tournaments', 'buy_in_amount'); END $$",
      /^DO blocks may only wrap/,
    ],
    ["CREATE TABLE without IF NOT EXISTS inside a DO block", "DO $$ BEGIN CREATE TABLE foo (id int); END $$", /^DO blocks may only wrap/],
    [
      "a CREATE TYPE wrapper that also runs something else",
      "DO $$ BEGIN CREATE TYPE a AS ENUM ('x'); DELETE FROM players; EXCEPTION WHEN duplicate_object THEN NULL; END $$",
      /^DELETE FROM/,
    ],
    [
      "a CREATE TYPE wrapper that swallows every error",
      "DO $$ BEGIN CREATE TYPE a AS ENUM ('x'); EXCEPTION WHEN others THEN NULL; END $$",
      /^DO blocks may only wrap/,
    ],
    [
      "a CREATE TYPE wrapper with a comment hiding more SQL",
      "DO $$ BEGIN CREATE TYPE a AS ENUM ('x'); -- note\n EXCEPTION WHEN duplicate_object THEN TRUNCATE players; END $$",
      /^TRUNCATE/,
    ],

    // DDL that silently changes what future writes do, or who may make them.
    ["CREATE RULE", "CREATE RULE r AS ON UPDATE TO players DO INSTEAD NOTHING", /CREATE RULE can silently rewrite or discard future writes/],
    ["CREATE OR REPLACE RULE", "CREATE OR REPLACE RULE r AS ON INSERT TO clubs DO INSTEAD NOTHING", /CREATE RULE/],
    [
      "CREATE TRIGGER",
      "CREATE TRIGGER t BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION f()",
      /CREATE TRIGGER can silently change or discard future writes/,
    ],
    ["CREATE POLICY", "CREATE POLICY p ON clubs USING (false)", /CREATE POLICY changes which rows/],
    ["GRANT", "GRANT SELECT ON clubs TO PUBLIC", /GRANT and REVOKE/],
    ["REVOKE", "REVOKE ALL ON clubs FROM PUBLIC", /GRANT and REVOKE/],
    [
      "CREATE UNIQUE INDEX on a table this file did not create",
      "CREATE UNIQUE INDEX IF NOT EXISTS u ON tournament_tables (tournament_id, table_number)",
      /CREATE UNIQUE INDEX on "tournament_tables", which this file did not create/,
    ],
    ["other statements", "COPY clubs FROM PROGRAM 'curl example.com'", /"COPY clubs FROM PROGRAM" is not one of/],

    // The runner's lock_timeout (5s) and statement_timeout (60s) keep a migration from stalling the live site.
    ["switching off lock_timeout", "SET lock_timeout = 0", /^SET and RESET belong to the runner/],
    ["lock_timeout back to the server default", "SET lock_timeout TO DEFAULT", /^SET and RESET/],
    ["a quoted lock_timeout", "SET lock_timeout = '0'", /^SET and RESET/],
    ["a huge statement_timeout", "SET statement_timeout = '1000d'", /^SET and RESET/],
    ["SET SESSION and SET LOCAL", "SET SESSION lock_timeout = 0; SET LOCAL statement_timeout TO 0", /^SET and RESET/],
    ["RESET", "RESET lock_timeout; RESET ALL", /^SET and RESET/],
    ["the pg_dump preamble", "SET statement_timeout = 0; SET lock_timeout = 0; SET client_encoding = 'UTF8'", /^SET and RESET/],

    // A UNIQUE index justified by a CREATE TABLE that cannot have created the indexed table.
    [
      "CREATE UNIQUE INDEX after a temporary table of the same name",
      "CREATE TEMP TABLE IF NOT EXISTS players (id varchar); CREATE UNIQUE INDEX IF NOT EXISTS players_name_uq ON public.players (name)",
      /CREATE UNIQUE INDEX on "players", which this file did not create/,
    ],
    [
      "CREATE UNIQUE INDEX after a table of the same name in another schema",
      "CREATE TABLE IF NOT EXISTS other.players (id varchar); CREATE UNIQUE INDEX IF NOT EXISTS players_name_uq ON public.players (name)",
      /CREATE UNIQUE INDEX on "players", which this file did not create/,
    ],
  ])("refuses %s", (_label, sql, rule) => {
    expect(violationsOf(sql)).toEqual(expect.arrayContaining([expect.stringMatching(rule)]));
  });

  it("refuses every statement of a file that switches the runner's timeouts off", () => {
    const sql = "SET lock_timeout = 0;\nSET statement_timeout = 0;\nALTER TABLE players ADD COLUMN IF NOT EXISTS z int;";

    expect(findGuardViolations(splitSqlStatements(sql)).map((violation) => violation.line)).toEqual([1, 2]);
  });

  it("gives a keyword refusal once, without a second, generic reason", () => {
    expect(violationsOf("DROP TABLE players")).toEqual(["DROP removes objects or data"]);
  });

  it("treats a unique index on a table an earlier file created as one on an existing table", () => {
    const files = [
      { name: "0002_tables", sha256: "", transactional: true, statements: splitSqlStatements("CREATE TABLE IF NOT EXISTS seats (id text);") },
      {
        name: "0003_unique",
        sha256: "",
        transactional: true,
        statements: splitSqlStatements("CREATE UNIQUE INDEX IF NOT EXISTS uq_seats ON seats (id);"),
      },
    ];

    expect(() => assertMigrationsSafe(files)).toThrow(/0003_unique\.sql:1: CREATE UNIQUE INDEX on "seats", which this file did not create/);
  });

  it("reports the line of each rejected statement with an excerpt", () => {
    const violations = findGuardViolations(
      splitSqlStatements("CREATE INDEX IF NOT EXISTS a ON clubs (name);\n\n-- next\nDROP TABLE players;\n"),
    );

    expect(violations).toEqual([{ line: 4, rule: expect.stringMatching(/^DROP/), excerpt: "DROP TABLE players" }]);
  });

  it("lists each CREATE INDEX with its index and table as the database names them, for the runner's live checks", () => {
    const statements = splitSqlStatements(`
      CREATE TABLE IF NOT EXISTS seats (id text, n int);
      CREATE UNIQUE INDEX IF NOT EXISTS Seats_N ON seats (n);
      CREATE INDEX IF NOT EXISTS seats_id ON seats (id);
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Odd""Name" ON ONLY public . "Seats" (id);`);

    expect(createIndexStatements(statements)).toEqual([
      { line: 3, index: "seats_n", table: '"seats"', unique: true },
      { line: 4, index: "seats_id", table: '"seats"', unique: false },
      { line: 5, index: 'Odd"Name', table: '"public"."Seats"', unique: true },
    ]);
  });

  it("passes every migration that ships in migrations/", () => {
    const files = loadMigrationFiles(resolveMigrationsDir());

    expect(files.map((file) => file.name)).toEqual(expect.arrayContaining(["0000_baseline", "0001_add_fk_indexes"]));
    expect(() => assertMigrationsSafe(files)).not.toThrow();
  });
});

describe("loadMigrationFiles", () => {
  const tempDirs: string[] = [];
  const makeDir = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokerpal-migrations-"));
    tempDirs.push(dir);
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(dir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("orders files by name and ignores sub-directories and non-SQL files", () => {
    const dir = makeDir({
      "0002_second.sql": "SELECT 2;",
      "0000_first.sql": "SELECT 0; SELECT 1;",
      "README.md": "not a migration",
      "meta/0003_ignored.sql": "DROP TABLE clubs;",
    });

    const files = loadMigrationFiles(dir);

    expect(files.map((file) => [file.name, file.statements.length])).toEqual([
      ["0000_first", 2],
      ["0002_second", 1],
    ]);
  });

  it("hashes the exact file bytes", () => {
    const contents = "-- comment\nSELECT 1;\n";
    const [file] = loadMigrationFiles(makeDir({ "0000_a.sql": contents }));

    expect(file.sha256).toBe(createHash("sha256").update(contents).digest("hex"));
  });

  it("runs a file outside a transaction only when its first line is the directive", () => {
    const files = loadMigrationFiles(
      makeDir({
        "0000_plain.sql": "SELECT 1;",
        "0001_concurrent.sql": "-- runner:no-transaction\r\nCREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t (c);",
        "0002_late.sql": "SELECT 1;\n-- runner:no-transaction\n",
      }),
    );

    expect(files.map((file) => file.transactional)).toEqual([true, false, true]);
  });

  it("rejects .sql files that are not named NNNN_lower_snake_case.sql", () => {
    const dir = makeDir({ "0000_ok.sql": "", "1_bad.sql": "", "0002-Bad.SQL": "" });

    expect(() => loadMigrationFiles(dir)).toThrow(/rename: 0002-Bad\.SQL, 1_bad\.sql/);
  });

  it("rejects two files with the same number", () => {
    const dir = makeDir({ "0001_a.sql": "", "0001_b.sql": "" });

    expect(() => loadMigrationFiles(dir)).toThrow(/0001_a\.sql and 0001_b\.sql share the number 0001/);
  });

  it("names the file when its SQL cannot be parsed", () => {
    const dir = makeDir({ "0000_broken.sql": "SELECT 'unterminated" });

    expect(() => loadMigrationFiles(dir)).toThrow(/0000_broken\.sql: Unterminated string literal/);
  });

  it("fails when the directory is missing", () => {
    expect(() => loadMigrationFiles(path.join(os.tmpdir(), "pokerpal-no-such-dir"))).toThrow(MigrationError);
  });

  it("lists every guard violation across files in one error", () => {
    const files = loadMigrationFiles(
      makeDir({
        "0000_ok.sql": "CREATE TABLE IF NOT EXISTS a (id int);",
        "0001_bad.sql": "CREATE TABLE IF NOT EXISTS b (id int);\nDROP TABLE clubs;",
        "0002_bad.sql": "TRUNCATE players; INSERT INTO clubs (name) VALUES ('x');",
      }),
    );

    expect(() => assertMigrationsSafe(files)).toThrow(
      /rejected 3 statement\(s\):\n {2}0001_bad\.sql:2: DROP[\s\S]*0002_bad\.sql:1: TRUNCATE[\s\S]*0002_bad\.sql:1: INSERT must/,
    );
  });
});

describe("resolveMigrationsDir", () => {
  it("finds the repo's migrations/ when running from source", () => {
    expect(resolveMigrationsDir()).toBe(path.resolve(import.meta.dirname, "..", "..", "migrations"));
  });

  it("prefers migrations/ beside the bundle", () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokerpal-dist-"));
    fs.mkdirSync(path.join(distDir, "migrations"));
    try {
      expect(resolveMigrationsDir(distDir)).toBe(path.join(distDir, "migrations"));
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });
});

describe("describeDatabaseTarget", () => {
  it.each([
    ["postgres://app:s3cret@localhost:5432/pokerpal", "localhost:5432/pokerpal", true],
    ["postgresql://app:s3cret@127.0.0.1/pokerpal_test", "127.0.0.1:5432/pokerpal_test", true],
    ["postgres://app:s3cret@[::1]:5433/pokerpal", "::1:5433/pokerpal", true],
    ["postgres://app:s3cret@postgres.railway.internal:5432/railway", "postgres.railway.internal:5432/railway", false],
    ["postgres://app:s3cret@localhost/pokerpal?host=db.example.com", "db.example.com:5432/pokerpal", false],
    ["postgres:///pokerpal?host=/var/run/postgresql", "/var/run/postgresql:5432/pokerpal", true],
    ["not a url", "(unparseable connection string)", false],
  ])("describes %s without credentials", (url, label, isLocal) => {
    const target = describeDatabaseTarget(url);

    expect(target).toEqual({ label, isLocal });
    expect(target.label).not.toContain("s3cret");
  });
});

describe("isConnectionError", () => {
  const withCode = (code: string, message = "") => Object.assign(new Error(message), { code });

  it.each([
    ["a refused connection", withCode("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")],
    ["an unknown host", withCode("ENOTFOUND", "getaddrinfo ENOTFOUND postgres.railway.internal")],
    ["a dropped connection", withCode("ECONNRESET")],
    ["Postgres starting up", withCode("57P03", "the database system is starting up")],
    ["Postgres shutting down", withCode("57P01", "terminating connection due to administrator command")],
    ["a connection-exception SQLSTATE", withCode("08006")],
    ["too many connections", withCode("53300")],
    ["the pool's connect timeout", new Error("timeout exceeded when trying to connect")],
    ["a connection that ended mid-query", new Error("Connection terminated unexpectedly")],
    ["an AggregateError from trying each address", Object.assign(new AggregateError([withCode("ECONNREFUSED")], ""), { code: "ECONNREFUSED" })],
    ["an AggregateError without a code of its own", new AggregateError([withCode("ETIMEDOUT"), withCode("ECONNREFUSED")])],
    ["a migration failure caused by a dropped connection", new MigrationError("0001_x.sql:3 failed", { cause: withCode("57P01") })],
  ])("recognises %s", (_label, error) => {
    expect(isConnectionError(error)).toBe(true);
  });

  it.each([
    ["a guard refusal", new MigrationError("Refusing to run migrations: the destructive-SQL guard rejected 1 statement(s)")],
    ["a SQL error", new MigrationError("0001_x.sql:3 failed", { cause: withCode("42P01", 'relation "t" does not exist') })],
    ["a lock timeout", withCode("55P03", "canceling statement due to lock timeout")],
    ["a statement timeout", withCode("57014", "canceling statement due to statement timeout")],
    ["bad credentials", withCode("28P01", 'password authentication failed for user "app"')],
    ["a missing database", withCode("3D000", 'database "x" does not exist')],
    ["something that is not an Error", "ECONNREFUSED"],
  ])("does not treat %s as one", (_label, error) => {
    expect(isConnectionError(error)).toBe(false);
  });
});

describe("retryWhileUnreachable", () => {
  const refused = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  const logger = (): MigrationLogger & { warnings: string[] } => {
    const warnings: string[] = [];
    return { warnings, info: () => {}, warn: (message) => warnings.push(message), error: () => {} };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries with growing delays until the database answers", async () => {
    vi.useFakeTimers();
    const log = logger();
    const work = vi.fn<() => Promise<string>>().mockRejectedValueOnce(refused()).mockRejectedValueOnce(refused()).mockResolvedValue("done");

    const result = retryWhileUnreachable(work, { waitMs: 60_000, logger: log });
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toBe("done");
    expect(work).toHaveBeenCalledTimes(3);
    expect(log.warnings).toEqual([
      expect.stringMatching(/^Database unreachable \(connect ECONNREFUSED 127\.0\.0\.1:5432 \[ECONNREFUSED\]\); retrying in 1s \(waited 0s of 60s\)$/),
      expect.stringMatching(/retrying in 2s \(waited 1s of 60s\)$/),
    ]);
  });

  it("gives up with the last connection error once the wait is over", async () => {
    vi.useFakeTimers();
    const work = vi.fn<() => Promise<never>>().mockImplementation(async () => {
      throw refused();
    });

    const result = retryWhileUnreachable(work, { waitMs: 30_000, logger: logger() });
    const settled = expect(result).rejects.toMatchObject({ code: "ECONNREFUSED" });
    await vi.advanceTimersByTimeAsync(30_000);

    await settled;
    // 1 + 2 + 4 + 8 + 10s of delays, then the last 5s, then the attempt at 30s fails for good.
    expect(work).toHaveBeenCalledTimes(7);
  });

  it("rejects at once when the failure is not about reaching the database", async () => {
    const work = vi.fn<() => Promise<never>>().mockRejectedValue(new MigrationError("Refusing to run migrations"));

    await expect(retryWhileUnreachable(work, { waitMs: 60_000, logger: logger() })).rejects.toThrow("Refusing to run migrations");
    expect(work).toHaveBeenCalledTimes(1);
  });
});
