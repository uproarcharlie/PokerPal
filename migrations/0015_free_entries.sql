-- 0015_free_entries.sql
-- Round 7 (item 6): free entries (freeroll tickets). Staff can give a player a free entry into a
-- tournament: the entry is ACCEPTED like a paid one (payment_confirmed stays the "accepted" flag every
-- screen and finalize already read), and free_entry says nobody paid its buy-in. Its buy-ins add
-- nothing to the prize pool unless free_entry_funded (the club pays the buy-in into the pool, in
-- full, with no AP taken); its re-buys, add-ons and high-hand entry are paid as normal.
-- - free_entry_reason: 'season_prize' | 'promo' | 'staff' | 'other' (the app validates it; NULL when
--   not a free entry);
-- - free_entry_note: the staff's optional note;
-- - free_entry_by: users.id of who gave it, audit text (no foreign key), like tournaments.finalized_by,
--   never sent to a client;
-- - free_entry_at: when it was given (or last changed).
-- Staff only: no public endpoint reads or writes these columns (QR sign-up cannot claim one).
--
-- ADDITIVE + IDEMPOTENT ONLY: six columns on an existing table. The two booleans are NOT NULL with a
-- constant DEFAULT false, which Postgres records in the catalogue without reading or rewriting a row;
-- the rest are nullable with no default. Every existing registration reads "not a free entry", so
-- every existing pool, payout and payment is exactly as before. No constraint is added. Re-running is
-- a no-op.
--
-- Its own file, like 0007: the ALTERs take ACCESS EXCLUSIVE on tournament_registrations only, and in a
-- transaction of their own they hold no other lock while they wait, so they cannot deadlock with the
-- live app (which locks tournaments, then registrations, or the other way).
--
-- Deploy order: old code with this schema is fine (its inserts leave the new columns to their
-- defaults, and it never names them). New code needs them, which the boot applies before it listens.

ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS free_entry boolean NOT NULL DEFAULT false;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS free_entry_funded boolean NOT NULL DEFAULT false;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS free_entry_reason text;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS free_entry_note text;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS free_entry_by varchar;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS free_entry_at timestamptz;
