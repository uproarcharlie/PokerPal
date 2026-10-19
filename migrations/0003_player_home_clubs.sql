-- 0003_player_home_clubs.sql
-- Phase 2 review: a player's home club, recorded once. The home club decides who sees a player's
-- contact details and may edit them. It used to be worked out from whichever registrations still
-- existed, so deleting the first club's tournament (or the club) handed the player to the next club
-- that had registered them (P2REV0-01). A row here is written once, by the player's first
-- registration (or the boot seed that fills players registered before this table existed), and never
-- changed. club_id has no foreign key on purpose: when that club is deleted the row stays, and the
-- player falls back to admins only rather than to whichever club registered them next.
--
-- ADDITIVE + IDEMPOTENT ONLY: one new table and its index. No existing table is altered.

CREATE TABLE IF NOT EXISTS player_home_clubs (
  player_id varchar PRIMARY KEY CONSTRAINT player_home_clubs_player_id_players_id_fk REFERENCES players (id) ON DELETE CASCADE,
  club_id varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_home_clubs_club_id ON player_home_clubs (club_id);
