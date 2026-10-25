/**
 * No public read gives away anyone's contact details or account ids (contract §1.4, SEC-09). Every
 * GET route that mounts no guard is requested, as nobody, a signed-in stranger, the club's owner and a
 * platform admin, in a club whose staff and players all have emails, phones and accounts, after a
 * live and a finished tournament's worth of activity made through the API. Each body is walked with
 * `findForbiddenKeys` (JSON text inside strings included) and searched for every one of those emails,
 * phones and user ids. The route list comes from the router stack (test/helpers/routes.ts), so a new
 * public read without a probe here fails the inventory test.
 */
import { eq } from "drizzle-orm";
import type request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_SNAPSHOT_FIELDS } from "@shared/api/finalize";
import { findForbiddenKeys } from "@shared/api/public";
import { presetStructure } from "@shared/domain/blind-structures";
import { users, type Club, type Player, type PointsSystem, type Season, type Tournament } from "@shared/schema";
import { createPlayer, createSeason, createUser } from "../factories";
import { getApp, testDb } from "../helpers";
import { agentFor, clubWithStaff, type ClubStaffAgents, type Visitor } from "../helpers/club-staff";
import { appRoutes } from "../helpers/routes";
import { signUpTokenFor } from "../helpers/sign-up";

interface World {
  staff: ClubStaffAgents;
  club: Club;
  season: Season;
  pointsSystem: PointsSystem;
  /** In progress: registrations, payments, counts, an elimination, a high hand, AP changes, a pending request. */
  live: Tournament;
  /** Finalized through the API: positions, prizes, points, the snapshot. */
  finished: Tournament;
  players: Player[];
  /** Every email, phone and user id in the world: none may appear in a public body. */
  secrets: string[];
}

type Probe = (world: World) => string[];

/** Every public read, with the URLs that exercise it against the world. */
const PROBES: Record<string, Probe> = {
  "GET /api/health": () => ["/api/health"],
  "GET /api/clubs": () => ["/api/clubs"],
  "GET /api/clubs/member-counts": () => ["/api/clubs/member-counts"],
  "GET /api/clubs/slug/:slug": ({ club }) => [`/api/clubs/slug/${club.slug}`],
  "GET /api/clubs/:id": ({ club }) => [`/api/clubs/${club.id}`],
  "GET /api/clubs/:id/members-count": ({ club }) => [`/api/clubs/${club.id}/members-count`],
  "GET /api/seasons": ({ club }) => ["/api/seasons", `/api/seasons?clubId=${club.id}`],
  "GET /api/seasons/:id": ({ season }) => [`/api/seasons/${season.id}`],
  "GET /api/seasons/:seasonId/leaderboard": ({ season }) => [`/api/seasons/${season.id}/leaderboard`],
  "GET /api/seasons/:seasonId/points-systems": ({ season }) => [`/api/seasons/${season.id}/points-systems`],
  "GET /api/points-systems/:id": ({ pointsSystem }) => [`/api/points-systems/${pointsSystem.id}`],
  "GET /api/points-systems/:pointsSystemId/allocations": ({ pointsSystem }) => [`/api/points-systems/${pointsSystem.id}/allocations`],
  "GET /api/public/tournaments/:id/players": ({ live }) => [`/api/public/tournaments/${live.id}/players?q=PII`],
  "GET /api/public/tournaments/:id/display": ({ live, finished }) => [
    `/api/public/tournaments/${live.id}/display`,
    `/api/public/tournaments/${finished.id}/display`,
  ],
  "GET /api/public/tournaments/:id/seating": ({ live, finished }) => [
    `/api/public/tournaments/${live.id}/seating`,
    `/api/public/tournaments/${finished.id}/seating`,
  ],
  "GET /api/public/seasons/:id/leaderboard": ({ season }) => [`/api/public/seasons/${season.id}/leaderboard`],
  "GET /api/tournaments": ({ club }) => ["/api/tournaments", `/api/tournaments?clubId=${club.id}`],
  "GET /api/tournaments/counts": () => ["/api/tournaments/counts"],
  "GET /api/tournaments/:id": ({ live, finished }) => [`/api/tournaments/${live.id}`, `/api/tournaments/${finished.id}`],
  "GET /api/tournaments/:id/prize-pool": ({ live, finished }) => [
    `/api/tournaments/${live.id}/prize-pool`,
    `/api/tournaments/${finished.id}/prize-pool`,
  ],
  "GET /api/tournaments/:id/registrations": ({ live, finished }) => [
    `/api/tournaments/${live.id}/registrations`,
    `/api/tournaments/${finished.id}/registrations`,
  ],
  "GET /api/tournaments/:tournamentId/activity": ({ live, finished }) => [
    `/api/tournaments/${live.id}/activity`,
    `/api/tournaments/${finished.id}/activity`,
  ],
};

/** Reads about the caller's own account, which carry their own email by design (checked separately). */
const SELF_READS = ["GET /api/auth/me"];

/** Who looks: nobody, someone with no role at the club, its owner (who sees staff-only activity), and an admin. */
const VIEWERS: readonly Visitor[] = ["anonymous", "stranger", "owner", "admin"];

let world: World;

/** The response, after checking its status: setting up the world must not fail quietly. */
async function ok(pending: request.Test, status = 200): Promise<request.Response> {
  const response = await pending;
  if (response.status !== status) throw new Error(`Setup request answered ${response.status}: ${JSON.stringify(response.body)}`);
  return response;
}

/** A player with every personal field filled, linked to an account of their own. */
async function personalPlayer(index: number): Promise<Player> {
  const account = await createUser({ phone: `027 400 10${index}` });
  return createPlayer({ name: `PII Player ${index}`, email: `pii-player-${index}@example.test`, phone: `021 400 20${index}`, userId: account.id });
}

async function buildWorld(): Promise<World> {
  const staff = await clubWithStaff({ description: "<p>Friday nights at <strong>the club</strong></p>", address: "1 Main St" });
  const { club, owner, manager } = staff;
  const members = [owner, manager, staff.admin, staff.stranger];
  for (let index = 0; index < members.length; index++) {
    await testDb().update(users).set({ phone: `022 300 10${index}` }).where(eq(users.id, members[index].user.id));
  }
  const season = await createSeason({ clubId: club.id });
  const pointsSystem = (
    await ok(
      manager.agent.post(`/api/seasons/${season.id}/points-systems`).send({
        name: "PII Points",
        participationPoints: 1,
        knockoutPoints: 2,
        allocations: [
          { position: 1, points: 10 },
          { position: 2, points: 6 },
          { position: 3, positionEnd: 5, points: 3 },
        ],
      }),
      201,
    )
  ).body as PointsSystem;
  const players = [];
  for (let index = 0; index < 8; index++) players.push(await personalPlayer(index));

  const newTournament = async (name: string) =>
    (
      await ok(
        manager.agent.post("/api/tournaments").send({
          clubId: club.id,
          seasonId: season.id,
          pointsSystemId: pointsSystem.id,
          name,
          startDateTime: "2026-03-01T19:00:00Z",
          buyInAmount: "50.00",
          rebuyAmount: "50.00",
          addonAmount: "25.00",
          enableHighHand: true,
          highHandAmount: "5.00",
          maxPlayers: 20,
          status: "registration",
        }),
        201,
      )
    ).body as Tournament;
  const anonymous = await agentFor("anonymous", staff);

  // The live tournament: QR sign-ups and desk sign-ups, then the night's events.
  const live = await newTournament("PII Live");
  const liveRegistrations = [];
  for (let index = 0; index < 5; index++) {
    const playerId = players[index].id;
    const signUp =
      index < 3
        ? anonymous
            .post(`/api/tournaments/${live.id}/registrations`)
            .send({ playerId, enteringHighHands: index === 0, signUpToken: signUpTokenFor(playerId) })
        : manager.agent.post(`/api/tournaments/${live.id}/registrations`).send({ playerId, paymentConfirmed: true });
    liveRegistrations.push((await ok(signUp, 201)).body as { id: string });
  }
  await ok(manager.agent.patch(`/api/registrations/${liveRegistrations[0].id}/confirm-payment`));
  await ok(manager.agent.put(`/api/tournaments/${live.id}`).send({ status: "in_progress" }));
  await ok(manager.agent.post(`/api/registrations/${liveRegistrations[1].id}/counts`).send({ rebuys: 1, addons: 1 }));
  await ok(manager.agent.put(`/api/registrations/${liveRegistrations[4].id}`).send({ isEliminated: true, eliminatedBy: players[3].id }));
  await ok(manager.agent.put(`/api/registrations/${liveRegistrations[0].id}`).send({ highHandWinner: true, highHandAmount: "15.00" }));
  await ok(anonymous.post(`/api/tournaments/${live.id}/pending-actions`).send({ playerId: players[2].id, actionType: "addon" }), 201);
  await ok(owner.agent.put(`/api/tournaments/${live.id}/prize-pool/rates`).send({ rakeType: "percentage", rakeAmount: "10.00" }));
  await ok(
    owner.agent.put(`/api/tournaments/${live.id}/prize-pool/adjustment`).send({ mode: "ap_override", amount: "20.00", reason: "Low turnout" }),
  );
  // Seated players, a running clock showing the money and an early bird, so the TV and seat finder have them all to show.
  await ok(manager.agent.post(`/api/tournaments/${live.id}/seating/setup`).send({}), 201);
  await ok(
    manager.agent.put(`/api/tournaments/${live.id}/clock`).send({
      structure: presetStructure("central_stars_one_life_line"),
      presetKey: "central_stars_one_life_line",
      displaySettings: { showPrizePool: "always", showAp: true, qrTarget: "seats" },
      baseHash: null,
    }),
    201,
  );
  await ok(manager.agent.post(`/api/tournaments/${live.id}/clock/actions`).send({ action: "start" }));
  await ok(manager.agent.post(`/api/tournaments/${live.id}/early-birds`).send({ registrationIds: [liveRegistrations[1].id], earlyBird: true }));

  // The finished tournament: three players, two knocked out, finalized by the owner.
  const finished = await newTournament("PII Finished");
  for (const player of players.slice(5)) {
    await ok(manager.agent.post(`/api/tournaments/${finished.id}/registrations`).send({ playerId: player.id, paymentConfirmed: true }), 201);
  }
  await ok(manager.agent.put(`/api/tournaments/${finished.id}`).send({ status: "in_progress" }));
  const finishedRegistrations = (await ok(anonymous.get(`/api/tournaments/${finished.id}/registrations`))).body as Array<{ id: string; playerId: string }>;
  const byPlayer = (player: Player) => finishedRegistrations.find((registration) => registration.playerId === player.id)!;
  await ok(manager.agent.put(`/api/registrations/${byPlayer(players[7]).id}`).send({ isEliminated: true, eliminatedBy: players[5].id }));
  await ok(manager.agent.put(`/api/registrations/${byPlayer(players[6]).id}`).send({ isEliminated: true, eliminatedBy: players[5].id }));
  const preview = await ok(owner.agent.post(`/api/tournaments/${finished.id}/finalize/preview`).send({}));
  await ok(owner.agent.post(`/api/tournaments/${finished.id}/finalize`).send({ expectedPlanHash: preview.body.planHash }));

  const accounts = await testDb().select({ id: users.id, email: users.email, phone: users.phone }).from(users);
  const secrets = [
    ...accounts.flatMap((account) => [account.id, account.email, account.phone]),
    ...players.flatMap((player) => [player.email, player.phone, player.userId]),
  ].filter((value): value is string => typeof value === "string" && value !== "");

  return { staff, club, season, pointsSystem, live, finished, players, secrets };
}

beforeAll(async () => {
  world = await buildWorld();
});

describe("public reads", () => {
  it("are every GET route without a guard: each has a probe below", async () => {
    const reads = appRoutes(await getApp()).filter((route) => route.method === "GET" && route.guards.length === 0);

    expect(reads.map((route) => route.key).sort()).toEqual([...Object.keys(PROBES), ...SELF_READS].sort());
  });

  describe.each(Object.entries(PROBES))("%s", (_key, probe) => {
    it.each(VIEWERS)("shows %s no email, phone, user id or other forbidden key", async (viewer) => {
      const agent = await agentFor(viewer, world.staff);

      for (const url of probe(world)) {
        const response = await agent.get(url);

        expect(response.status, url).toBe(200);
        // Every list in this world has rows, so the scan below has something to look at.
        if (Array.isArray(response.body)) expect(response.body.length, url).toBeGreaterThan(0);
        expect(findForbiddenKeys(response.body), url).toEqual([]);
        const text = JSON.stringify(response.body);
        expect(world.secrets.filter((secret) => text.includes(secret)), url).toEqual([]);
      }
    });
  });

  it("include the finished tournament's results, so the scan covered them", async () => {
    const anonymous = await agentFor("anonymous", world.staff);

    const [detail, leaderboard, activity] = await Promise.all([
      anonymous.get(`/api/tournaments/${world.finished.id}`),
      anonymous.get(`/api/seasons/${world.season.id}/leaderboard`),
      anonymous.get(`/api/tournaments/${world.live.id}/activity`),
    ]);

    expect(detail.body).toMatchObject({ status: "completed", prizePoolSnapshot: expect.any(Object) });
    // The finalize warnings are the TD's bookkeeping (unconfirmed payments, discarded requests): staff only (P2REV1-MONEY-02).
    expect(detail.body.prizePoolSnapshot).not.toHaveProperty("warnings");
    expect(Object.keys(detail.body.prizePoolSnapshot).sort()).toEqual([...PUBLIC_SNAPSHOT_FIELDS].sort());
    expect(leaderboard.body.length).toBeGreaterThanOrEqual(3);
    expect(activity.body.map((entry: { eventType: string }) => entry.eventType)).toEqual(
      expect.arrayContaining(["elimination", "prize_pool_adjusted"]),
    );
  });
});

describe("viewer.canManage on the club and tournament reads the client builds staff controls from", () => {
  const expected: Record<Visitor, boolean> = {
    anonymous: false,
    stranger: false,
    deactivated: false,
    manager: true,
    owner: true,
    admin: true,
  };

  it.each(Object.entries(expected))("is %s → %s", async (visitor, canManage) => {
    const agent = await agentFor(visitor as Visitor, world.staff);
    const { club, live } = world;

    const [clubs, byId, bySlug, tournament] = await Promise.all([
      agent.get("/api/clubs"),
      agent.get(`/api/clubs/${club.id}`),
      agent.get(`/api/clubs/slug/${club.slug}`),
      agent.get(`/api/tournaments/${live.id}`),
    ]);

    const viewer = { canManage, canOwn: visitor === "owner" || visitor === "admin" };
    expect(clubs.body.find((row: { id: string }) => row.id === club.id)?.viewer).toEqual(viewer);
    for (const response of [byId, bySlug, tournament]) expect(response.body.viewer).toEqual(viewer);
  });
});

describe("GET /api/auth/me (the caller's own account)", () => {
  it("tells an anonymous caller nothing", async () => {
    const response = await (await agentFor("anonymous", world.staff)).get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(world.secrets.filter((secret) => JSON.stringify(response.body).includes(secret))).toEqual([]);
  });

  it("gives a signed-in user their own details only, never a password hash", async () => {
    const { owner, manager } = world.staff;

    const response = await owner.agent.get("/api/auth/me");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: owner.user.id, email: owner.user.email });
    const text = JSON.stringify(response.body);
    expect(text).not.toMatch(/passwordHash|password_hash/);
    expect(text).not.toContain(manager.user.email);
  });
});
