-- 0010_round5_clubs.sql
-- Round 5 (the owner's requests while testing Phase 4): a club's defaults for its tournaments' tables
-- (seats per table, the shape the seating plans draw), whether its QR sign-up requires a photo, and
-- its colours (clubs.theme, a validated JSON object: shared/domain/theme ClubTheme; Phase 5 extends
-- it with fonts, backgrounds and panels).
--
-- ADDITIVE + IDEMPOTENT ONLY: four columns on clubs. Three are nullable with no default, so every
-- existing club reads NULL (9 seats, oval tables, the LovePoker colours: exactly as before);
-- require_signup_photo is NOT NULL with the constant DEFAULT false (a photo stays optional), which
-- Postgres records in the catalogue without reading or rewriting a row. No constraint is added (the
-- app validates the values). Re-running is a no-op. The ALTERs take ACCESS EXCLUSIVE on clubs only,
-- for this file's transaction (catalogue changes, no rewrite); each table round 5 alters has a file of
-- its own (0010-0012), so no transaction holds one table's lock while it waits for another's
-- (P4REV3-PROD-01).
--
-- Central Stars' values (9 seats, rectangle, electric blue and gold) are filled by boot seeds that only
-- fill NULLs (server/db/seeds.ts), never by this file.
--
-- Deploy order: old code with this schema is fine (it never names these columns; its inserts leave
-- them NULL or false). New code needs them, which the boot applies before it listens.

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS default_seats_per_table integer;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS default_table_shape text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS require_signup_photo boolean NOT NULL DEFAULT false;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS theme jsonb;
