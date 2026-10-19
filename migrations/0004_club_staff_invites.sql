-- 0004_club_staff_invites.sql
-- Phase 2 review: club staff rights are granted by invitation (SEC-P2REV-03). Nothing proves an
-- account owns the email address it signed up with, so naming an address no longer grants a role
-- to whichever account holds it: the owner (or an admin) creates an invitation, sends its secret
-- link to the person, and the role is granted only when that person opens the link signed in to the
-- account that uses the invited address. Only a hash of the link's secret is stored. An invitation
-- works once, until it expires or is revoked.
--
-- ADDITIVE + IDEMPOTENT ONLY: one new table, its unique token constraint and an index. No existing
-- table is altered.

CREATE TABLE IF NOT EXISTS club_staff_invites (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id varchar NOT NULL CONSTRAINT club_staff_invites_club_id_clubs_id_fk REFERENCES clubs (id) ON DELETE CASCADE,
  role text NOT NULL,
  email text NOT NULL,
  token_hash text NOT NULL,
  created_by varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_by varchar,
  accepted_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT uq_club_staff_invites_token_hash UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_club_staff_invites_club_id ON club_staff_invites (club_id);
