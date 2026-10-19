/**
 * The test harness itself: factories write rows the real API reads back,
 * loginAs signs in through the real auth endpoints, resetDb empties the
 * worker database between tests, and a run holds its database name.
 */
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, inject, it } from "vitest";
import { clubs, playerHomeClubs, tournamentRegistrations, users } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, createTournamentScenario, createUser } from "../factories";
import { loginAs, resetDb, testDb } from "../helpers";
import { assertSafeTestDbUrl } from "../setup/db-guard";
import { claimTestDatabaseName, TestRunConflictError } from "../setup/run-lock";

beforeEach(resetDb);

describe("createTournamentScenario", () => {
  it("builds a tournament the API serves back, with rebuys, add-ons, payments and knockouts", async () => {
    const scenario = await createTournamentScenario({
      players: 4,
      buyIn: "25.00",
      rake: { type: "percentage", amount: "10.00" },
      rebuys: { 0: 2 },
      addons: { 1: 1 },
      paid: [0, 1, 2],
      eliminations: [3, { player: 2, by: 0 }],
    });

    // As the club's admin: only staff are told who has paid.
    const { agent } = await loginAs("admin");
    const response = await agent.get(`/api/tournaments/${scenario.tournament.id}/registrations`);

    expect(response.status).toBe(200);
    const byPlayer = new Map(
      (response.body as Array<Record<string, unknown> & { playerId: string }>).map((row) => [row.playerId, row]),
    );
    const [first, second, third, fourth] = scenario.players.map((player) => byPlayer.get(player.id));
    expect(scenario.tournament).toMatchObject({ buyInAmount: "25.00", rebuyAmount: "25.00", rakeType: "percentage", rakeAmount: "10.00" });
    expect(first).toMatchObject({ rebuys: 2, knockouts: 1, paymentConfirmed: true, isEliminated: false });
    expect(second).toMatchObject({ addons: 1, paymentConfirmed: true });
    expect(third).toMatchObject({ isEliminated: true, eliminatedBy: scenario.players[0].id, paymentConfirmed: true });
    expect(fourth).toMatchObject({ isEliminated: true, eliminatedBy: null, paymentConfirmed: false });
    expect(Date.parse(String(fourth?.eliminationTime))).toBeLessThan(Date.parse(String(third?.eliminationTime)));
  });

  it("rejects player indexes that do not exist, before writing anything", async () => {
    await expect(createTournamentScenario({ players: 2, eliminations: [{ player: 0, by: 5 }] })).rejects.toThrow(RangeError);

    const [{ clubCount }] = await testDb().select({ clubCount: count() }).from(clubs);
    expect(clubCount).toBe(0);
  });
});

describe("createRegistration", () => {
  it("records the home club by the app's own rule: the club of the player's first surviving registration (P2REV4-CQ2-07)", async () => {
    const first = await createClub();
    const later = await createClub();
    const earlier = await createTournament({ clubId: first.id });
    const now = await createTournament({ clubId: later.id });
    const player = await createPlayer();
    // A registration an older build wrote, with no home club recorded for it.
    await testDb()
      .insert(tournamentRegistrations)
      .values({ tournamentId: earlier.id, playerId: player.id, registrationTime: new Date("2026-01-01T19:00:00Z") });

    await createRegistration({ tournamentId: now.id, playerId: player.id });

    expect(await testDb().select({ clubId: playerHomeClubs.clubId }).from(playerHomeClubs).where(eq(playerHomeClubs.playerId, player.id))).toEqual([
      { clubId: first.id },
    ]);
  });
});

describe("loginAs", () => {
  it("signs in an admin who passes the admin checks", async () => {
    const { agent, user } = await loginAs("admin");

    expect(user.role).toBe("admin");
    expect((await agent.get("/api/auth/me")).body.user).toMatchObject({ id: user.id, role: "admin" });
    expect((await agent.get("/api/admin/users")).status).toBe(200);
  });

  it("signs in a full member who is refused admin routes", async () => {
    const { agent, user } = await loginAs("full_member");

    expect(user.role).toBe("full_member");
    expect((await agent.get("/api/admin/users")).status).toBe(403);
  });

  it("signs in an existing factory user with the factory password", async () => {
    const created = await createUser({ name: "Factory Person" });

    const { agent, user } = await loginAs({ email: created.email });

    expect(user).toEqual({ id: created.id, email: created.email, name: "Factory Person", role: "full_member" });
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  it("fails loudly when the credentials are wrong", async () => {
    const created = await createUser();

    await expect(loginAs({ email: created.email, password: "Wrong-Pass1" })).rejects.toThrow(/returned 401/);
  });
});

describe("resetDb", () => {
  it("empties the app tables and keeps the migration ledger", async () => {
    await createTournamentScenario({ players: 2 });
    await createUser();

    await resetDb();

    const db = testDb();
    const [{ registrations }] = await db.select({ registrations: count() }).from(tournamentRegistrations);
    const [{ userCount }] = await db.select({ userCount: count() }).from(users);
    const ledger = await db.execute<{ name: string }>("SELECT name FROM _app_migrations ORDER BY name");
    expect({ registrations, userCount }).toEqual({ registrations: 0, userCount: 0 });
    expect(ledger.rows.map((row) => row.name)).toContain("0000_baseline");
  });
});

describe("claimTestDatabaseName", () => {
  const base = () => assertSafeTestDbUrl(inject("testDatabase").url, process.env);

  it("is held by this run for its database name, so a second run with the same name stops at once", async () => {
    const target = base();

    const second = claimTestDatabaseName(target, target.database);

    await expect(second).rejects.toBeInstanceOf(TestRunConflictError);
    await expect(second).rejects.toThrow(
      new RegExp(`^Another test run is using ${target.database}, held by pid \\d+ \\(pokerpal test run: ${target.database}, started \\d+s ago\\)\\. .*TEST_DB_NAME`),
    );
  });

  it("can be taken by one run at a time and is free again once released", async () => {
    const target = base();
    const name = `${target.database}_claim`;

    const first = await claimTestDatabaseName(target, name);
    try {
      await expect(claimTestDatabaseName(target, name)).rejects.toBeInstanceOf(TestRunConflictError);
    } finally {
      await first.release();
    }
    const again = await claimTestDatabaseName(target, name);
    await again.release();
  });
});
