-- 0019_high_hands.sql
-- Round 10: several high hands per game, and players enter the ones they want (the owner: "players
-- will only want to sign up to one of the high hands … so they pay 5 instead of 10"). Until now a
-- tournament had one high hand, in its columns (enable_high_hand, high_hand_amount,
-- high_hand_rake_type, high_hand_rake_amount, high_hand_payouts), and a registration was in it or not
-- (entering_high_hands) and had won it or not (high_hand_winner, high_hand_amount).
--
-- - tournament_high_hands: the high hands a tournament LISTS, in order (position): each its name ("First
--   half"), entry fee, AP rule (rake_type 'none' | 'percentage' of the pot | 'fixed' one flat amount,
--   as the legacy high hand's; rake_amount the percentage or the amount), number of prizes (winners,
--   1 to 20: the forms offer 1-4 and a tie adds one) and an optional note ("Before the break"). A high
--   hand taken off the list is kept, marked removed_at (only one nobody is in can be removed), so a
--   tournament that has ever listed its high hands has at least one row: that is how the app knows its
--   high hands are listed (shared/domain/high-hands listsHighHands).
-- - registration_high_hands: which listed high hands each registration entered (one row per pair).
-- - high_hand_awards: each prize awarded from a listed high hand, in cents, to a registration (once per
--   high hand), with the earlier winner whose prize it shares for a tie (split_with_registration_id)
--   and who awarded it (awarded_by: users.id as audit text, no foreign key, never sent to a client).
--
-- Every existing tournament has no row here, so it reads exactly as before: its legacy columns are
-- read as ONE high hand (id 'legacy' in the API), with today's settings, entrants and awards, and no
-- existing row is rewritten (no seed). A tournament starts listing its high hands only when staff
-- change them; the app then copies the legacy high hand's entrants and awards here in that
-- transaction, so no pot or award moves, and from then on keeps the legacy columns as a summary
-- (enable_high_hand / high_hand_amount: whether it runs any and what entering all of them costs;
-- entering_high_hands / high_hand_winner / high_hand_amount: in any, won any, and for how much in all).
--
-- ADDITIVE + IDEMPOTENT ONLY. Three NEW tables, whose constraints and unique indexes can never meet a
-- legacy row. Nothing is dropped, renamed, retyped or constrained on an existing table. Re-running is
-- a no-op. Names match shared/schema.ts exactly.
--
-- Locks: the foreign keys take SHARE ROW EXCLUSIVE on tournaments and tournament_registrations for
-- this file's transaction; no existing table is altered, so nothing holds ACCESS EXCLUSIVE meanwhile.
--
-- Deploy order: old code with this schema is fine (it never names these tables). New code needs them,
-- which the boot applies before it listens.

CREATE TABLE IF NOT EXISTS tournament_high_hands (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id varchar NOT NULL CONSTRAINT fk_tournament_high_hands_tournament REFERENCES tournaments (id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL,
  entry_fee numeric(10, 2) NOT NULL,
  rake_type text NOT NULL DEFAULT 'none',
  rake_amount numeric(10, 2) NOT NULL DEFAULT '0',
  winners integer NOT NULL DEFAULT 1,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT uq_tournament_high_hands_id_tournament UNIQUE (id, tournament_id),
  CONSTRAINT ck_tournament_high_hands_position CHECK (position >= 1),
  CONSTRAINT ck_tournament_high_hands_winners CHECK (winners BETWEEN 1 AND 20),
  CONSTRAINT ck_tournament_high_hands_rake_type CHECK (rake_type IN ('none', 'percentage', 'fixed')),
  CONSTRAINT ck_tournament_high_hands_amounts CHECK (entry_fee >= 0 AND rake_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tournament_high_hands_tournament ON tournament_high_hands (tournament_id, position);

-- (high_hand_id, tournament_id) references the high hand together with its tournament, so an entry can
-- never name another tournament's high hand; the app checks the registration is that tournament's. One
-- row per registration and high hand (uq_registration_high_hands; a surrogate id rather than a composite
-- primary key, which the schema-parity check's drizzle-kit cannot introspect).
CREATE TABLE IF NOT EXISTS registration_high_hands (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id varchar NOT NULL CONSTRAINT fk_registration_high_hands_registration REFERENCES tournament_registrations (id) ON DELETE CASCADE,
  high_hand_id varchar NOT NULL,
  tournament_id varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_registration_high_hands UNIQUE (registration_id, high_hand_id),
  CONSTRAINT fk_registration_high_hands_high_hand FOREIGN KEY (high_hand_id, tournament_id)
    REFERENCES tournament_high_hands (id, tournament_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_registration_high_hands_tournament ON registration_high_hands (tournament_id);
CREATE INDEX IF NOT EXISTS idx_registration_high_hands_high_hand ON registration_high_hands (high_hand_id, tournament_id);

-- A winner need not be in registration_high_hands at the database: the legacy high hand never checked
-- that its winners had entered it, and its awards are copied here as they are. The app refuses a new
-- award to anyone not in that high hand, and taking a winner out of it.
CREATE TABLE IF NOT EXISTS high_hand_awards (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id varchar NOT NULL,
  high_hand_id varchar NOT NULL,
  registration_id varchar NOT NULL CONSTRAINT fk_high_hand_awards_registration REFERENCES tournament_registrations (id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  split_with_registration_id varchar,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  awarded_by varchar,
  CONSTRAINT fk_high_hand_awards_high_hand FOREIGN KEY (high_hand_id, tournament_id)
    REFERENCES tournament_high_hands (id, tournament_id) ON DELETE CASCADE,
  CONSTRAINT uq_high_hand_awards_winner UNIQUE (high_hand_id, registration_id),
  CONSTRAINT ck_high_hand_awards_amount CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_high_hand_awards_tournament ON high_hand_awards (tournament_id);
CREATE INDEX IF NOT EXISTS idx_high_hand_awards_registration ON high_hand_awards (registration_id);
