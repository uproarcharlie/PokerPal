-- 0000_baseline.sql
-- The schema exactly as shared/schema.ts defined it when boot-time migrations were
-- introduced, plus connect-pg-simple's `session` table. Every statement is IF NOT EXISTS:
-- on the existing production and dev databases this file changes nothing, and on an empty
-- database it builds the full schema, so fresh (test) databases match production.
--
-- Constraint names match the existing databases: drizzle-kit's naming, except clubs.slug's
-- unique constraint and clubs.owner_id's foreign key, which were added by hand (Postgres's
-- default names). Tables are in foreign-key order.
--
-- Never edit this file to change the schema; add a higher-numbered migration instead.

CREATE TABLE IF NOT EXISTS users (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CONSTRAINT users_email_unique UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text,
  image_url text,
  role text NOT NULL DEFAULT 'full_member',
  is_active boolean DEFAULT true,
  last_login_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL CONSTRAINT clubs_slug_key UNIQUE,
  description text,
  image_url text,
  timezone text,
  address text,
  discord_url text,
  twitter_url text,
  facebook_url text,
  instagram_url text,
  website_url text,
  owner_id varchar CONSTRAINT clubs_owner_id_fkey REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seasons (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  club_id varchar NOT NULL CONSTRAINT seasons_club_id_clubs_id_fk REFERENCES clubs (id) ON DELETE CASCADE,
  start_date timestamp NOT NULL,
  end_date timestamp,
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  image_url text,
  user_id varchar CONSTRAINT players_user_id_users_id_fk REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS points_systems (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id varchar NOT NULL CONSTRAINT points_systems_season_id_seasons_id_fk REFERENCES seasons (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  participation_points integer DEFAULT 0,
  knockout_points integer DEFAULT 0,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournaments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  image_url text,
  club_id varchar NOT NULL CONSTRAINT tournaments_club_id_clubs_id_fk REFERENCES clubs (id) ON DELETE CASCADE,
  season_id varchar CONSTRAINT tournaments_season_id_seasons_id_fk REFERENCES seasons (id) ON DELETE SET NULL,
  points_system_id varchar CONSTRAINT tournaments_points_system_id_points_systems_id_fk REFERENCES points_systems (id) ON DELETE SET NULL,
  start_date_time timestamp NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  buy_in_amount numeric(10, 2) NOT NULL,
  rebuy_amount numeric(10, 2),
  addon_amount numeric(10, 2),
  max_rebuys integer,
  rebuy_period_minutes integer,
  rake_type text NOT NULL DEFAULT 'none',
  rake_amount numeric(10, 2) DEFAULT '0',
  rebuy_rake_type text DEFAULT 'none',
  rebuy_rake_amount numeric(10, 2) DEFAULT '0',
  addon_rake_type text DEFAULT 'none',
  addon_rake_amount numeric(10, 2) DEFAULT '0',
  payout_structure text NOT NULL DEFAULT 'standard',
  custom_payouts text,
  enable_high_hand boolean DEFAULT false,
  high_hand_amount numeric(10, 2),
  high_hand_rake_type text DEFAULT 'none',
  high_hand_rake_amount numeric(10, 2) DEFAULT '0',
  high_hand_payouts integer DEFAULT 1,
  enable_late_registration boolean DEFAULT false,
  track_points boolean DEFAULT true,
  min_players integer DEFAULT 8,
  max_players integer NOT NULL,
  prize_pool_locked boolean DEFAULT false,
  prize_pool_locked_at timestamp,
  manual_prize_pool numeric(10, 2),
  use_club_address boolean DEFAULT true,
  address text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id varchar NOT NULL CONSTRAINT tournament_registrations_tournament_id_tournaments_id_fk REFERENCES tournaments (id) ON DELETE CASCADE,
  player_id varchar NOT NULL CONSTRAINT tournament_registrations_player_id_players_id_fk REFERENCES players (id) ON DELETE CASCADE,
  registration_time timestamp DEFAULT now(),
  buy_ins integer DEFAULT 1,
  rebuys integer DEFAULT 0,
  addons integer DEFAULT 0,
  final_position integer,
  prize_amount numeric(10, 2),
  points_awarded integer,
  is_eliminated boolean DEFAULT false,
  elimination_time timestamp,
  eliminated_by varchar CONSTRAINT tournament_registrations_eliminated_by_players_id_fk REFERENCES players (id) ON DELETE SET NULL,
  knockouts integer DEFAULT 0,
  entering_high_hands boolean DEFAULT false,
  payment_confirmed boolean DEFAULT false,
  high_hand_winner boolean DEFAULT false,
  high_hand_amount numeric(10, 2)
);

CREATE TABLE IF NOT EXISTS points_allocations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  points_system_id varchar NOT NULL CONSTRAINT points_allocations_points_system_id_points_systems_id_fk REFERENCES points_systems (id) ON DELETE CASCADE,
  "position" integer NOT NULL,
  position_end integer,
  points integer NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id varchar NOT NULL CONSTRAINT pending_actions_tournament_id_tournaments_id_fk REFERENCES tournaments (id) ON DELETE CASCADE,
  player_id varchar NOT NULL CONSTRAINT pending_actions_player_id_players_id_fk REFERENCES players (id) ON DELETE CASCADE,
  action_type text NOT NULL,
  target_player_id varchar CONSTRAINT pending_actions_target_player_id_players_id_fk REFERENCES players (id) ON DELETE CASCADE,
  "timestamp" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id varchar NOT NULL CONSTRAINT activity_log_tournament_id_tournaments_id_fk REFERENCES tournaments (id) ON DELETE CASCADE,
  player_id varchar CONSTRAINT activity_log_player_id_players_id_fk REFERENCES players (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data text,
  description text NOT NULL,
  "timestamp" timestamptz DEFAULT now()
);

-- connect-pg-simple's table.sql (v10), with its primary key inlined. Its `WITH (OIDS=FALSE)`
-- is dropped: that has been the only behaviour since Postgres 12.
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Indexes declared in shared/schema.ts (the same set as 0001_add_fk_indexes.sql).
CREATE INDEX IF NOT EXISTS idx_clubs_owner_id ON clubs (owner_id);
CREATE INDEX IF NOT EXISTS idx_seasons_club_id ON seasons (club_id);
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players (user_id);
CREATE INDEX IF NOT EXISTS idx_players_email ON players (email);
CREATE INDEX IF NOT EXISTS idx_points_systems_season_id ON points_systems (season_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_club_id ON tournaments (club_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_season_id ON tournaments (season_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_points_system_id ON tournaments (points_system_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_tournament_id ON tournament_registrations (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_player_id ON tournament_registrations (player_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_eliminated_by ON tournament_registrations (eliminated_by);
CREATE INDEX IF NOT EXISTS idx_points_allocations_points_system_id ON points_allocations (points_system_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_tournament_id ON pending_actions (tournament_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_player_id ON pending_actions (player_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_target_player_id ON pending_actions (target_player_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_tournament_id_timestamp ON activity_log (tournament_id, "timestamp");
