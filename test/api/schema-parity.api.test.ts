/**
 * The migrations (what production runs at boot) and shared/schema.ts (what the
 * code is typed against) must describe the same database. On a freshly
 * migrated worker database, drizzle-kit's push diff of schema.ts must be empty
 * apart from tables schema.ts deliberately does not model.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import drizzleConfig from "../../drizzle.config";
import { getPool } from "../../server/db";
import { pushAppSchema } from "../helpers/scratch-db";
import { MIGRATIONS_DIR } from "../setup/databases";

/** In the database but not in schema.ts: the connect-pg-simple sessions and the migration ledger. */
const UNMODELLED_TABLE = /"(session|_app_migrations)"/;

/**
 * Constraints whose names differ but whose definitions match. They were added
 * by hand on the live databases under Postgres's default names, and the
 * baseline keeps those names; schema.ts lets drizzle pick its own. A name is
 * not part of the schema the app relies on, so only these exact pairs pass.
 */
const KNOWN_NAME_ONLY_DIFFERENCES = [
  { table: "clubs", database: "clubs_owner_id_fkey", drizzle: "clubs_owner_id_users_id_fk" },
  { table: "clubs", database: "clubs_slug_key", drizzle: "clubs_slug_unique" },
];

const DROP_CONSTRAINT = /^ALTER TABLE "(\w+)" DROP CONSTRAINT "(\w+)";?$/;
const ADD_CONSTRAINT = /^ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)" (.+?);?$/;

/** Compare constraint definitions from pg_get_constraintdef and drizzle's DDL. */
function normaliseDefinition(definition: string): string {
  return definition
    .toLowerCase()
    .replaceAll('"', "")
    .replaceAll("public.", "")
    .replace(/ on (update|delete) no action/g, "")
    .replace(/\s+/g, "");
}

describe("schema parity: migrations/*.sql vs shared/schema.ts", () => {
  it("leaves nothing for drizzle-kit to change", async () => {
    const pool = getPool();
    const statements = await pushAppSchema(pool);
    const relevant = statements.filter((statement) => !UNMODELLED_TABLE.test(statement));

    const { rows } = await pool.query<{ table: string; name: string; definition: string }>(`
      SELECT conrelid::regclass::text AS table, conname AS name, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE connamespace = 'public'::regnamespace`);
    const existing = new Map(rows.map((row) => [`${row.table}.${row.name}`, normaliseDefinition(row.definition)]));

    const drops = relevant.flatMap((statement) => {
      const match = DROP_CONSTRAINT.exec(statement);
      return match ? [{ statement, table: match[1], name: match[2] }] : [];
    });
    const adds = relevant.flatMap((statement) => {
      const match = ADD_CONSTRAINT.exec(statement);
      return match ? [{ statement, table: match[1], name: match[2], definition: normaliseDefinition(match[3]) }] : [];
    });

    const renames: Array<{ table: string; database: string; drizzle: string }> = [];
    const explained = new Set<string>();
    for (const drop of drops) {
      const definition = existing.get(`${drop.table}.${drop.name}`);
      const add = adds.find((candidate) => candidate.table === drop.table && candidate.definition === definition);
      if (!add || explained.has(add.statement)) continue;
      renames.push({ table: drop.table, database: drop.name, drizzle: add.name });
      explained.add(drop.statement).add(add.statement);
    }

    expect(relevant.filter((statement) => !explained.has(statement))).toEqual([]);
    expect(renames.sort((a, b) => a.database.localeCompare(b.database))).toEqual(KNOWN_NAME_ONLY_DIFFERENCES);
  });
});

describe("drizzle-kit with the repo's config (drizzle.config.ts)", () => {
  it("would leave the session table and the migration ledger alone on a migrated database", async () => {
    const tablesFilter = drizzleConfig.tablesFilter === undefined ? undefined : [drizzleConfig.tablesFilter].flat();

    const statements = await pushAppSchema(getPool(), { tablesFilter });

    expect(statements.filter((statement) => /\bDROP TABLE\b/i.test(statement))).toEqual([]);
    expect(drizzleConfig).toMatchObject({ strict: true });
  });

  it("never writes generated SQL into migrations/, which the server applies at boot", () => {
    const out = path.resolve(import.meta.dirname, "../..", drizzleConfig.out ?? "drizzle");

    expect(path.relative(MIGRATIONS_DIR, out).startsWith("..")).toBe(true);
  });
});
