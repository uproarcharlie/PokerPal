-- 0017_bank_transfer_tournaments.sql
-- Round 8 (bank transfer payments): whether a tournament shows its club's bank details to whoever
-- signs up for it ("Show bank transfer details after sign-up"), with the amount to pay and what to
-- put on the transfer. The app turns it on only for a club with bank details (0016); it shows nothing
-- for a club whose details were removed since.
--
-- ADDITIVE + IDEMPOTENT ONLY: one column, NOT NULL with the constant DEFAULT false, which Postgres
-- records in the catalogue without reading or rewriting a row, so every existing tournament reads
-- "off" and its sign-ups answer exactly as before. No constraint is added. Re-running is a no-op.
--
-- Its own file (round 8: 0016-0018, one table each): the ALTER takes ACCESS EXCLUSIVE on tournaments
-- only, for this file's transaction (a catalogue change, no rewrite), and holds no other table's lock
-- while it waits (P4REV3-PROD-01).
--
-- Deploy order: old code with this schema is fine (its inserts leave the column to its default, and
-- it never names it). New code needs it, which the boot applies before it listens.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS show_bank_transfer boolean NOT NULL DEFAULT false;
