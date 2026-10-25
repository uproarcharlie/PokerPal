/**
 * The boot data seeds (./seeds) on a real migrated database: the Central Stars owner seed fills a
 * NULL owner only in the one unambiguous case, never overwrites, logs why it did nothing, and is
 * run by the boot after the migrations; the player home-club seed records the home club of players
 * registered before home clubs were stored, and never changes one.
 */
import { asc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_ACTIONS, type AuditData } from "@shared/api/admin";
import { CENTRAL_STARS_THEME, themeProblems } from "@shared/domain/theme";
import { auditLog, clubManagers, clubs, playerHomeClubs, tournamentRegistrations, users } from "@shared/schema";
import { createClub, createPlayer, createTournament, createUser } from "@test/factories";
import { resetDb, testDb } from "@test/helpers";
import { createScratchDatabase, dropScratchDatabase } from "@test/helpers/scratch-db";
import { loadEnv } from "../config/env";
import { getPool } from "../db";
import { runBootMigrations } from "./migrate";
import {
  CENTRAL_STARS_OWNER_CREATED_BEFORE,
  CENTRAL_STARS_OWNER_EMAIL,
  runBootSeeds,
  seedCentralStarsOwner,
  seedCentralStarsRakeLabel,
  seedCentralStarsTableDefaults,
  seedCentralStarsTheme,
  seedPlayerHomeClubs,
  type SeedLogger,
} from "./seeds";

beforeEach(resetDb);

const ownerOf = async (clubId: string) => (await testDb().select().from(clubs).where(eq(clubs.id, clubId)))[0].ownerId;
const seedAuditRows = () => testDb().select().from(auditLog).where(eq(auditLog.action, "seed_club_owner"));

/** The real account: it existed before the seed was written (the seed trusts no newer one, SEC-P2-04). */
const charlieAccount = (overrides: Parameters<typeof createUser>[0] = {}) =>
  createUser({
    email: CENTRAL_STARS_OWNER_EMAIL,
    createdAt: new Date("2025-06-01T00:00:00Z"),
    updatedAt: new Date("2025-06-01T00:00:00Z"),
    ...overrides,
  });

function recordingLogger(): SeedLogger & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (message) => lines.push(`info ${message}`), error: (message) => lines.push(`error ${message}`) };
}

describe("seedCentralStarsOwner", () => {
  it("makes charlie@eccuity.com the owner of the ownerless Central Stars club, audits it, and touches no other club", async () => {
    const charlie = await charlieAccount();
    const meadenOwner = await createUser();
    const centralStars = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    const meaden = await createClub({ name: "Meaden Family Poker Club", ownerId: meadenOwner.id });
    const ownerless = await createClub({ ownerId: null });

    const outcome = await seedCentralStarsOwner(getPool());

    expect(outcome).toEqual({ applied: true, detail: expect.stringContaining(centralStars.id) });
    expect(await ownerOf(centralStars.id)).toBe(charlie.id);
    expect(await ownerOf(meaden.id)).toBe(meadenOwner.id);
    expect(await ownerOf(ownerless.id)).toBeNull();
    expect(await seedAuditRows()).toEqual([
      expect.objectContaining({
        actorUserId: null,
        targetType: "club",
        targetId: centralStars.id,
        data: { previousOwnerId: null, ownerId: charlie.id, email: CENTRAL_STARS_OWNER_EMAIL },
      }),
    ]);
  });

  it("is a no-op the second time: the club already has an owner", async () => {
    const charlie = await charlieAccount();
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });

    expect((await seedCentralStarsOwner(getPool())).applied).toBe(true);
    const second = await seedCentralStarsOwner(getPool());

    expect(second).toEqual({ applied: false, reason: `club ${club.id} already has an owner` });
    expect(await ownerOf(club.id)).toBe(charlie.id);
    expect(await seedAuditRows()).toHaveLength(1);
  });

  it("finds the club by name in any case and spacing when its slug differs, and the account by email in any case", async () => {
    const charlie = await charlieAccount({ email: "Charlie@Eccuity.com" });
    const club = await createClub({ name: "  CENTRAL stars ", slug: "cs-poker", ownerId: null });

    expect((await seedCentralStarsOwner(getPool())).applied).toBe(true);
    expect(await ownerOf(club.id)).toBe(charlie.id);
  });

  it("changes nothing when no club is Central Stars", async () => {
    await charlieAccount();
    const other = await createClub({ name: "Central Stars Two", slug: "central-stars-2", ownerId: null });

    expect(await seedCentralStarsOwner(getPool())).toEqual({ applied: false, reason: "no club is Central Stars" });
    expect(await ownerOf(other.id)).toBeNull();
    expect(await seedAuditRows()).toEqual([]);
  });

  it("changes nothing when two clubs look like Central Stars", async () => {
    await charlieAccount();
    const bySlug = await createClub({ name: "CS", slug: "central-stars", ownerId: null });
    const byName = await createClub({ name: "Central Stars", slug: "central-stars-nz", ownerId: null });

    const outcome = await seedCentralStarsOwner(getPool());

    expect(outcome).toEqual({ applied: false, reason: expect.stringMatching(/^2 clubs look like Central Stars/) });
    expect(await ownerOf(bySlug.id)).toBeNull();
    expect(await ownerOf(byName.id)).toBeNull();
    expect(await seedAuditRows()).toEqual([]);
  });

  it("never overwrites an owner that is already set", async () => {
    await charlieAccount();
    const current = await createUser();
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: current.id });

    expect(await seedCentralStarsOwner(getPool())).toEqual({ applied: false, reason: `club ${club.id} already has an owner` });
    expect(await ownerOf(club.id)).toBe(current.id);
    expect(await seedAuditRows()).toEqual([]);
  });

  it("changes nothing when no account uses the email", async () => {
    await createUser({ email: "someone.else@eccuity.com" });
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });

    expect(await seedCentralStarsOwner(getPool())).toEqual({ applied: false, reason: `no account uses ${CENTRAL_STARS_OWNER_EMAIL}` });
    expect(await ownerOf(club.id)).toBeNull();
  });

  it("changes nothing when two accounts use the email (differing only in case)", async () => {
    await charlieAccount();
    await charlieAccount({ email: "CHARLIE@eccuity.com" });
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });

    expect(await seedCentralStarsOwner(getPool())).toEqual({ applied: false, reason: `2 accounts use ${CENTRAL_STARS_OWNER_EMAIL}` });
    expect(await ownerOf(club.id)).toBeNull();
    expect(await seedAuditRows()).toEqual([]);
  });
});

describe("seedCentralStarsOwner trusts only what it was written for (SEC-P2-04, P2-PROD-01)", () => {
  it("never trusts an account created after the seed was written: anyone can register an address", async () => {
    await createUser({ email: CENTRAL_STARS_OWNER_EMAIL, createdAt: new Date(Date.parse(CENTRAL_STARS_OWNER_CREATED_BEFORE) + 60_000) });
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });

    const outcome = await seedCentralStarsOwner(getPool());

    expect(outcome).toEqual({ applied: false, reason: expect.stringContaining("was created or changed after") });
    expect(await ownerOf(club.id)).toBeNull();
    expect(await seedAuditRows()).toEqual([]);
  });

  it("never trusts an old account that switched to the address later (PUT /api/auth/profile stamps updated_at), nor a deactivated one", async () => {
    const old = new Date("2025-01-01T00:00:00Z");
    const switched = await createUser({ email: "someone@example.test", createdAt: old, updatedAt: old });
    const later = new Date(Date.parse(CENTRAL_STARS_OWNER_CREATED_BEFORE) + 3_600_000);
    await testDb().update(users).set({ email: CENTRAL_STARS_OWNER_EMAIL, updatedAt: later }).where(eq(users.id, switched.id));
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });

    expect(await seedCentralStarsOwner(getPool())).toEqual({ applied: false, reason: expect.stringContaining("was created or changed after") });
    await testDb().update(users).set({ updatedAt: old, isActive: false }).where(eq(users.id, switched.id));
    expect(await seedCentralStarsOwner(getPool())).toEqual({ applied: false, reason: expect.stringContaining("deactivated") });
    expect(await ownerOf(club.id)).toBeNull();
  });

  it("runs at most once: an owner an admin later clears stays cleared at the next boot", async () => {
    await charlieAccount();
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    expect((await seedCentralStarsOwner(getPool())).applied).toBe(true);
    // An admin leaves the club without an owner (PUT /api/clubs/:id/owner { userId: null }).
    await testDb().update(clubs).set({ ownerId: null }).where(eq(clubs.id, club.id));
    await testDb().insert(auditLog).values({ action: "club.owner_set", targetType: "club", targetId: club.id, data: { ownerId: null } });

    const nextBoot = await seedCentralStarsOwner(getPool());

    expect(nextBoot).toEqual({ applied: false, reason: expect.stringContaining("was set before") });
    expect(await ownerOf(club.id)).toBeNull();
  });

  it("never fills an owner an admin set and then cleared before the first boot either", async () => {
    await charlieAccount();
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    await testDb().insert(auditLog).values({ action: "club.owner_set", targetType: "club", targetId: club.id, data: { ownerId: null } });

    expect((await seedCentralStarsOwner(getPool())).applied).toBe(false);
    expect(await ownerOf(club.id)).toBeNull();
  });

  it("removes the new owner's manager row, as setting an owner by hand does: owning implies managing", async () => {
    const charlie = await charlieAccount();
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    await testDb().insert(clubManagers).values({ clubId: club.id, userId: charlie.id });

    expect((await seedCentralStarsOwner(getPool())).applied).toBe(true);

    expect(await ownerOf(club.id)).toBe(charlie.id);
    expect(await testDb().select().from(clubManagers).where(eq(clubManagers.clubId, club.id))).toEqual([]);
  });
});

describe("seedCentralStarsRakeLabel", () => {
  const labelOf = async (clubId: string) => (await testDb().select().from(clubs).where(eq(clubs.id, clubId)))[0].rakeLabel;
  const labelAudit = () => testDb().select().from(auditLog).where(eq(auditLog.action, "seed_club_rake_label"));

  it('names the Central Stars club\'s rake "AP" when it has no label, audits it, and touches no other club', async () => {
    const centralStars = await createClub({ name: "Central Stars", slug: "central-stars", rakeLabel: null });
    const other = await createClub({ rakeLabel: null });

    const outcome = await seedCentralStarsRakeLabel(getPool());

    expect(outcome).toEqual({ applied: true, detail: `club ${centralStars.id} now calls its rake "AP"` });
    expect(await labelOf(centralStars.id)).toBe("AP");
    expect(await labelOf(other.id)).toBeNull();
    expect(await labelAudit()).toEqual([
      expect.objectContaining({ actorUserId: null, targetType: "club", targetId: centralStars.id, data: { previousRakeLabel: null, rakeLabel: "AP" } }),
    ]);
  });

  it("finds the club by name in any case and spacing when its slug differs", async () => {
    const club = await createClub({ name: "  central STARS ", slug: "cs-poker", rakeLabel: null });

    expect((await seedCentralStarsRakeLabel(getPool())).applied).toBe(true);
    expect(await labelOf(club.id)).toBe("AP");
  });

  it("is a no-op the second time: the club already has its label", async () => {
    const club = await createClub({ name: "Central Stars", slug: "central-stars", rakeLabel: null });
    expect((await seedCentralStarsRakeLabel(getPool())).applied).toBe(true);

    expect(await seedCentralStarsRakeLabel(getPool())).toEqual({ applied: false, reason: `club ${club.id} already calls its rake "AP"` });
    expect(await labelAudit()).toHaveLength(1);
  });

  it("never overwrites a label the club chose", async () => {
    const club = await createClub({ name: "Central Stars", slug: "central-stars", rakeLabel: "Admin fee" });

    expect(await seedCentralStarsRakeLabel(getPool())).toEqual({ applied: false, reason: `club ${club.id} already calls its rake "Admin fee"` });
    expect(await labelOf(club.id)).toBe("Admin fee");
    expect(await labelAudit()).toEqual([]);
  });

  it("runs at most once: a label the owner later clears stays cleared at the next boot", async () => {
    const club = await createClub({ name: "Central Stars", slug: "central-stars", rakeLabel: null });
    expect((await seedCentralStarsRakeLabel(getPool())).applied).toBe(true);
    // The owner blanks the field in club settings (PUT /api/clubs/:id stores NULL: "Rake").
    await testDb().update(clubs).set({ rakeLabel: null }).where(eq(clubs.id, club.id));

    expect(await seedCentralStarsRakeLabel(getPool())).toEqual({ applied: false, reason: expect.stringContaining("since been cleared") });
    expect(await labelOf(club.id)).toBeNull();
  });

  it("changes nothing when no club, or more than one, is Central Stars", async () => {
    expect(await seedCentralStarsRakeLabel(getPool())).toEqual({ applied: false, reason: "no club is Central Stars" });

    const first = await createClub({ name: "Central Stars", slug: "central-stars", rakeLabel: null });
    const second = await createClub({ name: "central stars", slug: "central-stars-2", rakeLabel: null });

    expect(await seedCentralStarsRakeLabel(getPool())).toEqual({ applied: false, reason: expect.stringMatching(/^2 clubs look like Central Stars/) });
    expect([await labelOf(first.id), await labelOf(second.id)]).toEqual([null, null]);
  });
});

describe("seedCentralStarsTableDefaults (round 5)", () => {
  const defaultsOf = async (clubId: string) => {
    const [club] = await testDb().select().from(clubs).where(eq(clubs.id, clubId));
    return { seats: club.defaultSeatsPerTable, shape: club.defaultTableShape };
  };
  const tablesAudit = () => testDb().select().from(auditLog).where(eq(auditLog.action, "seed_club_table_defaults"));

  it("gives Central Stars 9-seat rectangle tables, audits it, and touches no other club", async () => {
    const centralStars = await createClub({ name: "Central Stars", slug: "central-stars" });
    const other = await createClub();

    const outcome = await seedCentralStarsTableDefaults(getPool());

    expect(outcome).toEqual({ applied: true, detail: `club ${centralStars.id} now defaults to 9 seats per table and rectangle tables` });
    expect(await defaultsOf(centralStars.id)).toEqual({ seats: 9, shape: "rectangle" });
    expect(await defaultsOf(other.id)).toEqual({ seats: null, shape: null });
    const data: AuditData["seed_club_table_defaults"] = { defaultSeatsPerTable: 9, defaultTableShape: "rectangle" };
    expect(await tablesAudit()).toEqual([expect.objectContaining({ actorUserId: null, targetType: "club", targetId: centralStars.id, data })]);
  });

  it("fills only what is still NULL, and audits only that", async () => {
    const club = await createClub({ name: "Central Stars", slug: "central-stars", defaultSeatsPerTable: 10 });

    expect(await seedCentralStarsTableDefaults(getPool())).toEqual({ applied: true, detail: `club ${club.id} now defaults to rectangle tables` });
    expect(await defaultsOf(club.id)).toEqual({ seats: 10, shape: "rectangle" });
    expect((await tablesAudit())[0].data).toEqual({ defaultTableShape: "rectangle" });
  });

  it("never overwrites defaults the club chose", async () => {
    const club = await createClub({ name: "Central Stars", slug: "central-stars", defaultSeatsPerTable: 8, defaultTableShape: "oval" });

    expect(await seedCentralStarsTableDefaults(getPool())).toEqual({ applied: false, reason: `club ${club.id} already has its table defaults` });
    expect(await defaultsOf(club.id)).toEqual({ seats: 8, shape: "oval" });
    expect(await tablesAudit()).toEqual([]);
  });

  it("runs at most once: defaults the owner later clears stay cleared at the next boot", async () => {
    const club = await createClub({ name: "Central Stars", slug: "central-stars" });
    expect((await seedCentralStarsTableDefaults(getPool())).applied).toBe(true);
    await testDb().update(clubs).set({ defaultSeatsPerTable: null, defaultTableShape: null }).where(eq(clubs.id, club.id));

    expect(await seedCentralStarsTableDefaults(getPool())).toEqual({ applied: false, reason: expect.stringContaining("set by this seed before") });
    expect(await defaultsOf(club.id)).toEqual({ seats: null, shape: null });
    expect(await tablesAudit()).toHaveLength(1);
  });

  it("changes nothing when no club, or more than one, is Central Stars", async () => {
    expect(await seedCentralStarsTableDefaults(getPool())).toEqual({ applied: false, reason: "no club is Central Stars" });
    const first = await createClub({ name: "Central Stars", slug: "central-stars" });
    const second = await createClub({ name: "CENTRAL STARS", slug: "cs-two" });

    expect(await seedCentralStarsTableDefaults(getPool())).toEqual({ applied: false, reason: expect.stringMatching(/^2 clubs look like Central Stars/) });
    expect([await defaultsOf(first.id), await defaultsOf(second.id)]).toEqual([{ seats: null, shape: null }, { seats: null, shape: null }]);
  });
});

describe("seedCentralStarsTheme (round 5)", () => {
  const themeOf = async (clubId: string) => (await testDb().select().from(clubs).where(eq(clubs.id, clubId)))[0].theme;
  const themeAudit = () => testDb().select().from(auditLog).where(eq(auditLog.action, "seed_club_theme"));

  it("dresses Central Stars in its electric blue and gold, audits it, and touches no other club", async () => {
    const centralStars = await createClub({ name: "Central Stars", slug: "central-stars" });
    const other = await createClub();

    const outcome = await seedCentralStarsTheme(getPool());

    expect(outcome).toEqual({ applied: true, detail: `club ${centralStars.id} now wears the Central Stars colours (#1E7BFF and #F2C14E)` });
    const theme = await themeOf(centralStars.id);
    expect(theme).toEqual(CENTRAL_STARS_THEME);
    expect(themeProblems(theme)).toEqual([]);
    expect(await themeOf(other.id)).toBeNull();
    const data: AuditData["seed_club_theme"] = { previousTheme: null, theme: CENTRAL_STARS_THEME };
    expect(await themeAudit()).toEqual([expect.objectContaining({ actorUserId: null, targetType: "club", targetId: centralStars.id, data })]);
  });

  it("never overwrites colours the club chose", async () => {
    const own = { v: 1 as const, preset: null, colors: { primary: "#AA0000", accent: "#00AA00" } };
    const club = await createClub({ name: "Central Stars", slug: "central-stars", theme: own });

    expect(await seedCentralStarsTheme(getPool())).toEqual({ applied: false, reason: `club ${club.id} already has its colours` });
    expect(await themeOf(club.id)).toEqual(own);
    expect(await themeAudit()).toEqual([]);
  });

  it("runs at most once: a club that goes back to the LovePoker look keeps it at the next boot", async () => {
    const club = await createClub({ name: "Central Stars", slug: "central-stars" });
    expect((await seedCentralStarsTheme(getPool())).applied).toBe(true);
    await testDb().update(clubs).set({ theme: null }).where(eq(clubs.id, club.id));

    expect(await seedCentralStarsTheme(getPool())).toEqual({ applied: false, reason: expect.stringContaining("since been cleared") });
    expect(await themeOf(club.id)).toBeNull();
  });

  it("changes nothing when no club is Central Stars", async () => {
    const other = await createClub();
    expect(await seedCentralStarsTheme(getPool())).toEqual({ applied: false, reason: "no club is Central Stars" });
    expect(await themeOf(other.id)).toBeNull();
  });
});

describe("seedPlayerHomeClubs (P2REV0-01)", () => {
  /** A registration written straight to the table, as builds before home clubs did (no home club recorded). */
  async function legacyRegistration(playerId: string, clubId: string, registrationTime: string) {
    const tournament = await createTournament({ clubId });
    await testDb().insert(tournamentRegistrations).values({ tournamentId: tournament.id, playerId, registrationTime: new Date(registrationTime) });
  }
  const homes = () => testDb().select({ playerId: playerHomeClubs.playerId, clubId: playerHomeClubs.clubId }).from(playerHomeClubs).orderBy(asc(playerHomeClubs.playerId));

  it("records each registered player's first club, once, and audits how many", async () => {
    const [first, second] = [await createClub(), await createClub()];
    const regular = await createPlayer();
    const visitor = await createPlayer();
    await createPlayer(); // never registered: no home club
    await legacyRegistration(regular.id, second.id, "2026-02-01T00:00:00Z");
    await legacyRegistration(regular.id, first.id, "2026-01-01T00:00:00Z");
    await legacyRegistration(visitor.id, second.id, "2026-03-01T00:00:00Z");

    expect(await seedPlayerHomeClubs(getPool())).toEqual({ applied: true, detail: "recorded the home club of 2 players" });
    expect(await homes()).toEqual(
      [
        { playerId: regular.id, clubId: first.id },
        { playerId: visitor.id, clubId: second.id },
      ].sort((a, b) => a.playerId.localeCompare(b.playerId)),
    );
    expect(await testDb().select().from(auditLog).where(eq(auditLog.action, "seed_player_home_clubs"))).toEqual([
      expect.objectContaining({ actorUserId: null, targetType: "player", data: { recorded: 2 } }),
    ]);
  });

  it("never changes a recorded home club, even after that club's tournaments are gone", async () => {
    const [home, other] = [await createClub(), await createClub()];
    const player = await createPlayer();
    await testDb().insert(playerHomeClubs).values({ playerId: player.id, clubId: home.id });
    await legacyRegistration(player.id, other.id, "2026-01-01T00:00:00Z");

    expect(await seedPlayerHomeClubs(getPool())).toEqual({ applied: false, reason: "every registered player already has one" });
    expect(await homes()).toEqual([{ playerId: player.id, clubId: home.id }]);
  });
});

describe("runBootSeeds", () => {
  it("logs one line per seed saying what it did, or why it did nothing", async () => {
    const logger = recordingLogger();
    await runBootSeeds(getPool(), logger);

    await charlieAccount();
    await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    await runBootSeeds(getPool(), logger);

    expect(logger.lines).toEqual([
      "info Central Stars owner: unchanged; no club is Central Stars",
      "info Central Stars AP label: unchanged; no club is Central Stars",
      "info Central Stars tables: unchanged; no club is Central Stars",
      "info Central Stars colours: unchanged; no club is Central Stars",
      "info Player home clubs: unchanged; every registered player already has one",
      expect.stringMatching(/^info Central Stars owner: set; club .+ is now owned by charlie@eccuity\.com \(user .+\)$/),
      expect.stringMatching(/^info Central Stars AP label: set; club .+ now calls its rake "AP"$/),
      expect.stringMatching(/^info Central Stars tables: set; club .+ now defaults to 9 seats per table and rectangle tables$/),
      expect.stringMatching(/^info Central Stars colours: set; club .+ now wears the Central Stars colours \(#1E7BFF and #F2C14E\)$/),
      "info Player home clubs: unchanged; every registered player already has one",
    ]);
  });

  it("audits only actions in the typed audit vocabulary, each with the data it is typed with (P4REV3-SEED-01)", async () => {
    await charlieAccount();
    const centralStars = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    const tournament = await createTournament({ clubId: centralStars.id });
    const player = await createPlayer();
    await testDb().insert(tournamentRegistrations).values({ tournamentId: tournament.id, playerId: player.id });

    await runBootSeeds(getPool(), recordingLogger());

    const rows = await testDb().select().from(auditLog).orderBy(asc(auditLog.action));
    expect(rows.map((row) => row.action)).toEqual(["seed_club_owner", "seed_club_rake_label", "seed_club_table_defaults", "seed_club_theme", "seed_player_home_clubs"]);
    expect(rows.every((row) => (AUDIT_ACTIONS as readonly string[]).includes(row.action))).toBe(true);
    const label: AuditData["seed_club_rake_label"] = { previousRakeLabel: null, rakeLabel: "AP" };
    expect(rows.find((row) => row.action === "seed_club_rake_label")).toMatchObject({ actorUserId: null, targetType: "club", targetId: centralStars.id, data: label });
  });

  it("logs a failing seed and resolves, so the boot carries on", async () => {
    const logger = recordingLogger();
    const unreachable = { connect: () => Promise.reject(new Error("connection refused")) } as unknown as Pool;

    await expect(runBootSeeds(unreachable, logger)).resolves.toBeUndefined();
    expect(logger.lines).toEqual([
      "error Central Stars owner: failed, nothing changed (connection refused)",
      "error Central Stars AP label: failed, nothing changed (connection refused)",
      "error Central Stars tables: failed, nothing changed (connection refused)",
      "error Central Stars colours: failed, nothing changed (connection refused)",
      "error Player home clubs: failed, nothing changed (connection refused)",
    ]);
  });

  it("skips a seed whose tables the database does not have yet, saying which", async () => {
    const scratch = await createScratchDatabase("seeds_empty");
    try {
      const logger = recordingLogger();
      await runBootSeeds(scratch.pool, logger);

      expect(logger.lines).toEqual([
        "info Central Stars owner: unchanged; the clubs table does not exist yet (the migrations have not run)",
        "info Central Stars AP label: unchanged; the clubs table does not exist yet (the migrations have not run)",
        "info Central Stars tables: unchanged; the clubs table does not exist yet (the migrations have not run)",
        "info Central Stars colours: unchanged; the clubs table does not exist yet (the migrations have not run)",
        "info Player home clubs: unchanged; the player_home_clubs table does not exist yet (the migrations have not run)",
      ]);
    } finally {
      await dropScratchDatabase(scratch);
    }
  });

  it("skips a seed whose columns the database does not have yet (round 5's), saying which", async () => {
    const scratch = await createScratchDatabase("seeds_old_clubs");
    try {
      await scratch.pool.query("CREATE TABLE clubs (id varchar PRIMARY KEY, name text, slug text, owner_id varchar, rake_label text, default_seats_per_table integer)");
      await scratch.pool.query("CREATE TABLE audit_log (id varchar, actor_user_id varchar, action text, target_type text, target_id varchar, data jsonb)");
      const logger = recordingLogger();
      await runBootSeeds(scratch.pool, logger);

      expect(logger.lines).toEqual(
        expect.arrayContaining([
          "info Central Stars tables: unchanged; the clubs.default_table_shape column does not exist yet (the migrations have not run)",
          "info Central Stars colours: unchanged; the clubs.theme column does not exist yet (the migrations have not run)",
        ]),
      );
    } finally {
      await dropScratchDatabase(scratch);
    }
  });

  it("runs at boot with MIGRATE_ON_BOOT=false too: the seeds change only data (P2REV3-PROD-03)", async () => {
    const charlie = await charlieAccount();
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    const player = await createPlayer();
    await testDb().insert(tournamentRegistrations).values({ tournamentId: (await createTournament({ clubId: club.id })).id, playerId: player.id });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await runBootMigrations(loadEnv({ ...process.env, MIGRATE_ON_BOOT: "false" }));

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MIGRATE_ON_BOOT=false: not applying migrations/));
      expect(await ownerOf(club.id)).toBe(charlie.id);
      expect((await testDb().select().from(clubs).where(eq(clubs.id, club.id)))[0].rakeLabel).toBe("AP");
      expect(await testDb().select().from(playerHomeClubs).where(eq(playerHomeClubs.playerId, player.id))).toEqual([
        expect.objectContaining({ clubId: club.id }),
      ]);
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });

  it("runs at boot, right after the migrations", async () => {
    const charlie = await charlieAccount();
    const club = await createClub({ name: "Central Stars", slug: "central-stars", ownerId: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await runBootMigrations(loadEnv(process.env));

      expect(await ownerOf(club.id)).toBe(charlie.id);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[seed\] Central Stars owner: set; /));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[seed\] Central Stars AP label: set; /));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[seed\] Central Stars tables: set; /));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[seed\] Central Stars colours: set; /));
    } finally {
      log.mockRestore();
    }
  });
});
