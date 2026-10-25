-- 0006_clock_key.sql
-- Phase 4 review (P4SEC-TV-FULL-SESSION): a venue TV runs the tournament clock with a clock key, not
-- a staff sign-in. A signed-in TV carried every staff power for a week (registrations, payouts, AP;
-- for an owner, deleting tournaments and changing staff) on a screen anyone can walk up to. The TD
-- issues a key for one tournament from the Clock tab and opens the TV's link that carries it; the key
-- lets that screen run that tournament's clock and nothing else. Only its sha256 is stored, with who
-- issued it: the key works for 24 hours, and only while that account is active and may still manage
-- the club (P4REV3-SEC-01). Issuing a new key, revoking it, removing the clock, and cancelling or
-- finalizing the tournament all end it.
--
-- ADDITIVE + IDEMPOTENT ONLY: three nullable columns on tournament_clocks (new in 0005). No existing
-- row changes (all start NULL: no key in force). Re-running is a no-op.
--
-- Deploy order: old code with this schema is fine (it never names these columns). New code needs it,
-- which the boot applies before it listens.

ALTER TABLE tournament_clocks ADD COLUMN IF NOT EXISTS control_key_hash text;
ALTER TABLE tournament_clocks ADD COLUMN IF NOT EXISTS control_key_issued_at timestamptz;
ALTER TABLE tournament_clocks ADD COLUMN IF NOT EXISTS control_key_issued_by varchar;
