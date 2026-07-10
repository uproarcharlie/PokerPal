#!/usr/bin/env node
// Applies migrations/0001_add_fk_indexes.sql against whatever DATABASE_URL is set
// in the current environment. Safe to run anywhere, including production:
// every statement is CREATE INDEX IF NOT EXISTS, so it is additive and idempotent
// (it never drops, retypes, or reads row data). Re-running it is a no-op.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/apply-indexes.mjs
//   # or, if DATABASE_URL is already set in the environment (e.g. prod shell):
//   npm run db:indexes

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, '..', 'migrations', '0001_add_fk_indexes.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

// Show which database we are about to touch, with credentials redacted.
let target = '(unparseable)';
try {
  const u = new URL(url);
  target = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch {}
console.log(`Target database: ${target}`);

const sql = fs.readFileSync(sqlPath, 'utf8');
const pool = new pg.Pool({ connectionString: url });

const listIdx = async () => {
  const { rows } = await pool.query(
    `select indexname from pg_indexes where schemaname='public' and indexname like 'idx_%'`
  );
  return new Set(rows.map((r) => r.indexname));
};

try {
  const before = await listIdx();
  await pool.query(sql);
  const after = await listIdx();

  const created = [...after].filter((i) => !before.has(i)).sort();
  console.log(`\nDone. ${after.size} idx_* indexes present.`);
  if (created.length) {
    console.log(`Created ${created.length}:`);
    for (const i of created) console.log(`  + ${i}`);
  } else {
    console.log('No new indexes — everything was already in place (idempotent no-op).');
  }
  process.exit(0);
} catch (err) {
  console.error('\nFailed to apply indexes:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
