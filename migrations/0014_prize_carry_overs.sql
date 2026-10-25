-- 0014_prize_carry_overs.sql
-- Round 5 (item 16): prize money a finalized tournament carried over ("Carry it over"), for its
-- season's next tournament (or the club's next one, with no season) to add to its pool as "carried
-- over from …". One row per source tournament: a correction of its results updates the row while no
-- tournament has taken the money yet. applied_to_tournament_id is the tournament that took it (NULL:
-- still free), whose tournaments.carried_in (0013) lists it.
--
-- ADDITIVE + IDEMPOTENT ONLY. One NEW table, whose constraints and unique index can never meet a
-- legacy row. Nothing is dropped, renamed, retyped or constrained on an existing table. Re-running is
-- a no-op. Names match shared/schema.ts exactly. applied_by / created_by are users.id as audit text
-- (no foreign key), like tournaments.finalized_by, and never leave the server.
--
-- Locks: the foreign keys take SHARE ROW EXCLUSIVE on tournaments and seasons for this file's
-- transaction; no existing table is altered here (0013 alters tournaments in a file of its own).
--
-- Deploy order: old code with this schema is fine (it never names this table). New code needs it,
-- which the boot applies before it listens.

CREATE TABLE IF NOT EXISTS prize_carry_overs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tournament_id varchar NOT NULL CONSTRAINT fk_prize_carry_overs_source REFERENCES tournaments (id) ON DELETE CASCADE,
  source_name text NOT NULL,
  target_season_id varchar CONSTRAINT fk_prize_carry_overs_season REFERENCES seasons (id) ON DELETE SET NULL,
  amount_cents integer NOT NULL,
  applied_to_tournament_id varchar CONSTRAINT fk_prize_carry_overs_applied_to REFERENCES tournaments (id) ON DELETE SET NULL,
  applied_at timestamptz,
  applied_by varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar,
  CONSTRAINT uq_prize_carry_overs_source UNIQUE (source_tournament_id),
  CONSTRAINT ck_prize_carry_overs_amount CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_prize_carry_overs_applied_to ON prize_carry_overs (applied_to_tournament_id);
CREATE INDEX IF NOT EXISTS idx_prize_carry_overs_season ON prize_carry_overs (target_season_id);
