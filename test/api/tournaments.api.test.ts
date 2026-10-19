/**
 * The tournament API (server/routes/tournaments.ts): the public list and detail, and the staff's
 * create, update and delete. Writes need a manager of the tournament's club (SEC-02), deleting needs
 * its owner or an admin, a tournament never moves club (SEC-07, security-31), and nothing a request
 * sends can write the money columns that only the AP endpoints and finalize own. Finalize lives in
 * finalize.api.test.ts, the AP endpoints in prize-pool.api.test.ts.
 */
import { and, asc, eq } from "drizzle-orm";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Json } from "@shared/api/common";
import { findForbiddenKeys, PUBLIC_TOURNAMENT_FIELDS } from "@shared/api/public";
import { MAX_UPCOMING_TOURNAMENTS_PER_CLUB, type TournamentDetailDto, type TournamentListItemDto } from "@shared/api/tournaments";
import { activityLog, auditLog, tournamentRegistrations, tournaments, type Tournament } from "@shared/schema";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import type { TournamentDetail } from "../../server/services/tournament-views";
import type { listTournaments } from "../../server/services/tournaments";
import {
  buildTournament,
  createClub,
  createPlayer,
  createPointsSystem,
  createRegistration,
  createSeason,
  createTournament,
  createUser,
  FACTORY_PASSWORD,
  type NewTournament,
} from "../factories";
import { anon, asJson, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { agentFor, clubWithStaff, MANAGER_ROUTE, OWNER_ROUTE, VISITORS } from "../helpers/club-staff";

beforeEach(resetDb);

/** A tournament in a club with an owner, a manager and the other visitors of the authz matrix. */
async function staffedTournament(overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, ...overrides });
  return { staff, tournament, agent: staff.owner.agent };
}

const tournamentRow = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

/** The tournament's activity in the order it was written (every entry has its own clock_timestamp()). */
const activityFor = async (tournamentId: string) =>
  (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp)))
    .map(({ eventType, description, playerId }) => ({ eventType, description, playerId }));

const auditFor = (targetId: string) => testDb().select().from(auditLog).where(eq(auditLog.targetId, targetId));

/** The tournament as the public may see it. */
const publicView = (row: Tournament) => {
  const json = asJson(row) as Record<string, unknown>;
  return Object.fromEntries(PUBLIC_TOURNAMENT_FIELDS.map((key) => [key, json[key] ?? null]));
};

const detail = (row: Tournament, canManage: boolean, canOwn = canManage) => ({
  ...publicView(row),
  prizePoolSnapshot: row.prizePoolSnapshot ?? null,
  viewer: { canManage, canOwn },
});

const inHours = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);
const inDays = (days: number) => inHours(days * 24);

const newTournament = (clubId: string, extra: Record<string, unknown> = {}) => ({
  name: "Friday Freezeout",
  clubId,
  startDateTime: "2026-05-01T07:00:00.000Z",
  buyInAmount: 50,
  rebuyAmount: "25",
  maxPlayers: 40,
  ...extra,
});

describe("response types", () => {
  it("serialise to the shared DTOs", () => {
    type ListItem = Json<Awaited<ReturnType<typeof listTournaments>>[number]>;
    expectTypeOf<Json<TournamentDetail>>().toExtend<TournamentDetailDto>();
    expectTypeOf<TournamentDetailDto>().toExtend<Json<TournamentDetail>>();
    expectTypeOf<ListItem>().toExtend<TournamentListItemDto>();
    expectTypeOf<TournamentListItemDto>().toExtend<ListItem>();
  });
});

describe("POST /api/tournaments", () => {
  it("caps a club's upcoming tournaments, so no club can flood the home page (409 TOURNAMENT_LIMIT_REACHED, SEC-P2REV-04)", async () => {
    const { club, owner } = await clubWithStaff();
    await testDb()
      .insert(tournaments)
      .values(
        Array.from({ length: MAX_UPCOMING_TOURNAMENTS_PER_CLUB - 1 }, (_, n) =>
          buildTournament({ clubId: club.id, startDateTime: inDays(n + 1), status: n % 2 ? "registration" : "scheduled" }),
        ),
      );
    // Past, finished and cancelled games are not upcoming, so they never count.
    await createTournament({ clubId: club.id, status: "scheduled", startDateTime: inDays(-7) });
    await createTournament({ clubId: club.id, status: "completed", startDateTime: inDays(9) });
    await createTournament({ clubId: club.id, status: "cancelled", startDateTime: inDays(9) });

    const last = await owner.agent.post("/api/tournaments").send(newTournament(club.id, { startDateTime: inDays(200).toISOString() }));
    const over = await owner.agent.post("/api/tournaments").send(newTournament(club.id, { startDateTime: inDays(201).toISOString() }));

    expect(last.status).toBe(201);
    expect(over.status).toBe(409);
    expect(over.body).toEqual({
      error: `A club can have at most ${MAX_UPCOMING_TOURNAMENTS_PER_CLUB} upcoming tournaments: finish, cancel or delete some first`,
      code: "TOURNAMENT_LIMIT_REACHED",
    });
    const other = await clubWithStaff();
    expect((await other.owner.agent.post("/api/tournaments").send(newTournament(other.club.id))).status).toBe(201);
  });

  it("limits how many tournaments an account creates an hour, counting only ones created (SEC-P2REV-04)", async () => {
    const app = await createApp({
      env: loadEnv(process.env),
      sessionStore: new session.MemoryStore(),
      rateLimits: { enabled: true, limits: { tournamentCreate: 2, tournamentCreateVisitor: 3 } },
    });
    const ownerOfOwnClub = async () => {
      const user = await createUser();
      const club = await createClub({ ownerId: user.id });
      const agent = request.agent(app);
      expect((await agent.post("/api/auth/login").send({ email: user.email, password: FACTORY_PASSWORD })).status).toBe(200);
      return { agent, club };
    };
    const first = await ownerOfOwnClub();
    const create = ({ agent, club }: { agent: request.Agent; club: { id: string } }) => agent.post("/api/tournaments").send(newTournament(club.id));

    expect((await first.agent.post("/api/tournaments").send(newTournament(first.club.id, { name: "" }))).status).toBe(400);
    expect([(await create(first)).status, (await create(first)).status]).toEqual([201, 201]);
    const perAccount = await create(first);
    expect([perAccount.status, perAccount.body.code]).toEqual([429, "RATE_LIMITED"]);

    // Another account on the same address shares the address's budget.
    const second = await ownerOfOwnClub();
    expect([(await create(second)).status, (await create(second)).status]).toEqual([201, 429]);
  });

  it("creates a tournament from the form's payload, storing money as decimal strings and filling the defaults", async () => {
    const { club, owner } = await clubWithStaff();

    const response = await owner.agent.post("/api/tournaments").send(newTournament(club.id));

    expect(response.status).toBe(201);
    const row = await tournamentRow(response.body.id);
    expect(response.body).toEqual(detail(row, true));
    expect(row).toMatchObject({
      name: "Friday Freezeout",
      clubId: club.id,
      status: "scheduled",
      buyInAmount: "50.00",
      rebuyAmount: "25.00",
      rakeType: "none",
      rakeAmount: "0.00",
      rebuyRakeType: "none",
      payoutStructure: "standard",
      trackPoints: true,
      prizePoolLocked: false,
      maxPlayers: 40,
    });
    expect(response.body).not.toHaveProperty("finalizedBy");
    expect(response.body).not.toHaveProperty("prizePoolAdjustedBy");
  });

  it.each(VISITORS)("answers a %s as the authorization rules say", async (visitor) => {
    const staff = await clubWithStaff();
    const agent = await agentFor(visitor, staff);

    const response = await agent.post("/api/tournaments").send(newTournament(staff.club.id));

    const expected = MANAGER_ROUTE[visitor] === 200 ? 201 : MANAGER_ROUTE[visitor];
    expect(response.status).toBe(expected);
    expect(await testDb().select().from(tournaments)).toHaveLength(expected === 201 ? 1 : 0);
  });

  it("checks the AP rates with the same rule as every later change, so a rate it accepts can be changed later (P2REV4-CQ-01)", async () => {
    const { club, owner } = await clubWithStaff();
    const create = (extra: Record<string, unknown>) => owner.agent.post("/api/tournaments").send(newTournament(club.id, extra));

    const over = await create({ rakeType: "percentage", rakeAmount: 150 });
    const blank = await create({ rakeType: "percentage", rakeAmount: "" });
    const typeOnly = await create({ rebuyRakeType: "fixed" });
    expect([over.body, blank.body, typeOnly.body]).toEqual([
      { error: "A percentage cannot be over 100", code: "PERCENT_OVER_100", details: { field: "rakeAmount" } },
      { error: "Enter an amount for that rate", code: "AMOUNT_REQUIRED", details: { field: "rakeAmount" } },
      { error: "Enter an amount for that rate", code: "AMOUNT_REQUIRED", details: { field: "rebuyRakeAmount" } },
    ]);
    expect(await testDb().select().from(tournaments)).toEqual([]);

    // A rate of "none" stores 0.00, and changing one rate later never trips over another.
    const created = await create({ rakeType: "percentage", rakeAmount: "10", rebuyRakeType: "none", rebuyRakeAmount: "5" });
    expect(created.status).toBe(201);
    expect(await tournamentRow(created.body.id)).toMatchObject({ rakeAmount: "10.00", rebuyRakeType: "none", rebuyRakeAmount: "0.00" });
    const change = await owner.agent.put(`/api/tournaments/${created.body.id}/prize-pool/rates`).send({ rebuyRakeType: "fixed", rebuyRakeAmount: "5.00" });
    expect(change.status).toBe(200);
  });

  it("refuses an anonymous visitor (401) and creates nothing (SEC-02)", async () => {
    const club = await createClub();

    const response = await (await anon()).post("/api/tournaments").send(newTournament(club.id));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required", code: "UNAUTHENTICATED" });
    expect(await testDb().select().from(tournaments)).toEqual([]);
  });

  it("refuses a signed-in user who does not run the club (403), even when it has no owner", async () => {
    const club = await createClub();
    const { agent } = await signIn();

    const response = await agent.post("/api/tournaments").send(newTournament(club.id));

    expect(response.status).toBe(403);
    expect(await testDb().select().from(tournaments)).toEqual([]);
  });

  it("answers 404 when the club does not exist", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/tournaments").send(newTournament(UNKNOWN_ID));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found", code: "NOT_FOUND" });
  });

  it("answers 400 with the zod issues when the payload is invalid", async () => {
    const { club, owner } = await clubWithStaff();

    const response = await owner.agent
      .post("/api/tournaments")
      .send({ clubId: club.id, startDateTime: "not a date", buyInAmount: 50, maxPlayers: 40, rakeType: "lots" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid tournament data", code: "VALIDATION" });
    expect(response.body.details.map((issue: { path: string[] }) => issue.path.join("."))).toEqual([
      "name",
      "startDateTime",
      "rakeType",
    ]);
  });

  it("never writes results, money overrides or audit columns from the request (mass assignment)", async () => {
    const { club, owner } = await clubWithStaff();

    const response = await owner.agent.post("/api/tournaments").send(
      newTournament(club.id, {
        status: "registration",
        rakeOverride: "1.00",
        manualPrizePool: "9999",
        prizePoolLocked: true,
        prizePoolSnapshot: { v: 1 },
        finalizedAt: "2026-01-01T00:00:00.000Z",
        finalizedBy: owner.user.id,
        prizePoolAdjustedBy: owner.user.id,
        createdAt: "2000-01-01T00:00:00.000Z",
        id: "chosen-id",
      }),
    );

    expect(response.status).toBe(201);
    expect(await tournamentRow(response.body.id)).toMatchObject({
      status: "registration",
      rakeOverride: null,
      manualPrizePool: null,
      prizePoolLocked: false,
      prizePoolSnapshot: null,
      finalizedAt: null,
      finalizedBy: null,
      prizePoolAdjustedBy: null,
    });
    expect(response.body.id).not.toBe("chosen-id");
  });

  it.each(["in_progress", "completed", "cancelled"])("refuses to create a tournament that is already %s", async (status) => {
    const { club, owner } = await clubWithStaff();

    expect((await owner.agent.post("/api/tournaments").send(newTournament(club.id, { status }))).status).toBe(400);
  });

  it("only accepts a season of the same club and a points system of that season", async () => {
    const { club, owner } = await clubWithStaff();
    const season = await createSeason({ clubId: club.id });
    const otherSeason = await createSeason({ clubId: (await createClub()).id });
    const points = await createPointsSystem({ seasonId: season.id });
    const otherPoints = await createPointsSystem({ seasonId: otherSeason.id });
    const post = (extra: Record<string, unknown>) => owner.agent.post("/api/tournaments").send(newTournament(club.id, extra));

    expect((await post({ seasonId: otherSeason.id })).body).toMatchObject({ code: "SEASON_NOT_IN_CLUB" });
    expect((await post({ seasonId: season.id, pointsSystemId: otherPoints.id })).body).toMatchObject({
      code: "POINTS_SYSTEM_NOT_IN_SEASON",
    });
    expect((await post({ pointsSystemId: points.id })).body).toMatchObject({ code: "POINTS_SYSTEM_NOT_IN_SEASON" });
    expect((await post({ seasonId: season.id, pointsSystemId: points.id })).status).toBe(201);
    expect(await testDb().select().from(tournaments)).toHaveLength(1);
  });
});

describe("GET /api/tournaments/:id", () => {
  it("returns the public projection with the snapshot and the viewer, never the audit user ids", async () => {
    const { staff, tournament } = await staffedTournament({
      rakeType: "percentage",
      rakeAmount: "10.00",
      finalizedBy: "someone",
      prizePoolAdjustedBy: "someone",
    });
    await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id, paymentConfirmed: true });

    const anonymous = await (await anon()).get(`/api/tournaments/${tournament.id}`);
    const manager = await staff.manager.agent.get(`/api/tournaments/${tournament.id}`);

    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual(detail(tournament, false));
    expect(findForbiddenKeys(anonymous.body)).toEqual([]);
    expect(anonymous.body).not.toHaveProperty("confirmedPlayerCount");
    expect(manager.body.viewer).toEqual({ canManage: true, canOwn: false });
  });

  it("answers 404 for an unknown id", async () => {
    const response = await (await anon()).get(`/api/tournaments/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });
});

describe("GET /api/tournaments", () => {
  it("lists every tournament with its registered count, oldest first, without the snapshot or who has paid", async () => {
    const club = await createClub();
    const busy = await createTournament({ clubId: club.id, name: "Busy", createdAt: new Date("2026-01-01T00:00:00Z") });
    const empty = await createTournament({ clubId: club.id, name: "Empty", createdAt: new Date("2026-01-02T00:00:00Z") });
    for (const paymentConfirmed of [true, true, false, true, false]) {
      await createRegistration({ tournamentId: busy.id, playerId: (await createPlayer()).id, paymentConfirmed });
    }

    const response = await (await anon()).get("/api/tournaments");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { ...publicView(busy), confirmedPlayerCount: null, registeredCount: 5 },
      { ...publicView(empty), confirmedPlayerCount: null, registeredCount: 0 },
    ]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("counts confirmed payments only for the viewer's own clubs: payment is staff bookkeeping (P2REV0-SEC-04)", async () => {
    const { club, manager, stranger, admin } = await clubWithStaff();
    const mine = await createTournament({ clubId: club.id });
    const theirs = await createTournament({ clubId: (await createClub()).id });
    for (const tournament of [mine, theirs]) {
      await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id, paymentConfirmed: true });
      await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id, paymentConfirmed: false });
    }
    const counts = async (agent: { get: (path: string) => Promise<{ body: unknown }> }) =>
      Object.fromEntries(
        ((await agent.get("/api/tournaments")).body as TournamentListItemDto[]).map((t) => [t.id, t.confirmedPlayerCount]),
      );

    expect(await counts(manager.agent)).toEqual({ [mine.id]: 1, [theirs.id]: null });
    expect(await counts(stranger.agent)).toEqual({ [mine.id]: null, [theirs.id]: null });
    expect(await counts(admin.agent)).toEqual({ [mine.id]: 1, [theirs.id]: 1 });
  });

  it("gives the tournaments not started yet, soonest first, with ?upcoming=true, and only the first few with ?limit= (P2REV0-SEC-02)", async () => {
    const club = await createClub();
    const later = await createTournament({ clubId: club.id, status: "registration", startDateTime: inDays(3) });
    const soon = await createTournament({ clubId: club.id, status: "scheduled", startDateTime: inDays(1) });
    const middle = await createTournament({ clubId: club.id, status: "scheduled", startDateTime: inDays(2) });
    await createTournament({ clubId: club.id, status: "in_progress", startDateTime: inDays(-1) });
    await createTournament({ clubId: club.id, status: "completed", startDateTime: inDays(-30) });
    const ids = async (query: string) =>
      ((await (await anon()).get(`/api/tournaments${query}`)).body as Array<{ id: string }>).map((t) => t.id);

    expect(await ids("?upcoming=true")).toEqual([soon.id, middle.id, later.id]);
    expect(await ids("?upcoming=true&limit=2")).toEqual([soon.id, middle.id]);
    expect(await ids("?limit=1")).toHaveLength(1);
    expect(await ids("?upcoming=false")).toHaveLength(5);
    expect((await (await anon()).get("/api/tournaments?limit=500")).status).toBe(400);
    expect((await (await anon()).get("/api/tournaments?upcoming=yes")).status).toBe(400);
  });

  it("leaves out games that started more than 12 hours ago, however their status was left, so none can head the home page for good (SEC-P2REV-04)", async () => {
    const club = await createClub();
    const tonight = await createTournament({ clubId: club.id, status: "registration", startDateTime: inHours(-11) });
    const tomorrow = await createTournament({ clubId: club.id, status: "scheduled", startDateTime: inDays(1) });
    await createTournament({ clubId: club.id, status: "scheduled", startDateTime: inHours(-13), name: "Left scheduled last week" });
    await createTournament({ clubId: club.id, status: "scheduled", startDateTime: new Date("1970-01-01T00:00:00Z"), name: "Back-dated spam" });

    const response = await (await anon()).get("/api/tournaments?upcoming=true&limit=6");

    expect((response.body as Array<{ id: string }>).map((t) => t.id)).toEqual([tonight.id, tomorrow.id]);
  });

  it("applies every filter given: club, season and status", async () => {
    const clubA = await createClub();
    const clubB = await createClub();
    const seasonB = await createSeason({ clubId: clubB.id });
    const inA = await createTournament({ clubId: clubA.id, status: "registration" });
    const inBSeason = await createTournament({ clubId: clubB.id, seasonId: seasonB.id });
    const inB = await createTournament({ clubId: clubB.id, status: "registration" });
    const ids = async (query: string) =>
      ((await (await anon()).get(`/api/tournaments${query}`)).body as Array<{ id: string }>).map((t) => t.id).sort();

    expect(await ids(`?clubId=${clubA.id}`)).toEqual([inA.id]);
    expect(await ids(`?seasonId=${seasonB.id}`)).toEqual([inBSeason.id]);
    expect(await ids(`?clubId=${clubA.id}&seasonId=${seasonB.id}`)).toEqual([]);
    expect(await ids(`?status=registration`)).toEqual([inA.id, inB.id].sort());
    expect(await ids(`?clubId=${clubB.id}&status=registration`)).toEqual([inB.id]);
    expect(await ids(`?clubId=${UNKNOWN_ID}`)).toEqual([]);
  });

  it("answers 400 for a malformed filter", async () => {
    const response = await (await anon()).get("/api/tournaments?status=paused");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
  });
});

describe("PUT /api/tournaments/:id", () => {
  it("refuses to turn the high hand off while entries are in it, since the desk charges them and nobody could award the pot (P2REV1-MONEY-05)", async () => {
    const { tournament, staff } = await staffedTournament({ enableHighHand: true, highHandAmount: "10.00", status: "in_progress" });
    const ann = await createPlayer({ name: "Ann" });
    const entry = await createRegistration({ tournamentId: tournament.id, playerId: ann.id, enteringHighHands: true });
    const path = `/api/tournaments/${tournament.id}`;

    const refused = await staff.owner.agent.put(path).send({ enableHighHand: false });

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: "1 player has entered the high hand: take them out of it before turning it off",
      code: "HIGH_HAND_ENTRIES",
      details: { entrants: 1 },
    });
    expect((await tournamentRow(tournament.id)).enableHighHand).toBe(true);

    // Once nobody is in it, it can go.
    expect((await staff.owner.agent.put(`/api/registrations/${entry.id}`).send({ enteringHighHands: false })).status).toBe(200);
    const turnedOff = await staff.owner.agent.put(path).send({ enableHighHand: false });
    expect(turnedOff.status).toBe(200);
    expect(turnedOff.body.enableHighHand).toBe(false);
  });

  it.each(VISITORS)("answers a %s as the authorization rules say", async (visitor) => {
    const { staff, tournament } = await staffedTournament();
    const agent = await agentFor(visitor, staff);

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ name: "Renamed" });

    expect(response.status).toBe(MANAGER_ROUTE[visitor]);
    expect((await tournamentRow(tournament.id)).name).toBe(response.status === 200 ? "Renamed" : tournament.name);
  });

  it("answers 401 to anonymous visitors before looking the tournament up", async () => {
    const response = await (await anon()).put(`/api/tournaments/${UNKNOWN_ID}`).send({ name: "Hijacked" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required", code: "UNAUTHENTICATED" });
  });

  it("answers 403 to a signed-in user who does not run the club, even when it has no owner", async () => {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const { agent } = await signIn();

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ name: "Mine now" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "You don't have permission to manage this tournament", code: "FORBIDDEN" });
  });

  it("lets a manager update fields and returns the updated tournament; a rate change is logged as on /rates (P2REV4-01)", async () => {
    const { staff, tournament } = await staffedTournament();

    const response = await staff.manager.agent
      .put(`/api/tournaments/${tournament.id}`)
      .send({ name: "Renamed", buyInAmount: 75, rakeType: "fixed", rakeAmount: 5 });

    expect(response.status).toBe(200);
    const row = await tournamentRow(tournament.id);
    expect(row).toMatchObject({ name: "Renamed", buyInAmount: "75.00", rakeType: "fixed", rakeAmount: "5.00" });
    expect(response.body).toEqual(detail(row, true, false));
    expect((await activityFor(tournament.id)).map((entry) => entry.eventType)).toEqual(["rake_rates_changed"]);
    expect((await auditFor(tournament.id)).map((entry) => entry.action)).toEqual(["prize_pool.rates"]);
  });

  it("lets a manager resend the stored rates without logging a change or clearing the manual AP total", async () => {
    const { staff, tournament } = await staffedTournament({ rakeType: "percentage", rakeAmount: "10.00", rakeOverride: "5.00" });
    await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id });

    const response = await staff.manager.agent
      .put(`/api/tournaments/${tournament.id}`)
      .send({ name: "Renamed", rakeType: "percentage", rakeAmount: "10" });

    expect(response.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({ rakeAmount: "10.00", rakeOverride: "5.00" });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  it("answers 404 for an unknown tournament", async () => {
    const { agent } = await signIn();

    const response = await agent.put(`/api/tournaments/${UNKNOWN_ID}`).send({ name: "Nobody" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });

  it("answers 400 with the zod issues for an invalid change, and for an empty one", async () => {
    const { tournament, agent } = await staffedTournament();

    const invalid = await agent.put(`/api/tournaments/${tournament.id}`).send({ payoutStructure: "winner_takes_all" });
    const empty = await agent.put(`/api/tournaments/${tournament.id}`).send({ unknown: 1 });

    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: "Invalid tournament data", details: [{ path: ["payoutStructure"] }] });
    expect(empty.status).toBe(400);
  });

  it("keeps the tournament in its club: clubId may be resent unchanged, never changed (SEC-07, security-31)", async () => {
    const { staff, tournament, agent } = await staffedTournament();
    const other = await clubWithStaff();

    const same = await agent.put(`/api/tournaments/${tournament.id}`).send({ clubId: staff.club.id, name: "Same club" });
    const moved = await agent.put(`/api/tournaments/${tournament.id}`).send({ clubId: other.club.id });
    const byOtherOwner = await other.owner.agent.put(`/api/tournaments/${tournament.id}`).send({ clubId: other.club.id });

    expect(same.status).toBe(200);
    expect(moved.status).toBe(400);
    expect(moved.body).toMatchObject({ code: "CANNOT_MOVE" });
    expect(byOtherOwner.status).toBe(403);
    expect((await tournamentRow(tournament.id)).clubId).toBe(staff.club.id);
  });

  it("only attaches a season of the tournament's club, and a points system of that season", async () => {
    const { staff, tournament, agent } = await staffedTournament();
    const season = await createSeason({ clubId: staff.club.id });
    const foreign = await createSeason({ clubId: (await createClub()).id });
    const points = await createPointsSystem({ seasonId: season.id });

    const wrongSeason = await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: foreign.id });
    const pointsWithoutSeason = await agent.put(`/api/tournaments/${tournament.id}`).send({ pointsSystemId: points.id });
    const both = await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: season.id, pointsSystemId: points.id });

    expect(wrongSeason.body.code).toBe("SEASON_NOT_IN_CLUB");
    expect(pointsWithoutSeason.body.code).toBe("POINTS_SYSTEM_NOT_IN_SEASON");
    expect(both.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({ seasonId: season.id, pointsSystemId: points.id });
  });

  it.each([
    ["registration", "Registration Open"],
    ["in_progress", "In Progress"],
    ["cancelled", "Cancelled"],
  ])("logs a status change to %s as %j", async (status, label) => {
    const { tournament, agent } = await staffedTournament({ status: "scheduled" });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ status });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(status);
    expect(await activityFor(tournament.id)).toEqual([
      { eventType: "status_change", description: `Tournament status changed to ${label}`, playerId: null },
    ]);
  });

  it("labels a change back to scheduled, and does not log a status resent unchanged", async () => {
    const { tournament, agent } = await staffedTournament({ status: "registration" });

    await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "scheduled" });
    await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "scheduled" });

    expect((await activityFor(tournament.id)).map((entry) => entry.description)).toEqual(["Tournament status changed to Scheduled"]);
  });

  it("leaves completing a tournament to finalize, and keeps a finished one's status (SEC-07)", async () => {
    const open = await staffedTournament({ status: "in_progress" });
    const finished = await staffedTournament({ status: "completed" });

    const complete = await open.agent.put(`/api/tournaments/${open.tournament.id}`).send({ status: "completed" });
    const reopen = await finished.agent.put(`/api/tournaments/${finished.tournament.id}`).send({ status: "in_progress" });

    expect(complete.status).toBe(400);
    expect(complete.body.code).toBe("INVALID_STATUS_TRANSITION");
    expect(reopen.body.code).toBe("INVALID_STATUS_TRANSITION");
    expect((await tournamentRow(open.tournament.id)).status).toBe("in_progress");
    expect((await tournamentRow(finished.tournament.id)).status).toBe("completed");
    expect(await activityFor(open.tournament.id)).toEqual([]);
  });

  it("reopens a cancelled tournament for registration, but not straight into play", async () => {
    const { tournament, agent } = await staffedTournament({ status: "cancelled" });

    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "in_progress" })).body.code).toBe(
      "INVALID_STATUS_TRANSITION",
    );
    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "registration" })).status).toBe(200);
  });

  it("refuses an unknown status", async () => {
    const { tournament, agent } = await staffedTournament();

    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "paused" })).status).toBe(400);
  });

  it("freezes the prize pool settings of a completed or cancelled tournament, but not its name or details", async () => {
    const { tournament, agent } = await staffedTournament({ status: "completed", buyInAmount: "50.00" });

    const money = await agent.put(`/api/tournaments/${tournament.id}`).send({ buyInAmount: 100, payoutStructure: "top5" });
    const resent = await agent.put(`/api/tournaments/${tournament.id}`).send({ buyInAmount: "50", name: "Final night" });

    expect(money.status).toBe(409);
    expect(money.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { fields: ["buyInAmount", "payoutStructure"] } });
    expect(resent.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({ buyInAmount: "50.00", payoutStructure: "standard", name: "Final night" });
  });

  it("accepts a manual prize pool resent unchanged on a closed tournament, with the details that did change (MONEY-REV-03)", async () => {
    const { tournament, agent } = await staffedTournament({ status: "completed", manualPrizePool: "300.00", rakeType: "percentage", rakeAmount: "10.00" });

    const response = await agent
      .put(`/api/tournaments/${tournament.id}`)
      .send({ name: "Final night", manualPrizePool: "300", rakeType: "percentage", rakeAmount: "10" });

    expect(response.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({ name: "Final night", manualPrizePool: "300.00" });
    expect(await activityFor(tournament.id)).toEqual([]);
  });

  describe("AP rates sent to PUT follow the rules of PUT …/prize-pool/rates (MONEY-REV-02, P2REV4-01)", () => {
    it("checks a rate sent without its type against the stored type: no 150% buy-in AP", async () => {
      const { tournament, agent } = await staffedTournament({ rakeType: "percentage", rakeAmount: "10.00" });

      const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ rakeAmount: "150" });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "PERCENT_OVER_100", details: { field: "rakeAmount" } });
      expect(await tournamentRow(tournament.id)).toMatchObject({ rakeType: "percentage", rakeAmount: "10.00" });
    });

    it("never turns 10% into $10 per entry: a new type needs its amount", async () => {
      const { tournament, agent } = await staffedTournament({ rakeType: "percentage", rakeAmount: "10.00" });

      const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ rakeType: "fixed" });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "AMOUNT_REQUIRED", details: { field: "rakeAmount" } });
      expect(await tournamentRow(tournament.id)).toMatchObject({ rakeType: "percentage", rakeAmount: "10.00" });
    });

    it("clears the manual AP total when the rates change, and logs and audits it", async () => {
      const { tournament, agent } = await staffedTournament({ rakeType: "percentage", rakeAmount: "10.00", rakeOverride: "20.00" });
      for (let i = 0; i < 4; i++) await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id });

      const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ rakeAmount: "5" });

      expect(response.status).toBe(200);
      expect(await tournamentRow(tournament.id)).toMatchObject({ rakeAmount: "5.00", rakeOverride: null });
      expect(await activityFor(tournament.id)).toEqual([
        {
          eventType: "rake_rates_changed",
          description: "Rake rates changed: buy-ins 10% → 5%; the manual Rake total is cleared",
          playerId: null,
        },
      ]);
      expect((await auditFor(tournament.id)).map((entry) => entry.action)).toEqual(["prize_pool.rates"]);
    });

    it("refuses new entry prices that would leave a manual AP total above what is taken in", async () => {
      const { tournament, agent } = await staffedTournament({ buyInAmount: "50.00", rakeOverride: "100.00" });
      for (let i = 0; i < 4; i++) await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id });

      const tooLow = await agent.put(`/api/tournaments/${tournament.id}`).send({ buyInAmount: "20" });
      const fine = await agent.put(`/api/tournaments/${tournament.id}`).send({ buyInAmount: "25" });

      expect(tooLow.status).toBe(400);
      expect(tooLow.body).toMatchObject({ code: "AP_EXCEEDS_GROSS", details: { grossCents: 8_000 } });
      expect(fine.status).toBe(200);
      expect(await tournamentRow(tournament.id)).toMatchObject({ buyInAmount: "25.00", rakeOverride: "100.00" });
    });
  });

  describe("a tournament's image follows the club and player rules (P2REV4-02)", () => {
    it("takes only images our uploads stored, on create and on update, and keeps an unchanged legacy one", async () => {
      const { club, owner } = await clubWithStaff();
      const foreign = "https://tracker.example/pixel.png";

      const created = await owner.agent.post("/api/tournaments").send(newTournament(club.id, { imageUrl: foreign }));
      expect(created.status).toBe(400);
      expect(created.body).toMatchObject({ error: "Invalid tournament data", details: [{ path: ["imageUrl"] }] });

      const legacy = await createTournament({ clubId: club.id, imageUrl: "https://legacy-bucket.example/t/old.webp" });
      const swapped = await owner.agent.put(`/api/tournaments/${legacy.id}`).send({ imageUrl: foreign });
      const unchanged = await owner.agent.put(`/api/tournaments/${legacy.id}`).send({ name: "Kept", imageUrl: legacy.imageUrl });
      const ours = await owner.agent.put(`/api/tournaments/${legacy.id}`).send({ imageUrl: "/uploads/tournament_banner/new/1200.webp" });

      expect(swapped.status).toBe(400);
      expect([unchanged.status, ours.status]).toEqual([200, 200]);
      expect((await tournamentRow(legacy.id)).imageUrl).toBe("/uploads/tournament_banner/new/1200.webp");
    });

    it("logs a replaced banner as an orphan, and deletes nothing", async () => {
      const { tournament, agent } = await staffedTournament({ imageUrl: "/uploads/tournament_banner/old/1200.webp" });
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        await agent.put(`/api/tournaments/${tournament.id}`).send({ imageUrl: "/uploads/tournament_banner/new/1200.webp" });

        expect(info).toHaveBeenCalledWith(expect.stringMatching(/orphaned, kept \(replaced on tournament .+\).*\/uploads\/tournament_banner\/old\//));
      } finally {
        info.mockRestore();
      }
    });
  });

  it("stamps the time the prize pool is locked, logs locking once, and clears the stamp on unlocking", async () => {
    const { tournament, agent } = await staffedTournament();
    const lock = {
      eventType: "prize_pool_locked",
      description: "Prize pool has been locked - no further registrations, rebuys, or addons allowed",
      playerId: null,
    };

    const before = Date.now();
    const locked = await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: true });
    const lockedAt = (await tournamentRow(tournament.id)).prizePoolLockedAt;
    await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: true });
    const unlocked = await agent.put(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: false });

    expect(locked.body.prizePoolLocked).toBe(true);
    expect(lockedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await tournamentRow(tournament.id)).prizePoolLockedAt).toBeNull();
    expect(unlocked.body).toMatchObject({ prizePoolLocked: false, prizePoolLockedAt: null });
    expect(await activityFor(tournament.id)).toEqual([lock]);
  });

  it("logs a status change and a lock sent together as two entries, in the order they happened (P2REV4-06)", async () => {
    const { tournament, agent } = await staffedTournament({ status: "registration" });

    await agent.put(`/api/tournaments/${tournament.id}`).send({ status: "in_progress", prizePoolLocked: true });

    expect((await activityFor(tournament.id)).map((entry) => entry.eventType)).toEqual(["status_change", "prize_pool_locked"]);
    const feed = await (await anon()).get(`/api/tournaments/${tournament.id}/activity`);
    expect(feed.body.map((entry: { eventType: string }) => entry.eventType)).toEqual(["prize_pool_locked", "status_change"]);
  });

  it("sets a manual prize pool through the prize-pool rules: it clears the AP override, is logged and audited (D13)", async () => {
    const { staff, tournament } = await staffedTournament({ rakeOverride: "10.00" });

    const response = await staff.manager.agent.put(`/api/tournaments/${tournament.id}`).send({ manualPrizePool: "300" });

    expect(response.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({
      manualPrizePool: "300.00",
      rakeOverride: null,
      prizePoolAdjustedBy: staff.manager.user.id,
    });
    expect(response.body).toMatchObject({ manualPrizePool: "300.00", rakeOverride: null });
    expect(await activityFor(tournament.id)).toEqual([
      { eventType: "prize_pool_adjusted", description: "Prize pool set manually to $300 (calculated $0)", playerId: null },
    ]);
    expect(await auditFor(tournament.id)).toMatchObject([{ action: "prize_pool.adjust", actorUserId: staff.manager.user.id }]);
  });

  it("clears a manual prize pool sent blank, and leaves an AP override alone when no manual pool was set", async () => {
    const withPool = await staffedTournament({ manualPrizePool: "300.00" });
    const withAp = await staffedTournament({ rakeOverride: "10.00" });

    await withPool.agent.put(`/api/tournaments/${withPool.tournament.id}`).send({ manualPrizePool: "" });
    await withAp.agent.put(`/api/tournaments/${withAp.tournament.id}`).send({ manualPrizePool: null });

    expect((await tournamentRow(withPool.tournament.id)).manualPrizePool).toBeNull();
    expect(await activityFor(withPool.tournament.id)).toMatchObject([{ eventType: "prize_pool_adjusted" }]);
    expect((await tournamentRow(withAp.tournament.id)).rakeOverride).toBe("10.00");
    expect(await activityFor(withAp.tournament.id)).toEqual([]);
  });

  it("never writes results, overrides or audit columns sent in the body (mass assignment)", async () => {
    const { staff, tournament } = await staffedTournament();

    const response = await staff.owner.agent.put(`/api/tournaments/${tournament.id}`).send({
      name: "Edited",
      rakeOverride: "1.00",
      prizePoolSnapshot: { v: 1, paid: [] },
      finalizedAt: "2026-01-01T00:00:00.000Z",
      finalizedBy: staff.stranger.user.id,
      prizePoolAdjustedBy: staff.stranger.user.id,
      prizePoolLockedAt: "2020-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({
      name: "Edited",
      rakeOverride: null,
      prizePoolSnapshot: null,
      finalizedAt: null,
      finalizedBy: null,
      prizePoolAdjustedBy: null,
      prizePoolLockedAt: null,
    });
  });
});

describe("PATCH /api/tournaments/:id (removed)", () => {
  it("answers the API's JSON 404 and leaves the tournament alone, signed in or not (SEC-02)", async () => {
    const { tournament, agent } = await staffedTournament({ prizePoolLocked: true });

    for (const client of [await anon(), agent]) {
      const response = await client.patch(`/api/tournaments/${tournament.id}`).send({ prizePoolLocked: false, manualPrizePool: "5000" });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "No such API endpoint", code: "NOT_FOUND" });
    }
    expect(await tournamentRow(tournament.id)).toMatchObject({ prizePoolLocked: true, manualPrizePool: null });
  });
});

describe("DELETE /api/tournaments/:id", () => {
  it.each(VISITORS)("answers a %s as the authorization rules say (owner or admin only)", async (visitor) => {
    const { staff, tournament } = await staffedTournament();
    const agent = await agentFor(visitor, staff);

    const response = await agent.delete(`/api/tournaments/${tournament.id}`);

    expect(response.status).toBe(OWNER_ROUTE[visitor]);
    expect(await tournamentRow(tournament.id)).toEqual(response.status === 200 ? undefined : expect.anything());
  });

  it("tells a manager only the owner or an admin can delete", async () => {
    const { staff, tournament } = await staffedTournament();

    const response = await staff.manager.agent.delete(`/api/tournaments/${tournament.id}`);

    expect(response.body).toEqual({ error: "Only the club's owner or an admin can do that", code: "FORBIDDEN" });
  });

  it("lets the owner delete it, cascading to its registrations and activity log, and audits it", async () => {
    const banner = "/uploads/tournament_banner/5f0e9c3d-6a1b-4c2d-8e7f-1a2b3c4d5e6f/1600.webp";
    const { staff, tournament, agent } = await staffedTournament({ name: "Gone", imageUrl: banner });
    await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id });
    await testDb().insert(activityLog).values({ tournamentId: tournament.id, eventType: "registration", description: "x" });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await agent.delete(`/api/tournaments/${tournament.id}`);

    // The banner stays in storage, logged as an orphan (P2-PRODDATA-03).
    expect(info).toHaveBeenCalledWith(
      `[images] orphaned, kept (tournament ${tournament.id} was deleted): ${banner.replace("1600", "800")} ${banner}`,
    );
    info.mockRestore();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: "Tournament deleted successfully" });
    expect((await (await anon()).get(`/api/tournaments/${tournament.id}`)).status).toBe(404);
    expect(await testDb().select().from(tournamentRegistrations)).toEqual([]);
    expect(await testDb().select().from(activityLog)).toEqual([]);
    expect(
      await testDb()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "tournament.delete"), eq(auditLog.targetId, tournament.id))),
    ).toMatchObject([{ actorUserId: staff.owner.user.id, data: { name: "Gone", clubId: staff.club.id, imageUrl: banner } }]);
  });

  it("answers 404 for an unknown tournament", async () => {
    const { agent } = await signIn();

    const response = await agent.delete(`/api/tournaments/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });
});
