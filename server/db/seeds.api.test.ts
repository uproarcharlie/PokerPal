/**
 * The boot data seeds (./seeds) on a real migrated database: the Central Stars owner seed fills a
 * NULL owner only in the one unambiguous case, never overwrites, logs why it did nothing, and is
 * run by the boot after the migrations; the player home-club seed records the home club of players
 * registered before home clubs were stored, and never changes one.
 */
import { asc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
      "info Player home clubs: unchanged; every registered player already has one",
      expect.stringMatching(/^info Central Stars owner: set; club .+ is now owned by charlie@eccuity\.com \(user .+\)$/),
      "info Player home clubs: unchanged; every registered player already has one",
    ]);
  });

  it("logs a failing seed and resolves, so the boot carries on", async () => {
    const logger = recordingLogger();
    const unreachable = { connect: () => Promise.reject(new Error("connection refused")) } as unknown as Pool;

    await expect(runBootSeeds(unreachable, logger)).resolves.toBeUndefined();
    expect(logger.lines).toEqual([
      "error Central Stars owner: failed, nothing changed (connection refused)",
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
        "info Player home clubs: unchanged; the player_home_clubs table does not exist yet (the migrations have not run)",
      ]);
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
    } finally {
      log.mockRestore();
    }
  });
});
