-- PokerPal Database Schema

-- Clubs table
CREATE TABLE IF NOT EXISTS clubs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  timezone TEXT,
  address TEXT,
  discord_url TEXT,
  twitter_url TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  website_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  image_url TEXT,
  role TEXT NOT NULL DEFAULT 'full_member',
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  image_url TEXT,
  user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seasons table
CREATE TABLE IF NOT EXISTS seasons (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  club_id VARCHAR REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Points systems table
CREATE TABLE IF NOT EXISTS points_systems (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id VARCHAR REFERENCES seasons(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  participation_points INTEGER DEFAULT 0,
  knockout_points INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Points allocations table
CREATE TABLE IF NOT EXISTS points_allocations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  points_system_id VARCHAR REFERENCES points_systems(id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL,
  position_end INTEGER,
  points INTEGER NOT NULL,
  description TEXT
);

-- Tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  club_id VARCHAR REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  season_id VARCHAR REFERENCES seasons(id) ON DELETE SET NULL,
  points_system_id VARCHAR REFERENCES points_systems(id) ON DELETE SET NULL,
  start_date_time TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  buy_in_amount DECIMAL(10, 2) NOT NULL,
  rebuy_amount DECIMAL(10, 2),
  addon_amount DECIMAL(10, 2),
  max_rebuys INTEGER,
  rebuy_period_minutes INTEGER,
  rake_type TEXT NOT NULL DEFAULT 'none',
  rake_amount DECIMAL(10, 2) DEFAULT 0,
  rebuy_rake_type TEXT DEFAULT 'none',
  rebuy_rake_amount DECIMAL(10, 2) DEFAULT 0,
  addon_rake_type TEXT DEFAULT 'none',
  addon_rake_amount DECIMAL(10, 2) DEFAULT 0,
  payout_structure TEXT NOT NULL DEFAULT 'standard',
  custom_payouts TEXT,
  enable_high_hand BOOLEAN DEFAULT FALSE,
  high_hand_amount DECIMAL(10, 2),
  high_hand_rake_type TEXT DEFAULT 'none',
  high_hand_rake_amount DECIMAL(10, 2) DEFAULT 0,
  high_hand_payouts INTEGER DEFAULT 1,
  enable_late_registration BOOLEAN DEFAULT FALSE,
  track_points BOOLEAN DEFAULT TRUE,
  min_players INTEGER DEFAULT 8,
  max_players INTEGER NOT NULL,
  prize_pool_locked BOOLEAN DEFAULT FALSE,
  prize_pool_locked_at TIMESTAMP,
  manual_prize_pool DECIMAL(10, 2),
  use_club_address BOOLEAN DEFAULT TRUE,
  address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tournament registrations table
CREATE TABLE IF NOT EXISTS tournament_registrations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id VARCHAR REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  player_id VARCHAR REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  registration_time TIMESTAMP DEFAULT NOW(),
  buy_ins INTEGER DEFAULT 1,
  rebuys INTEGER DEFAULT 0,
  addons INTEGER DEFAULT 0,
  final_position INTEGER,
  prize_amount DECIMAL(10, 2),
  points_awarded INTEGER,
  is_eliminated BOOLEAN DEFAULT FALSE,
  elimination_time TIMESTAMP,
  eliminated_by VARCHAR REFERENCES players(id) ON DELETE SET NULL,
  knockouts INTEGER DEFAULT 0,
  entering_high_hands BOOLEAN DEFAULT FALSE,
  payment_confirmed BOOLEAN DEFAULT FALSE,
  high_hand_winner BOOLEAN DEFAULT FALSE,
  high_hand_amount DECIMAL(10, 2)
);

-- Pending actions table
CREATE TABLE IF NOT EXISTS pending_actions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id VARCHAR REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  player_id VARCHAR REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  action_type TEXT NOT NULL,
  target_player_id VARCHAR REFERENCES players(id) ON DELETE CASCADE,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Activity log table
CREATE TABLE IF NOT EXISTS activity_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id VARCHAR REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  player_id VARCHAR REFERENCES players(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data TEXT,
  description TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Session table (for express-session)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
