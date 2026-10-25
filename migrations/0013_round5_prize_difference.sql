-- 0013_round5_prize_difference.sql
-- Round 5 (item 16): where a difference between the prizes as set (a manual prize pool, or custom
-- places with fixed amounts) and the money available for prizes goes, per tournament: 'club' (the
-- club keeps it), 'first' (added to 1st), 'pro_rata' (shared across the paid places) or 'carry'
-- (carried over to the season's next tournament); shared/domain/prize-difference. And the money
-- carried over into the tournament's pool from earlier tournaments: a JSON list of
-- { carryOverId, fromTournamentId, fromName, amountCents }, kept in step with prize_carry_overs
-- (0014) by the carry-over service in one transaction.
--
-- ADDITIVE + IDEMPOTENT ONLY: two nullable columns on tournaments, no default, so every existing
-- tournament reads NULL: the club keeps any difference (what a prize pool set below what came in has
-- always done) and nothing is carried in, so every existing pool and payout is exactly as before. No
-- constraint is added (the app validates the choice and reads anything else as 'club'). Re-running is
-- a no-op. The ALTERs take ACCESS EXCLUSIVE on tournaments only, for this file's transaction
-- (catalogue changes, no rewrite).
--
-- Behaviour the owner will notice: none until a TD picks where a difference goes; fixed prizes above
-- the money available are now paid as set, the club adding the rest (they paid Standard before).
--
-- Deploy order: old code with this schema is fine (it never names these columns). New code needs them,
-- which the boot applies before it listens.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_difference text;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS carried_in jsonb;
