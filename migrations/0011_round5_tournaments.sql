-- 0011_round5_tournaments.sql
-- Round 5: each tournament's seating settings (shared/domain/table-advisor resolveSeatingSettings):
-- seats per table (2-10), how many tables setup opens first, when the next table opens (every open
-- table has this many players), when a new registration is seated automatically
-- ('on_register' | 'once_paid' | 'off'), and the shape its tables are drawn as.
--
-- ADDITIVE + IDEMPOTENT ONLY: five nullable columns on tournaments, no default, so every existing
-- tournament reads NULL, which means its club's default (else 9 seats, oval), 2 starting tables (1 when
-- its max players fit at one table), the next table when every table is full, and new players seated
-- as they register. No constraint is added (the app validates the values). Re-running is a no-op. The
-- ALTERs take ACCESS EXCLUSIVE on tournaments only, for this file's transaction (catalogue changes, no
-- rewrite).
--
-- Behaviour the owner will notice: once a tournament has tables in play, a new registration is now
-- seated automatically (NULL reads as 'on_register', the owner's choice); the TD can switch it to
-- "once they've paid" or off per tournament.
--
-- Deploy order: old code with this schema is fine (it never names these columns). New code needs them,
-- which the boot applies before it listens.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS seats_per_table integer;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS starting_tables integer;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS open_table_at integer;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS auto_seat text;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS table_shape text;
