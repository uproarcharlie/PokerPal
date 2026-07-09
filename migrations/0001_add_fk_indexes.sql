-- 0001_add_fk_indexes.sql
-- Purely ADDITIVE, data-safe migration: adds indexes on foreign-key / frequently-filtered
-- columns. No data is read, modified, or dropped. Safe to run against a populated database.
--
-- DEV / small tables: run as-is (CREATE INDEX IF NOT EXISTS is instant on small tables).
-- PRODUCTION / large tables: to avoid a write-blocking SHARE lock during the build, run each
-- statement individually with CONCURRENTLY instead, e.g.:
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournament_registrations_tournament_id
--       ON tournament_registrations (tournament_id);
-- (CONCURRENTLY cannot run inside a transaction block and must be issued one statement at a time.)

CREATE INDEX IF NOT EXISTS idx_clubs_owner_id ON clubs (owner_id);

CREATE INDEX IF NOT EXISTS idx_seasons_club_id ON seasons (club_id);

CREATE INDEX IF NOT EXISTS idx_players_user_id ON players (user_id);
CREATE INDEX IF NOT EXISTS idx_players_email ON players (email);

CREATE INDEX IF NOT EXISTS idx_tournaments_club_id ON tournaments (club_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_season_id ON tournaments (season_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_points_system_id ON tournaments (points_system_id);

CREATE INDEX IF NOT EXISTS idx_tournament_registrations_tournament_id ON tournament_registrations (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_player_id ON tournament_registrations (player_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_eliminated_by ON tournament_registrations (eliminated_by);

CREATE INDEX IF NOT EXISTS idx_points_systems_season_id ON points_systems (season_id);

CREATE INDEX IF NOT EXISTS idx_points_allocations_points_system_id ON points_allocations (points_system_id);

CREATE INDEX IF NOT EXISTS idx_pending_actions_tournament_id ON pending_actions (tournament_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_player_id ON pending_actions (player_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_target_player_id ON pending_actions (target_player_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_tournament_id_timestamp ON activity_log (tournament_id, timestamp);
