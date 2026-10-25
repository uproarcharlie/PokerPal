-- 0012_round5_table_shape.sql
-- Round 5 (item 4): the shape a table is drawn as: 'oval' | 'rectangle' | 'round'
-- (shared/domain/table-layout). New tables are written with the shape the TD chose; NULL, which every
-- existing table reads, means the tournament's shape, else its club's default, else oval
-- (resolveTableShape), so Central Stars' existing tables draw as rectangles once the club default is
-- seeded.
--
-- ADDITIVE + IDEMPOTENT ONLY: one nullable column on tournament_tables, no default. No constraint is
-- added (the app validates the value). Re-running is a no-op. The ALTER takes ACCESS EXCLUSIVE on
-- tournament_tables only, for this file's transaction (a catalogue change, no rewrite).
--
-- Deploy order: old code with this schema is fine (it never names the column; its inserts leave it
-- NULL). New code needs it, which the boot applies before it listens.

ALTER TABLE tournament_tables ADD COLUMN IF NOT EXISTS shape text;
