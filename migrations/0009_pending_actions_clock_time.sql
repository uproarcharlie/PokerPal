-- 0009_pending_actions_clock_time.sql
-- Phase 4 review (P4REV1-R2-01): the tournament clock's time when a player asked for a re-buy, add-on
-- or knockout (ms since level 1 began, breaks included), so a request asked for within the re-buy
-- period is never logged as "after the re-buy period" because the TD paused or moved the clock before
-- confirming it. The request desk also shows a request asked for after the period as late.
--
-- ADDITIVE + IDEMPOTENT ONLY: one nullable column on pending_actions, no default, so every existing
-- row reads NULL (time not known: such a request is never called late). Re-running is a no-op. The
-- ALTER takes ACCESS EXCLUSIVE on pending_actions only, for this file's transaction (a catalogue
-- change, no rewrite).
--
-- Deploy order: old code with this schema is fine (its inserts leave the column NULL). New code needs
-- it, which the boot applies before it listens.

ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS clock_elapsed_ms integer;
