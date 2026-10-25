/**
 * The venue TV's clock key (P4SEC-TV-FULL-SESSION): POST /api/tournaments/:id/clock/key issues one
 * (staff only, shown once, only its sha256 stored), and a screen that sends it in X-Clock-Key may run
 * that tournament's clock (POST .../clock/actions) without anyone signing in on it, and do nothing
 * else. It works for 24 hours, and only while whoever issued it may still manage the club (P4REV3-SEC-01).
 * Issuing a new key, DELETE .../clock/key, removing the clock, cancelling and finalizing end it.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClockKeyDto } from "@shared/api/clock";
import { CLOCK_KEY_HEADER, CLOCK_LIMITS } from "@shared/domain/clock";
import { activityLog, auditLog, clubManagers, tournamentClocks, users, type Tournament } from "@shared/schema";
import { createClub, createTournament, type NewTournament } from "../factories";
import { createClock, testStructure } from "../factories/clock";
import { anon, resetDb, signIn, testDb } from "../helpers";
import { signInClubRole } from "../helpers/club-staff";

beforeEach(resetDb);

/** The club owner, signed in, with an open tournament and (unless `clock` is false) its clock, idle at Level 1. */
async function setup({ tournament: overrides = {}, clock = true }: { tournament?: Partial<NewTournament>; clock?: boolean } = {}) {
  const owner = await signIn();
  const club = await createClub({ ownerId: owner.user.id });
  const tournament = await createTournament({ clubId: club.id, status: "in_progress", ...overrides });
  if (clock) await createClock({ tournamentId: tournament.id });
  return { owner, club, tournament };
}

const base = (tournament: Pick<Tournament, "id">) => `/api/tournaments/${tournament.id}`;

async function issue(agent: request.Agent, tournament: Pick<Tournament, "id">): Promise<ClockKeyDto> {
  const response = await agent.post(`${base(tournament)}/clock/key`).send({});
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as ClockKeyDto;
}

/** A screen nobody signed in on, holding `key`. */
async function tv(key: string) {
  const agent = await anon();
  return {
    display: (tournament: Pick<Tournament, "id">) => agent.get(`/api/public/tournaments/${tournament.id}/display`).set(CLOCK_KEY_HEADER, key),
    act: (tournament: Pick<Tournament, "id">, body: object) => agent.post(`${base(tournament)}/clock/actions`).set(CLOCK_KEY_HEADER, key).send(body),
    write: (method: "post" | "put" | "patch" | "delete", path: string, body: object = {}) => agent[method](path).set(CLOCK_KEY_HEADER, key).send(body),
  };
}

async function clockRow(tournament: Pick<Tournament, "id">) {
  const [row] = await testDb().select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournament.id));
  return row;
}

describe("issuing a clock key", () => {
  it("answers the key once, with the TV link that carries it, and keeps only its hash", async () => {
    const { owner, tournament } = await setup();

    const response = await owner.agent.post(`${base(tournament)}/clock/key`).send({});

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { key, issuedAt, expiresAt, path } = response.body as ClockKeyDto;
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(path).toBe(`/clock/${tournament.id}#key=${key}`);
    expect(Date.parse(expiresAt) - Date.parse(issuedAt)).toBe(CLOCK_LIMITS.keyLifetimeMs);
    const row = await clockRow(tournament);
    expect(row.controlKeyHash).toBe(createHash("sha256").update(key).digest("hex"));
    expect(row.controlKeyIssuedAt?.toISOString()).toBe(issuedAt);
    expect(row.controlKeyIssuedBy).toBe(owner.user.id);
    expect(JSON.stringify(row)).not.toContain(key);
    const audit = await testDb().select().from(auditLog).where(eq(auditLog.targetId, tournament.id));
    expect(audit.map((entry) => ({ action: entry.action, actorUserId: entry.actorUserId }))).toEqual([{ action: "clock.key_issued", actorUserId: owner.user.id }]);
    // Not in the activity feed, and the clock's own state is untouched.
    expect(await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournament.id))).toEqual([]);
    expect(row.version).toBe(0);
  });

  it("tells the club's staff when the key in force was issued and expires, and nobody else", async () => {
    const { owner, tournament } = await setup();
    const { key, issuedAt, expiresAt } = await issue(owner.agent, tournament);
    const stranger = await signIn();

    const forStaff = await owner.agent.get(`/api/public/tournaments/${tournament.id}/display`);
    const forStranger = await stranger.agent.get(`/api/public/tournaments/${tournament.id}/display`);
    const forTv = await (await tv(key)).display(tournament);

    expect(forStaff.body.viewer).toEqual({ canControl: true, clockKeyIssuedAt: issuedAt, clockKeyExpiresAt: expiresAt });
    expect(forStranger.body.viewer).toEqual({ canControl: false, clockKeyIssuedAt: null, clockKeyExpiresAt: null });
    expect(forTv.body.viewer).toEqual({ canControl: true, clockKeyIssuedAt: null, clockKeyExpiresAt: null });
  });

  it("needs a clock (404 NO_CLOCK) and an open tournament (409 TOURNAMENT_CLOSED)", async () => {
    const without = await setup({ clock: false });
    const closed = await setup({ tournament: { status: "completed" } });

    const noClock = await without.owner.agent.post(`${base(without.tournament)}/clock/key`).send({});
    const finished = await closed.owner.agent.post(`${base(closed.tournament)}/clock/key`).send({});

    expect(noClock.status).toBe(404);
    expect(noClock.body.code).toBe("NO_CLOCK");
    expect(finished.status).toBe(409);
    expect(finished.body.code).toBe("TOURNAMENT_CLOSED");
    expect((await clockRow(closed.tournament)).controlKeyHash).toBeNull();
  });
});

describe("a screen holding the key", () => {
  it("runs the clock without a sign-in, and sees the controls", async () => {
    const { owner, tournament } = await setup();
    const screen = await tv((await issue(owner.agent, tournament)).key);

    const display = await screen.display(tournament);
    const started = await screen.act(tournament, { action: "start" });
    const undone = await screen.act(tournament, { action: "undo" });

    expect(display.body).toMatchObject({ viewer: { canControl: true }, clock: { status: "idle" } });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body).toMatchObject({ clock: { status: "running", undo: { action: "start" } }, viewer: { canControl: true } });
    expect(undone.body.clock).toMatchObject({ status: "idle" });
    // Who ran it: nobody signed in.
    expect((await clockRow(tournament)).updatedBy).toBeNull();
  });

  it("can do nothing else: the clock's set-up, display, removal, early birds and seating stay staff-only", async () => {
    const { owner, tournament } = await setup();
    const screen = await tv((await issue(owner.agent, tournament)).key);
    const path = base(tournament);

    const refusals = [
      await screen.write("put", `${path}/clock`, { structure: testStructure(), baseHash: null }),
      await screen.write("patch", `${path}/clock/display`, { overlay: "seating" }),
      await screen.write("delete", `${path}/clock`),
      await screen.write("post", `${path}/clock/key`),
      await screen.write("delete", `${path}/clock/key`),
      await screen.write("post", `${path}/early-birds`, { registrationIds: [tournament.id], earlyBird: true }),
      await screen.write("post", `${path}/seating/draw`, {}),
      await screen.write("put", path, { name: "Renamed" }),
    ];

    expect(refusals.map((response) => response.status)).toEqual(Array(refusals.length).fill(401));
    expect((await clockRow(tournament)).version).toBe(0);
  });

  it("is refused for another tournament's clock, and with a wrong or malformed key", async () => {
    const { owner, club, tournament } = await setup();
    const other = await createTournament({ clubId: club.id, status: "in_progress" });
    await createClock({ tournamentId: other.id });
    const { key } = await issue(owner.agent, tournament);

    const elsewhere = await (await tv(key)).act(other, { action: "start" });
    const wrong = await (await tv(`${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`)).act(tournament, { action: "start" });
    const malformed = await (await tv("not a key")).act(tournament, { action: "start" });

    expect([elsewhere.status, wrong.status, malformed.status]).toEqual([401, 401, 401]);
    expect((await (await tv(key)).display(other)).body.viewer.canControl).toBe(false);
  });

  it("works for 24 hours after it was issued, and not a moment longer", async () => {
    const { owner, tournament } = await setup();
    const screen = await tv((await issue(owner.agent, tournament)).key);
    const issuedAgo = (ms: number) =>
      testDb()
        .update(tournamentClocks)
        .set({ controlKeyIssuedAt: new Date(Date.now() - ms) })
        .where(eq(tournamentClocks.tournamentId, tournament.id));

    await issuedAgo(CLOCK_LIMITS.keyLifetimeMs - 60_000);
    expect((await screen.act(tournament, { action: "start" })).status).toBe(200);

    await issuedAgo(CLOCK_LIMITS.keyLifetimeMs + 1_000);
    expect((await screen.act(tournament, { action: "pause" })).status).toBe(401);
    expect((await screen.display(tournament)).body.viewer.canControl).toBe(false);
    const forStaff = await owner.agent.get(`/api/public/tournaments/${tournament.id}/display`);
    expect(forStaff.body.viewer).toEqual({ canControl: true, clockKeyIssuedAt: null, clockKeyExpiresAt: null });
    expect((await clockRow(tournament)).status).toBe("running");
  });

  it("stops working once whoever issued it can no longer manage the club: removed from its staff or deactivated (P4REV3-SEC-01)", async () => {
    const { club, tournament } = await setup();
    const removed = await signInClubRole("manager", club.id);
    const deactivated = await signInClubRole("manager", club.id);
    const firstKey = (await issue(removed.agent, tournament)).key;
    const firstScreen = await tv(firstKey);
    expect((await firstScreen.act(tournament, { action: "start" })).status).toBe(200);

    await testDb().delete(clubManagers).where(and(eq(clubManagers.clubId, club.id), eq(clubManagers.userId, removed.user.id)));
    expect((await firstScreen.act(tournament, { action: "pause" })).status).toBe(401);
    expect((await firstScreen.display(tournament)).body.viewer.canControl).toBe(false);

    const secondScreen = await tv((await issue(deactivated.agent, tournament)).key);
    expect((await secondScreen.act(tournament, { action: "pause" })).status).toBe(200);
    await testDb().update(users).set({ isActive: false }).where(eq(users.id, deactivated.user.id));
    expect((await secondScreen.act(tournament, { action: "resume" })).status).toBe(401);
    expect((await clockRow(tournament)).status).toBe("paused");
  });

  it("is not in force when stored without who issued it", async () => {
    const { owner, tournament } = await setup();
    const screen = await tv((await issue(owner.agent, tournament)).key);
    await testDb().update(tournamentClocks).set({ controlKeyIssuedBy: null }).where(eq(tournamentClocks.tournamentId, tournament.id));

    expect((await screen.act(tournament, { action: "start" })).status).toBe(401);
  });
});

describe("ending a key", () => {
  it("issuing a new key ends the old one", async () => {
    const { owner, tournament } = await setup();
    const first = await issue(owner.agent, tournament);
    const second = await issue(owner.agent, tournament);

    expect((await (await tv(first.key)).act(tournament, { action: "start" })).status).toBe(401);
    expect((await (await tv(second.key)).act(tournament, { action: "start" })).status).toBe(200);
  });

  it("DELETE .../clock/key revokes it (idempotent, audited once), even once the tournament is closed", async () => {
    const { owner, tournament } = await setup();
    const { key } = await issue(owner.agent, tournament);

    const revoked = await owner.agent.delete(`${base(tournament)}/clock/key`);
    const again = await owner.agent.delete(`${base(tournament)}/clock/key`);

    expect([revoked.status, again.status]).toEqual([200, 200]);
    expect(revoked.body.viewer).toEqual({ canControl: true, clockKeyIssuedAt: null, clockKeyExpiresAt: null });
    expect((await (await tv(key)).act(tournament, { action: "start" })).status).toBe(401);
    const audit = await testDb().select().from(auditLog).where(eq(auditLog.targetId, tournament.id));
    expect(audit.map((entry) => entry.action).sort()).toEqual(["clock.key_issued", "clock.key_revoked"]);

    const closed = await setup();
    await issue(closed.owner.agent, closed.tournament);
    await closed.owner.agent.put(base(closed.tournament)).send({ status: "cancelled" });
    expect((await closed.owner.agent.delete(`${base(closed.tournament)}/clock/key`)).status).toBe(200);
    expect((await clockRow(closed.tournament)).controlKeyHash).toBeNull();
  });

  it("cancelling the tournament ends it, and reopening does not bring it back", async () => {
    const { owner, tournament } = await setup();
    const screen = await tv((await issue(owner.agent, tournament)).key);
    await owner.agent.put(base(tournament)).send({ status: "cancelled" });

    const whileCancelled = await screen.act(tournament, { action: "start" });
    await owner.agent.put(base(tournament)).send({ status: "registration" });
    const reopened = await screen.act(tournament, { action: "start" });

    expect([whileCancelled.status, reopened.status]).toEqual([401, 401]);
    expect(await clockRow(tournament)).toMatchObject({ controlKeyHash: null, controlKeyIssuedAt: null, controlKeyIssuedBy: null, status: "idle" });
  });

  it("removing the clock ends it", async () => {
    const { owner, tournament } = await setup();
    const { key } = await issue(owner.agent, tournament);

    await owner.agent.delete(`${base(tournament)}/clock`);
    await createClock({ tournamentId: tournament.id });

    expect((await (await tv(key)).act(tournament, { action: "start" })).status).toBe(401);
  });
});
