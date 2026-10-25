-- 0005_tables_clock.sql
-- Phase 4: tables and seating (tournament_tables, tournament_seats) and the tournament clock
-- (tournament_clocks).
--
-- ADDITIVE + IDEMPOTENT ONLY. Three NEW tables, whose constraints and unique indexes can never meet a
-- legacy row. Nothing is dropped, renamed, retyped or constrained on an existing table. Re-running is
-- a no-op. Names match shared/schema.ts exactly.
--
-- Locks: the foreign keys take SHARE ROW EXCLUSIVE on tournaments and tournament_registrations for the
-- file's transaction; no existing table is altered here, so nothing holds ACCESS EXCLUSIVE meanwhile.
-- The early-bird column, which does, is its own file (0007) so it takes that lock alone and for one
-- statement only (P4REV3-PROD-01). A conflict with the live app's locks is retried by the runner.
--
-- Deploy order: old code with this schema is fine (it never names these tables). New code needs this
-- schema, which the boot applies before it listens.

-- The physical tables put out for one tournament. A table that has seated someone is never deleted:
-- it is archived (status 'broken', broken_at), so its seat history survives and its number stays taken.
-- (id, tournament_id) is unique so tournament_seats can reference both: a seat can never point at
-- another tournament's table.
CREATE TABLE IF NOT EXISTS tournament_tables (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id varchar NOT NULL CONSTRAINT fk_tournament_tables_tournament REFERENCES tournaments (id) ON DELETE CASCADE,
  table_number integer NOT NULL,
  name text,
  seat_count integer NOT NULL DEFAULT 9,
  status text NOT NULL DEFAULT 'active',
  broken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tournament_tables_number UNIQUE (tournament_id, table_number),
  CONSTRAINT uq_tournament_tables_id_tournament UNIQUE (id, tournament_id),
  CONSTRAINT ck_tournament_tables_seat_count CHECK (seat_count BETWEEN 2 AND 10),
  CONSTRAINT ck_tournament_tables_number CHECK (table_number BETWEEN 1 AND 999),
  CONSTRAINT ck_tournament_tables_status CHECK (status IN ('active', 'broken')),
  CONSTRAINT ck_tournament_tables_broken_at CHECK ((status = 'broken') = (broken_at IS NOT NULL))
);

-- One row per seat assignment. A player leaving a seat (bust, move, swap, balance, broken table,
-- redraw, final table, unseat) releases the row (released_at + release_reason) instead of deleting it,
-- which keeps the history that restores a player to their old seat after an undone bust. The partial
-- unique indexes below let a seat, and a registration, hold at most one ACTIVE row.
CREATE TABLE IF NOT EXISTS tournament_seats (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id varchar NOT NULL CONSTRAINT fk_tournament_seats_tournament REFERENCES tournaments (id) ON DELETE CASCADE,
  table_id varchar NOT NULL,
  registration_id varchar NOT NULL CONSTRAINT fk_tournament_seats_registration REFERENCES tournament_registrations (id) ON DELETE CASCADE,
  seat_number integer NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by varchar,
  released_at timestamptz,
  release_reason text,
  CONSTRAINT fk_tournament_seats_table FOREIGN KEY (table_id, tournament_id)
    REFERENCES tournament_tables (id, tournament_id) ON DELETE CASCADE,
  CONSTRAINT ck_tournament_seats_seat_number CHECK (seat_number BETWEEN 1 AND 10),
  CONSTRAINT ck_tournament_seats_release_pair CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  CONSTRAINT ck_tournament_seats_release_reason CHECK (
    release_reason IS NULL
    OR release_reason IN ('eliminated', 'moved', 'swapped', 'balanced', 'table_broken', 'redraw', 'final_table', 'unseated')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_seats_active_seat
  ON tournament_seats (table_id, seat_number) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_seats_active_registration
  ON tournament_seats (registration_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_seats_tournament_id ON tournament_seats (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_seats_table_id ON tournament_seats (table_id, tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_seats_registration_id ON tournament_seats (registration_id);

-- One clock per tournament. The server keeps anchors only, never a ticking counter: the status, the
-- level the clock last stood at, when the running period ends (running) or how much of it is left
-- (idle, paused). Every screen derives the live level and countdown from them with
-- shared/domain/clock (auto-advance through levels and breaks needs no background job). `version`
-- is the compare-and-set token every write checks; undo_state holds the state before the last manual
-- action (one-level undo). levels is the blind structure (shared/domain/clock BlindLevel[]).
CREATE TABLE IF NOT EXISTS tournament_clocks (
  tournament_id varchar PRIMARY KEY CONSTRAINT fk_tournament_clocks_tournament REFERENCES tournaments (id) ON DELETE CASCADE,
  levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  ante_mode text NOT NULL DEFAULT 'none',
  preset_key text,
  starting_stack integer,
  rebuy_stack integer,
  addon_stack integer,
  early_bird_stack integer,
  display_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'idle',
  current_level_index integer NOT NULL DEFAULT 0,
  period_ends_at timestamptz,
  paused_remaining_ms integer,
  started_at timestamptz,
  undo_state jsonb,
  version integer NOT NULL DEFAULT 0,
  updated_by varchar,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tournament_clocks_status CHECK (status IN ('idle', 'running', 'paused', 'finished')),
  CONSTRAINT ck_tournament_clocks_ante_mode CHECK (ante_mode IN ('none', 'bb_ante', 'everyone')),
  CONSTRAINT ck_tournament_clocks_running_has_end CHECK ((status = 'running') = (period_ends_at IS NOT NULL)),
  CONSTRAINT ck_tournament_clocks_level_index CHECK (current_level_index >= 0),
  CONSTRAINT ck_tournament_clocks_remaining CHECK (paused_remaining_ms IS NULL OR paused_remaining_ms >= 0),
  CONSTRAINT ck_tournament_clocks_stacks CHECK (
    coalesce(starting_stack, 0) >= 0 AND coalesce(rebuy_stack, 0) >= 0
    AND coalesce(addon_stack, 0) >= 0 AND coalesce(early_bird_stack, 0) >= 0
  ),
  CONSTRAINT ck_tournament_clocks_levels_array CHECK (jsonb_typeof(levels) = 'array'),
  CONSTRAINT ck_tournament_clocks_display_object CHECK (jsonb_typeof(display_settings) = 'object'),
  CONSTRAINT ck_tournament_clocks_version CHECK (version >= 0)
);
