-- 0007_registrations_early_bird.sql
-- Phase 4: whether a player earned the early-bird bonus stack (tournament_clocks.early_bird_stack).
-- Chips only: it never changes what anyone pays or wins.
--
-- ADDITIVE + IDEMPOTENT ONLY: one column on an existing table, NOT NULL with a constant DEFAULT false,
-- which Postgres records in the catalogue without reading or rewriting a row. Re-running is a no-op.
--
-- Its own file (it was in 0005, P4REV3-PROD-01): the ALTER takes ACCESS EXCLUSIVE on
-- tournament_registrations, and in a transaction of its own it holds no other lock while it waits, so
-- it cannot deadlock with the live app (which locks tournaments, then registrations, or the other way).
--
-- Deploy order: old code with this schema is fine (its inserts leave early_bird to its default). New
-- code needs it, which the boot applies before it listens.

ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS early_bird boolean NOT NULL DEFAULT false;
