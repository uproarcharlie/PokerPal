import type { Pool, PoolClient } from "pg";

/**
 * Boot-time data seeds, run by every boot (runBootMigrations: after the migrations, or on their own
 * with MIGRATE_ON_BOOT=false) and by `npm run db:migrate`. A seed only ever fills a value that is
 * still NULL and never overwrites one, so every run can repeat it. Each seed decides in one
 * transaction, logs one line saying what it did or why it did nothing, and records what it changed in
 * audit_log; one whose tables do not exist yet (a database the migrations have not reached) is skipped.
 * A seed that fails is logged and the boot carries on: seeds fill gaps in data, and the app works
 * without them.
 */

export interface SeedLogger {
  info(message: string): void;
  error(message: string): void;
}

export type SeedOutcome = { applied: true; detail: string } | { applied: false; reason: string };

/** The account that owns the Central Stars club, as its owner asked. */
export const CENTRAL_STARS_OWNER_EMAIL = "charlie@eccuity.com";
/**
 * Only an account that already had this address before the seed was written is trusted (SEC-P2-04):
 * created, and last changed, before this instant. Nothing verifies email addresses, and this one is in
 * the source, so anyone registering it (or switching an account to it) later gets nothing from the
 * seed. An admin can still set the owner. users.created_at and updated_at are naive UTC times.
 */
export const CENTRAL_STARS_OWNER_CREATED_BEFORE = "2026-10-19T00:00:00Z";
export const CENTRAL_STARS_SLUG = "central-stars";
const CENTRAL_STARS_NAME = "central stars";

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Makes the account charlie@eccuity.com the owner of the Central Stars club (production has none),
 * but only when exactly one club is Central Stars (slug `central-stars`, or that name in any case),
 * that club has no owner and never had one set (no `seed_club_owner` or `club.owner_set` audit row: so
 * the seed runs at most once per club, and an admin's later choice, even "no owner", is never undone),
 * and exactly one active account created before CENTRAL_STARS_OWNER_CREATED_BEFORE signs in with that
 * email (in any case). Anything else changes nothing. Like setting an owner by hand, it removes that
 * account's manager row, since owning implies managing. The club row is locked first, so two boots
 * at once cannot both write.
 */
export async function seedCentralStarsOwner(pool: Pool): Promise<SeedOutcome> {
  return inTransaction(pool, async (client) => {
    const clubs = await client.query<{ id: string; owner_id: string | null }>(
      `SELECT id, owner_id FROM clubs
        WHERE slug = $1 OR lower(trim(name)) = $2
        ORDER BY id
          FOR UPDATE`,
      [CENTRAL_STARS_SLUG, CENTRAL_STARS_NAME],
    );
    if (clubs.rows.length === 0) return { applied: false, reason: "no club is Central Stars" };
    if (clubs.rows.length > 1) {
      return { applied: false, reason: `${clubs.rows.length} clubs look like Central Stars (${clubs.rows.map((c) => c.id).join(", ")})` };
    }
    const [club] = clubs.rows;
    if (club.owner_id !== null) return { applied: false, reason: `club ${club.id} already has an owner` };
    const history = await client.query(
      `SELECT 1 FROM audit_log
        WHERE target_type = 'club' AND target_id = $1 AND action IN ('seed_club_owner', 'club.owner_set')
        LIMIT 1`,
      [club.id],
    );
    if (history.rows.length > 0) {
      return { applied: false, reason: `club ${club.id}'s owner was set before (by this seed or an admin), so it is left as it is` };
    }

    const users = await client.query<{ id: string; is_active: boolean | null; trusted: boolean }>(
      `SELECT id, is_active,
              coalesce(created_at, '-infinity') < $2 AND coalesce(updated_at, '-infinity') < $2 AS trusted
         FROM users WHERE lower(email) = $1 ORDER BY id`,
      [CENTRAL_STARS_OWNER_EMAIL, CENTRAL_STARS_OWNER_CREATED_BEFORE.replace("T", " ").replace("Z", "")],
    );
    if (users.rows.length === 0) return { applied: false, reason: `no account uses ${CENTRAL_STARS_OWNER_EMAIL}` };
    if (users.rows.length > 1) return { applied: false, reason: `${users.rows.length} accounts use ${CENTRAL_STARS_OWNER_EMAIL}` };
    const [user] = users.rows;
    if (!user.trusted) {
      return {
        applied: false,
        reason: `the account using ${CENTRAL_STARS_OWNER_EMAIL} was created or changed after ${CENTRAL_STARS_OWNER_CREATED_BEFORE}, so an admin must set the owner`,
      };
    }
    if (user.is_active !== true) return { applied: false, reason: `the account using ${CENTRAL_STARS_OWNER_EMAIL} is deactivated` };

    const updated = await client.query("UPDATE clubs SET owner_id = $1 WHERE id = $2 AND owner_id IS NULL", [user.id, club.id]);
    if (updated.rowCount !== 1) return { applied: false, reason: `club ${club.id} already has an owner` };
    await client.query("DELETE FROM club_managers WHERE club_id = $1 AND user_id = $2", [club.id, user.id]);
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, data)
       VALUES (NULL, 'seed_club_owner', 'club', $1, $2)`,
      [club.id, JSON.stringify({ previousOwnerId: null, ownerId: user.id, email: CENTRAL_STARS_OWNER_EMAIL })],
    );
    return { applied: true, detail: `club ${club.id} is now owned by ${CENTRAL_STARS_OWNER_EMAIL} (user ${user.id})` };
  });
}

/**
 * Records a home club for every player who has registered somewhere but has none recorded yet: the
 * club of their first registration that still exists (registration time, then id), exactly the rule
 * the app used before home clubs were stored (P2REV0-01). From then on each player's first
 * registration records it, so this only fills players registered before player_home_clubs existed
 * (or by a build from before it, during a rollback). It inserts rows only for players with none, and
 * never changes or removes one, so every boot can run it again.
 */
export async function seedPlayerHomeClubs(pool: Pool): Promise<SeedOutcome> {
  return inTransaction(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO player_home_clubs (player_id, club_id)
       SELECT DISTINCT ON (r.player_id) r.player_id, t.club_id
         FROM tournament_registrations r
         JOIN tournaments t ON t.id = r.tournament_id
        WHERE NOT EXISTS (SELECT 1 FROM player_home_clubs h WHERE h.player_id = r.player_id)
        ORDER BY r.player_id, r.registration_time, r.id
       ON CONFLICT (player_id) DO NOTHING`,
    );
    const recorded = inserted.rowCount ?? 0;
    if (recorded === 0) return { applied: false, reason: "every registered player already has one" };
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, data)
       VALUES (NULL, 'seed_player_home_clubs', 'player', NULL, $1)`,
      [JSON.stringify({ recorded })],
    );
    return { applied: true, detail: `recorded the home club of ${recorded} player${recorded === 1 ? "" : "s"}` };
  });
}

/** Every boot seed, in order, with the name each logs under and the tables it reads or writes. */
const BOOT_SEEDS: ReadonlyArray<{ name: string; tables: readonly string[]; run: (pool: Pool) => Promise<SeedOutcome> }> = [
  { name: "Central Stars owner", tables: ["clubs", "users", "club_managers", "audit_log"], run: seedCentralStarsOwner },
  {
    name: "Player home clubs",
    tables: ["player_home_clubs", "tournament_registrations", "tournaments", "audit_log"],
    run: seedPlayerHomeClubs,
  },
];

/** The first of `tables` this database does not have yet, or undefined when it has them all. */
async function firstMissingTable(pool: Pool, tables: readonly string[]): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ name: string; present: boolean }>(
      "SELECT name, to_regclass(format('public.%I', name)) IS NOT NULL AS present FROM unnest($1::text[]) WITH ORDINALITY AS t(name, n) ORDER BY n",
      [tables],
    );
    return rows.find((row) => !row.present)?.name;
  } finally {
    client.release();
  }
}

const consoleLogger: SeedLogger = {
  info: (message) => console.log(`[seed] ${message}`),
  error: (message) => console.error(`[seed] ${message}`),
};

/** Runs every boot seed. Never rejects: a failing seed is logged and the next one runs. */
export async function runBootSeeds(pool: Pool, logger: SeedLogger = consoleLogger): Promise<void> {
  for (const seed of BOOT_SEEDS) {
    try {
      const missing = await firstMissingTable(pool, seed.tables);
      if (missing) {
        logger.info(`${seed.name}: unchanged; the ${missing} table does not exist yet (the migrations have not run)`);
        continue;
      }
      const outcome = await seed.run(pool);
      logger.info(outcome.applied ? `${seed.name}: set; ${outcome.detail}` : `${seed.name}: unchanged; ${outcome.reason}`);
    } catch (error) {
      logger.error(`${seed.name}: failed, nothing changed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
}
