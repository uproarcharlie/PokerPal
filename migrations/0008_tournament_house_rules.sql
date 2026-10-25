-- 0008_tournament_house_rules.sql
-- Phase 4 review (TDN3-HOUSE-RULES): a club's format can now say how many add-ons a player may take,
-- and that a player takes re-buys or add-ons but not both (Central Stars' "One Life Line": one $25
-- re-buy OR one $25 add-on). The desk, the player's phone and every count change then refuse what the
-- format does not allow, as they already do past max_rebuys.
--
-- ADDITIVE + IDEMPOTENT ONLY: two nullable columns on tournaments, no default, so every existing row
-- reads NULL: no add-on limit and both allowed, exactly as before. Re-running is a no-op. The ALTERs
-- take ACCESS EXCLUSIVE on tournaments only, for this file's transaction (catalogue changes, no rewrite).
--
-- Deploy order: old code with this schema is fine (it never names these columns). New code needs it,
-- which the boot applies before it listens.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_addons integer;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rebuy_or_addon boolean;
