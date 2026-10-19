/**
 * The database queries behind authorization (createDbAuthzStore), on a real migrated database:
 * owner and manager roles, the clubs a user manages, and which club each kind of resource belongs to.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { clubManagers, clubs, pendingActions, tournaments } from "@shared/schema";
import {
  createClub,
  createPlayer,
  createPointsSystem,
  createRegistration,
  createSeason,
  createTournament,
  createUser,
} from "@test/factories";
import { resetDb, testDb, UNKNOWN_ID } from "@test/helpers";
import { createDbAuthzStore } from "./authz";

const store = () => createDbAuthzStore(testDb());

beforeEach(resetDb);

describe("createDbAuthzStore", () => {
  it("findActiveUser: the user's id, email, name and role; null when deactivated, unset or missing", async () => {
    const active = await createUser({ role: "admin" });
    const disabled = await createUser({ isActive: false });
    const unset = await createUser({ isActive: null });

    expect(await store().findActiveUser(active.id)).toEqual({
      id: active.id,
      email: active.email,
      name: active.name,
      role: "admin",
    });
    expect(await store().findActiveUser(disabled.id)).toBeNull();
    expect(await store().findActiveUser(unset.id)).toBeNull();
    expect(await store().findActiveUser(UNKNOWN_ID)).toBeNull();
  });

  it("clubRole: owner, manager or nothing; nothing for a club that does not exist", async () => {
    const owner = await createUser();
    const manager = await createUser();
    const stranger = await createUser();
    const club = await createClub({ ownerId: owner.id });
    await testDb().insert(clubManagers).values({ clubId: club.id, userId: manager.id, createdBy: owner.id });

    expect(await store().clubRole(owner.id, club.id)).toBe("owner");
    expect(await store().clubRole(manager.id, club.id)).toBe("manager");
    expect(await store().clubRole(stranger.id, club.id)).toBeNull();
    expect(await store().clubRole(owner.id, UNKNOWN_ID)).toBeNull();
  });

  it("clubRole: a club with no owner (like Central Stars on production) is managed only by its managers", async () => {
    const manager = await createUser();
    const club = await createClub({ ownerId: null });
    await testDb().insert(clubManagers).values({ clubId: club.id, userId: manager.id });

    expect(await store().clubRole(manager.id, club.id)).toBe("manager");
    expect(await store().clubRole(UNKNOWN_ID, club.id)).toBeNull();
  });

  it("managedClubIds: owned and managed clubs, each once", async () => {
    const user = await createUser();
    const owned = await createClub({ ownerId: user.id });
    const managed = await createClub();
    const both = await createClub({ ownerId: user.id });
    await createClub();
    await testDb().insert(clubManagers).values([
      { clubId: managed.id, userId: user.id },
      { clubId: both.id, userId: user.id },
    ]);

    expect((await store().managedClubIds(user.id)).sort()).toEqual([owned.id, managed.id, both.id].sort());
    expect(await store().managedClubIds(UNKNOWN_ID)).toEqual([]);
  });

  it("clubIdOf: the club behind every kind of resource, or null when it does not exist", async () => {
    const club = await createClub();
    const season = await createSeason({ clubId: club.id });
    const pointsSystem = await createPointsSystem({ seasonId: season.id });
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id });
    const player = await createPlayer();
    const registration = await createRegistration({ tournamentId: tournament.id, playerId: player.id });
    const [action] = await testDb()
      .insert(pendingActions)
      .values({ tournamentId: tournament.id, playerId: player.id, actionType: "rebuy" })
      .returning();

    const kinds = [
      ["club", club.id],
      ["season", season.id],
      ["pointsSystem", pointsSystem.id],
      ["tournament", tournament.id],
      ["registration", registration.id],
      ["pendingAction", action.id],
    ] as const;
    for (const [kind, id] of kinds) {
      expect(await store().clubIdOf(kind, id)).toBe(club.id);
      expect(await store().clubIdOf(kind, UNKNOWN_ID)).toBeNull();
    }
  });

  it("playerHomeClub: the club the player's first registration recorded, whatever came later; null home for a new player; null for none", async () => {
    const player = await createPlayer();
    const newcomer = await createPlayer();
    const clubA = await createClub();
    const clubB = await createClub();
    for (const club of [clubA, clubB, clubA]) {
      await createRegistration({ tournamentId: (await createTournament({ clubId: club.id })).id, playerId: player.id });
    }

    expect(await store().playerHomeClub(player.id)).toEqual({ homeClubId: clubA.id });
    expect(await store().playerHomeClub(newcomer.id)).toEqual({ homeClubId: null });
    expect(await store().playerHomeClub(UNKNOWN_ID)).toBeNull();
  });

  it("playerHomeClub: deleting the home club's tournaments, or the club, never moves the home to the next club (P2REV0-01)", async () => {
    const player = await createPlayer();
    const home = await createClub();
    const next = await createClub();
    const first = await createTournament({ clubId: home.id });
    await createRegistration({ tournamentId: first.id, playerId: player.id });
    await createRegistration({ tournamentId: (await createTournament({ clubId: next.id })).id, playerId: player.id });

    await testDb().delete(tournaments).where(eq(tournaments.id, first.id));
    expect(await store().playerHomeClub(player.id)).toEqual({ homeClubId: home.id });
    await testDb().delete(clubs).where(eq(clubs.id, home.id));
    expect(await store().playerHomeClub(player.id)).toEqual({ homeClubId: home.id });
  });
});
