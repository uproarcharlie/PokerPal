-- 0020_tournament_bounty.sql
-- Round 11 (bounty games, the owner: "a $50 buy-in with a $100 bounty"): the bounty each buy-in pays
-- on top of the buy-in, collected by the player who knocks them out (shared/domain/bounty). It is
-- never in the prize pool or the AP; what an entry owes includes it.
--
-- ADDITIVE + IDEMPOTENT ONLY: one nullable column with no default, a catalogue-only change that reads
-- or rewrites no row, so every existing tournament reads "no bounty" and is exactly as before. No
-- constraint is added. Re-running is a no-op.
--
-- Deploy order: old code with this schema is fine (it never names the column). New code needs it,
-- which the boot applies before it listens.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bounty_amount numeric(10, 2);
