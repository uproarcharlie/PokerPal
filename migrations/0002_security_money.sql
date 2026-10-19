-- 0002_security_money.sql
-- Phase 2: club staff (club_managers), an admin audit trail (audit_log), the club's name for its
-- rake ("AP"), and the AP override + finalize snapshot/audit columns on tournaments.
--
-- ADDITIVE + IDEMPOTENT ONLY. Existing tables get NULLABLE columns with NO default: a metadata-only
-- change, so no row is read, rewritten or modified. Everything else is CREATE ... IF NOT EXISTS on
-- NEW tables, whose constraints (including the UNIQUE pair on club_managers) cannot meet legacy rows.
-- Nothing is dropped, renamed, retyped or constrained on an existing table. Names match shared/schema.ts.

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS rake_label text;

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rake_override numeric(10, 2);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_pool_adjustment_reason text;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_pool_adjusted_at timestamptz;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_pool_adjusted_by varchar;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_pool_snapshot jsonb;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS finalized_by varchar;

-- Users who may manage a club besides its owner (clubs.owner_id). created_by is audit text, not a
-- foreign key, so the record survives whoever granted it.
CREATE TABLE IF NOT EXISTS club_managers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id varchar NOT NULL CONSTRAINT club_managers_club_id_clubs_id_fk REFERENCES clubs (id) ON DELETE CASCADE,
  user_id varchar NOT NULL CONSTRAINT club_managers_user_id_users_id_fk REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'manager',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar,
  CONSTRAINT uq_club_managers_club_user UNIQUE (club_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_club_managers_user_id ON club_managers (user_id);

-- Who did what, for staff and admin actions (impersonation, user changes, money adjustments,
-- finalize). Never shown publicly. No foreign keys: an audit row must outlive what it describes.
CREATE TABLE IF NOT EXISTS audit_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id varchar,
  action text NOT NULL,
  target_type text,
  target_id varchar,
  data jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id ON audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);
