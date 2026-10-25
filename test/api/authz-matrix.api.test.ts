/**
 * Who may call each API route that changes something, or that only some people may read (contract
 * §1.1, §2.16). The routes come from the running app's router stack (test/helpers/routes.ts), so:
 *
 * - a write with no guard fails "every write carries a guard";
 * - a write or guarded read without a row in ROUTES, or whose guards differ from its row, fails the
 *   inventory test. A new route therefore cannot ship without a row here.
 *
 * Each row runs once per kind of visitor to a club: nobody signed in, a signed-in stranger, the club's
 * manager and owner, a platform admin, and a manager whose account was deactivated after they signed
 * in. Every request acts on resources made for it alone, in a club of its own. Rows for a resource
 * also check that a missing one is a 404 for an admin, and a 401 to an anonymous caller before
 * anything is looked up (a public route answers that 404 to anyone).
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clubStaffInvites, pendingActions, type Club } from "@shared/schema";
import { clubFrom, requireAuth, requireClubManager } from "../../server/http/authz";
import { createClub, createPlayer, createPointsSystem, createSeason, createUser, FACTORY_PASSWORD, uniqueSuffix } from "../factories";
import { createClubManager } from "../factories/club-managers";
import { getApp, signIn, testDb, UNKNOWN_ID } from "../helpers";
import {
  adminOnly,
  everyone,
  ownerOf,
  registeredPlayer,
  signedIn,
  single,
  staffOf,
  tournamentIn,
  type Call,
  type Context,
  type RouteRow,
} from "../helpers/authz-matrix";
import { CLOCK_ROUTE_ROWS } from "../helpers/authz-rows-clock";
import { MONEY_ROUTE_ROWS } from "../helpers/authz-rows-money";
import { SEATING_ROUTE_ROWS } from "../helpers/authz-rows-seating";
import { agentFor, clubWithStaff, VISITORS, type ClubStaffAgents } from "../helpers/club-staff";
import { solidImage } from "../helpers/images";
import { appRoutes, isWrite, type HttpMethod } from "../helpers/routes";
import { signUpTokenFor } from "../helpers/sign-up";

/** The deliberately public writes (contract §2.16): narrow bodies, server-side rules, their own limits. */
const PUBLIC_WRITES = [
  "POST /api/auth/register",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/players",
  "POST /api/tournaments/:id/registrations",
  "POST /api/tournaments/:id/pending-actions",
  "POST /api/images/:kind",
  "POST /api/upload/public",
];

async function clubRunBy(staff: ClubStaffAgents): Promise<Club> {
  const club = await createClub({ ownerId: staff.owner.user.id });
  await createClubManager({ clubId: club.id, userId: staff.manager.user.id });
  await createClubManager({ clubId: club.id, userId: staff.deactivated.user.id });
  return club;
}

async function registrationIn(club: Club) {
  return (await registeredPlayer(await tournamentIn(club))).registration;
}

async function pendingActionIn(club: Club) {
  const { player, registration } = await registeredPlayer(await tournamentIn(club, { status: "in_progress" }));
  const [action] = await testDb()
    .insert(pendingActions)
    .values({ tournamentId: registration.tournamentId, playerId: player.id, actionType: "addon" })
    .returning();
  return action;
}

let phoneNumbers = 0;
const newPhone = () => `021 555 ${String(++phoneNumbers).padStart(4, "0")}`;

const ROUTES: Record<string, RouteRow> = {
  // Auth: sign-up, sign-in and sign-out are open to anyone, even over a session that no longer counts.
  "POST /api/auth/register": {
    guards: ["public:sign-up"],
    cases: single(everyone(201), () => ({
      path: "/api/auth/register",
      json: { email: `matrix-${uniqueSuffix()}@example.test`, password: FACTORY_PASSWORD, name: "Matrix Visitor" },
    })),
  },
  "POST /api/auth/login": {
    guards: ["public:sign-in"],
    cases: single(everyone(200), async () => ({
      path: "/api/auth/login",
      json: { email: (await createUser()).email, password: FACTORY_PASSWORD },
    })),
  },
  "POST /api/auth/logout": {
    guards: ["public:sign-out"],
    cases: single(everyone(200), () => ({ path: "/api/auth/logout" })),
  },
  "PUT /api/auth/profile": {
    guards: ["auth"],
    cases: single(signedIn(200), ({ user }) => ({
      path: "/api/auth/profile",
      json: { name: "Renamed Visitor", email: user?.email ?? "nobody@example.test" },
    })),
  },
  "POST /api/auth/change-password": {
    guards: ["auth"],
    cases: single(signedIn(200), () => ({
      path: "/api/auth/change-password",
      json: { currentPassword: FACTORY_PASSWORD, newPassword: "Matrix-Pass2" },
    })),
  },

  // Platform admin.
  "GET /api/admin/users": { guards: ["admin"], cases: single(adminOnly(200), () => ({ path: "/api/admin/users" })) },
  "GET /api/admin/audit-log": { guards: ["admin"], cases: single(adminOnly(200), () => ({ path: "/api/admin/audit-log" })) },
  "PUT /api/admin/users/:userId": {
    guards: ["admin"],
    cases: single(adminOnly(200), async () => ({ path: `/api/admin/users/${(await createUser()).id}`, json: { name: "Renamed By Admin" } })),
    missing: () => ({ path: `/api/admin/users/${UNKNOWN_ID}`, json: { name: "Nobody" } }),
  },
  "POST /api/admin/users/:userId/impersonate": {
    guards: ["admin"],
    cases: single(adminOnly(200), async () => ({ path: `/api/admin/users/${(await createUser()).id}/impersonate` })),
    missing: () => ({ path: `/api/admin/users/${UNKNOWN_ID}/impersonate` }),
  },
  // Any signed-in user may ask (an impersonated user is not an admin); only an impersonation can be stopped.
  "POST /api/admin/stop-impersonation": {
    guards: ["auth"],
    cases: single({ ...signedIn(400), admin: 200 }, async ({ visitor, agent }) => {
      if (visitor === "admin") {
        const started = await agent.post(`/api/admin/users/${(await createUser()).id}/impersonate`);
        expect(started.status).toBe(200);
      }
      return { path: "/api/admin/stop-impersonation" };
    }),
  },

  // Images: anyone may upload a player photo (the QR page); every other kind needs a signed-in user.
  "POST /api/images/:kind": {
    guards: ["public:player photo"],
    cases: [
      { name: "a player photo", expect: everyone(201), call: () => ({ path: "/api/images/player_avatar", upload: {} }) },
      { name: "a club logo", expect: signedIn(201), call: () => ({ path: "/api/images/club_logo", upload: {} }) },
    ],
  },
  "POST /api/upload": {
    guards: ["auth"],
    cases: single(signedIn(200), () => ({ path: "/api/upload", upload: { entityType: "players" } })),
  },
  "POST /api/upload/public": {
    guards: ["public:player photo"],
    cases: single(everyone(200), () => ({ path: "/api/upload/public", upload: {} })),
  },

  // Clubs and their staff.
  "POST /api/clubs": {
    guards: ["auth"],
    cases: single(signedIn(201), () => ({ path: "/api/clubs", json: { name: "Matrix Club", slug: `matrix-club-${uniqueSuffix()}` } })),
  },
  "PUT /api/clubs/:id": {
    guards: ["club-manager:Club"],
    cases: single(staffOf(200), ({ club }) => ({ path: `/api/clubs/${club.id}`, json: { name: "Renamed Club" } })),
    missing: () => ({ path: `/api/clubs/${UNKNOWN_ID}`, json: { name: "Renamed Club" } }),
  },
  "DELETE /api/clubs/:id": {
    guards: ["club-owner:Club"],
    cases: single(ownerOf(204), ({ club }) => ({ path: `/api/clubs/${club.id}` })),
    missing: () => ({ path: `/api/clubs/${UNKNOWN_ID}` }),
  },
  "GET /api/clubs/:id/managers": {
    guards: ["club-owner:Club"],
    cases: single(ownerOf(200), ({ club }) => ({ path: `/api/clubs/${club.id}/managers` })),
    missing: () => ({ path: `/api/clubs/${UNKNOWN_ID}/managers` }),
  },
  "POST /api/clubs/:id/invites": {
    guards: ["club-owner:Club"],
    cases: single(ownerOf(201), ({ club }) => ({ path: `/api/clubs/${club.id}/invites`, json: { email: `invitee-${uniqueSuffix()}@example.test` } })),
    missing: () => ({ path: `/api/clubs/${UNKNOWN_ID}/invites`, json: { email: "invitee@example.test" } }),
  },
  "DELETE /api/clubs/:id/invites/:inviteId": {
    guards: ["club-owner:Club"],
    cases: single(ownerOf(200), async ({ club }) => {
      const [invite] = await testDb()
        .insert(clubStaffInvites)
        .values({ clubId: club.id, role: "manager", email: `invitee-${uniqueSuffix()}@example.test`, tokenHash: uniqueSuffix(), expiresAt: new Date(Date.now() + 60_000) })
        .returning();
      return { path: `/api/clubs/${club.id}/invites/${invite.id}` };
    }),
    missing: () => ({ path: `/api/clubs/${UNKNOWN_ID}/invites/${UNKNOWN_ID}` }),
  },
  "POST /api/staff-invites/accept": {
    guards: ["auth"],
    cases: single(signedIn(200), async ({ user }) => {
      // An invitation to a club of its own for this visitor's address, so each visitor can take it.
      const token = randomBytes(32).toString("base64url");
      const club = await createClub();
      await testDb()
        .insert(clubStaffInvites)
        .values({
          clubId: club.id,
          role: "manager",
          email: user?.email.trim().toLowerCase() ?? "nobody@example.test",
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 60_000),
        });
      return { path: "/api/staff-invites/accept", json: { token } };
    }),
  },
  "DELETE /api/clubs/:id/managers/:userId": {
    guards: ["club-owner:Club"],
    cases: single(ownerOf(200), async ({ club }) => {
      const manager = await createUser();
      await createClubManager({ clubId: club.id, userId: manager.id });
      return { path: `/api/clubs/${club.id}/managers/${manager.id}` };
    }),
    missing: () => ({ path: `/api/clubs/${UNKNOWN_ID}/managers/${UNKNOWN_ID}` }),
  },
  "PUT /api/clubs/:id/owner": {
    guards: ["admin"],
    cases: single(adminOnly(200), async ({ club }) => ({ path: `/api/clubs/${club.id}/owner`, json: { userId: (await createUser()).id } })),
    missing: async () => ({ path: `/api/clubs/${UNKNOWN_ID}/owner`, json: { userId: (await createUser()).id } }),
  },

  // Seasons and points systems.
  "POST /api/seasons": {
    guards: ["auth", "club-manager:Club"],
    cases: single(staffOf(201), ({ club }) => ({
      path: "/api/seasons",
      json: { clubId: club.id, name: "Matrix Season", startDate: "2026-01-01" },
    })),
    missing: () => ({ path: "/api/seasons", json: { clubId: UNKNOWN_ID, name: "Matrix Season", startDate: "2026-01-01" } }),
  },
  "PUT /api/seasons/:id": {
    guards: ["club-manager:Season"],
    cases: single(staffOf(200), async ({ club }) => ({
      path: `/api/seasons/${(await createSeason({ clubId: club.id })).id}`,
      json: { name: "Renamed Season" },
    })),
    missing: () => ({ path: `/api/seasons/${UNKNOWN_ID}`, json: { name: "Renamed Season" } }),
  },
  "DELETE /api/seasons/:id": {
    guards: ["club-owner:Season"],
    cases: single(ownerOf(204), async ({ club }) => ({ path: `/api/seasons/${(await createSeason({ clubId: club.id })).id}` })),
    missing: () => ({ path: `/api/seasons/${UNKNOWN_ID}` }),
  },
  "POST /api/seasons/:seasonId/points-systems": {
    guards: ["club-manager:Season"],
    cases: single(staffOf(201), async ({ club }) => ({
      path: `/api/seasons/${(await createSeason({ clubId: club.id })).id}/points-systems`,
      json: { name: "Matrix Points", allocations: [{ position: 1, points: 10 }] },
    })),
    missing: () => ({ path: `/api/seasons/${UNKNOWN_ID}/points-systems`, json: { name: "Matrix Points" } }),
  },
  "DELETE /api/points-systems/:id": {
    guards: ["club-manager:Points system"],
    cases: single(staffOf(204), async ({ club }) => {
      const system = await createPointsSystem({ seasonId: (await createSeason({ clubId: club.id })).id });
      return { path: `/api/points-systems/${system.id}` };
    }),
    missing: () => ({ path: `/api/points-systems/${UNKNOWN_ID}` }),
  },
  "POST /api/points-systems/:pointsSystemId/allocations": {
    guards: ["club-manager:Points system"],
    cases: single(staffOf(201), async ({ club }) => {
      const system = await createPointsSystem({ seasonId: (await createSeason({ clubId: club.id })).id });
      return { path: `/api/points-systems/${system.id}/allocations`, json: { position: 1, points: 10 } };
    }),
    missing: () => ({ path: `/api/points-systems/${UNKNOWN_ID}/allocations`, json: { position: 1, points: 10 } }),
  },

  // Players: the staff list, the QR sign-up, and edits by staff of a club the player has played at.
  "GET /api/players": { guards: ["auth"], cases: single(signedIn(200), () => ({ path: "/api/players" })) },
  "POST /api/players": {
    guards: ["public:QR sign-up"],
    cases: single(everyone(201), () => ({ path: "/api/players", json: { name: `Matrix Player ${uniqueSuffix()}`, phone: newPhone() } })),
  },
  "PUT /api/players/:id": {
    guards: ["player-manager"],
    cases: single(staffOf(200), async ({ club }) => {
      const { player } = await registeredPlayer(await tournamentIn(club));
      return { path: `/api/players/${player.id}`, json: { name: "Renamed Player" } };
    }),
    missing: () => ({ path: `/api/players/${UNKNOWN_ID}`, json: { name: "Renamed Player" } }),
  },

  // Tournaments, their prize pool and finalize.
  "POST /api/tournaments": {
    guards: ["auth", "club-manager:Club"],
    cases: single(staffOf(201), ({ club }) => ({
      path: "/api/tournaments",
      json: { clubId: club.id, name: "Matrix Tournament", startDateTime: "2026-03-01T19:00:00Z", buyInAmount: "50.00", maxPlayers: 20 },
    })),
    missing: () => ({
      path: "/api/tournaments",
      json: { clubId: UNKNOWN_ID, name: "Matrix Tournament", startDateTime: "2026-03-01T19:00:00Z", buyInAmount: "50.00", maxPlayers: 20 },
    }),
  },
  "PUT /api/tournaments/:id": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await tournamentIn(club)).id}`, json: { name: "Renamed Tournament" } })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}`, json: { name: "Renamed Tournament" } }),
  },
  "DELETE /api/tournaments/:id": {
    guards: ["club-owner:Tournament"],
    cases: single(ownerOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await tournamentIn(club)).id}` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}` }),
  },
  "PUT /api/tournaments/:id/prize-pool/adjustment": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({
      path: `/api/tournaments/${(await tournamentIn(club)).id}/prize-pool/adjustment`,
      json: { mode: "manual_pool", amount: "100.00" },
    })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/prize-pool/adjustment`, json: { mode: "manual_pool", amount: "100.00" } }),
  },
  "PUT /api/tournaments/:id/prize-pool/rates": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({
      path: `/api/tournaments/${(await tournamentIn(club)).id}/prize-pool/rates`,
      json: { rakeType: "percentage", rakeAmount: "10.00" },
    })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/prize-pool/rates`, json: { rakeType: "percentage", rakeAmount: "10.00" } }),
  },
  "POST /api/tournaments/:id/finalize/preview": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => {
      const tournament = await tournamentIn(club, { status: "in_progress" });
      await registeredPlayer(tournament);
      return { path: `/api/tournaments/${tournament.id}/finalize/preview`, json: {} };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/finalize/preview`, json: {} }),
  },
  "POST /api/tournaments/:id/finalize": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club, staff }) => {
      const tournament = await tournamentIn(club, { status: "in_progress" });
      // Paid: finalize refuses while anyone in the field has not paid (round 6).
      await registeredPlayer(tournament, { paymentConfirmed: true });
      await registeredPlayer(tournament, { isEliminated: true, minutesIn: 40, paymentConfirmed: true });
      await registeredPlayer(tournament, { isEliminated: true, minutesIn: 20, paymentConfirmed: true });
      const preview = await staff.admin.agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});
      expect(preview.body).toMatchObject({ ok: true, planHash: expect.any(String) });
      return { path: `/api/tournaments/${tournament.id}/finalize`, json: { expectedPlanHash: preview.body.planHash } };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/finalize`, json: {} }),
  },

  // Registrations: the public sign-up, and the staff's edits and payment desk.
  "POST /api/tournaments/:id/registrations": {
    guards: ["public:QR sign-up"],
    cases: single(everyone(201), async ({ club }) => {
      const player = await createPlayer();
      return {
        path: `/api/tournaments/${(await tournamentIn(club)).id}/registrations`,
        json: { playerId: player.id, signUpToken: signUpTokenFor(player.id) },
      };
    }),
    missing: async () => ({ path: `/api/tournaments/${UNKNOWN_ID}/registrations`, json: { playerId: (await createPlayer()).id } }),
  },
  "DELETE /api/registrations/:id": {
    guards: ["club-manager:Registration"],
    cases: single(staffOf(204), async ({ club }) => ({ path: `/api/registrations/${(await registrationIn(club)).id}` })),
    missing: () => ({ path: `/api/registrations/${UNKNOWN_ID}` }),
  },
  "PUT /api/registrations/:id": {
    guards: ["club-manager:Registration"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/registrations/${(await registrationIn(club)).id}`, json: { paymentConfirmed: true } })),
    missing: () => ({ path: `/api/registrations/${UNKNOWN_ID}`, json: { paymentConfirmed: true } }),
  },
  "POST /api/registrations/:id/counts": {
    guards: ["club-manager:Registration"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/registrations/${(await registrationIn(club)).id}/counts`, json: { rebuys: 1 } })),
    missing: () => ({ path: `/api/registrations/${UNKNOWN_ID}/counts`, json: { rebuys: 1 } }),
  },
  "PATCH /api/registrations/:id/confirm-payment": {
    guards: ["club-manager:Registration"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/registrations/${(await registrationIn(club)).id}/confirm-payment` })),
    missing: () => ({ path: `/api/registrations/${UNKNOWN_ID}/confirm-payment` }),
  },
  "GET /api/tournaments/:id/pending-registrations": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await registrationIn(club)).tournamentId}/pending-registrations` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/pending-registrations` }),
  },
  "GET /api/tournaments/:id/confirmed-registrations": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await registrationIn(club)).tournamentId}/confirmed-registrations` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/confirmed-registrations` }),
  },

  // Player requests: anyone may ask; the tournament's staff see, confirm or dismiss them.
  "GET /api/tournaments/:id/pending-actions": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await pendingActionIn(club)).tournamentId}/pending-actions` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/pending-actions` }),
  },
  "POST /api/tournaments/:id/pending-actions": {
    guards: ["public:player request"],
    cases: single(everyone(201), async ({ club }) => {
      const { player, registration } = await registeredPlayer(await tournamentIn(club, { status: "in_progress" }));
      return { path: `/api/tournaments/${registration.tournamentId}/pending-actions`, json: { playerId: player.id, actionType: "addon" } };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/pending-actions`, json: { playerId: UNKNOWN_ID, actionType: "addon" } }),
  },
  "POST /api/pending-actions/:id/confirm": {
    guards: ["club-manager:Pending action"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/pending-actions/${(await pendingActionIn(club)).id}/confirm` })),
    missing: () => ({ path: `/api/pending-actions/${UNKNOWN_ID}/confirm` }),
  },
  "DELETE /api/pending-actions/:id": {
    guards: ["club-manager:Pending action"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/pending-actions/${(await pendingActionIn(club)).id}` })),
    missing: () => ({ path: `/api/pending-actions/${UNKNOWN_ID}` }),
  },

  "GET /api/dashboard/stats": { guards: ["auth"], cases: single(signedIn(200), () => ({ path: "/api/dashboard/stats" })) },

  // Phase 4: each domain keeps its rows beside its routes' contract.
  ...SEATING_ROUTE_ROWS,
  ...CLOCK_ROUTE_ROWS,
  ...MONEY_ROUTE_ROWS,
};

let uploadDir: string;
let png: Buffer;

beforeAll(async () => {
  // Before the app is first built: uploads in this file land here, never in the repo's uploads/.
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "pokerpal-authz-matrix-"));
  process.env.UPLOAD_DIR = uploadDir;
  png = await solidImage(64, 64);
});

afterAll(async () => {
  delete process.env.UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

function start(agent: request.Agent, method: HttpMethod, url: string): request.Test {
  switch (method) {
    case "GET":
      return agent.get(url);
    case "POST":
      return agent.post(url);
    case "PUT":
      return agent.put(url);
    case "PATCH":
      return agent.patch(url);
    case "DELETE":
      return agent.delete(url);
  }
}

function send(agent: request.Agent, method: HttpMethod, call: Call): request.Test {
  const test = start(agent, method, call.path);
  if (call.upload) {
    const withFields = Object.entries(call.upload).reduce((pending, [name, value]) => pending.field(name, value), test);
    return withFields.attach("image", png, { filename: "photo.png", contentType: "image/png" });
  }
  return method === "GET" ? test : test.send(call.json ?? {});
}

const methodOf = (key: string) => key.split(" ", 1)[0] as HttpMethod;

describe("the route inventory", () => {
  it("reads every route, nested routers included, with the guards each mounts", () => {
    const app = express();
    const inner = express.Router();
    inner.post("/api/unguarded", (_req, res) => res.end());
    inner.put("/api/guarded", requireAuth, requireClubManager(clubFrom.tournament()), (_req, res) => res.end());
    app.use(inner);
    app.get("/api/open", (_req, res) => res.end());

    expect(appRoutes(app)).toEqual([
      { method: "POST", path: "/api/unguarded", key: "POST /api/unguarded", guards: [] },
      { method: "PUT", path: "/api/guarded", key: "PUT /api/guarded", guards: ["auth", "club-manager:Tournament"] },
      { method: "GET", path: "/api/open", key: "GET /api/open", guards: [] },
    ]);
  });

  it("guards every write, and leaves open to anyone only the contract's public writes (§2.16)", async () => {
    const writes = appRoutes(await getApp()).filter(isWrite);

    expect(writes.filter((route) => route.guards.length === 0).map((route) => route.key)).toEqual([]);
    expect(writes.filter((route) => route.guards.some((guard) => guard.startsWith("public:"))).map((route) => route.key).sort()).toEqual(
      [...PUBLIC_WRITES].sort(),
    );
  });

  it("has a row below for every write and every guarded read, with the guards the route mounts", async () => {
    const routes = appRoutes(await getApp()).filter((route) => isWrite(route) || route.guards.length > 0);

    expect(routes.map((route) => route.key).sort()).toEqual(Object.keys(ROUTES).sort());
    for (const route of routes) expect(route.guards, route.key).toEqual(ROUTES[route.key]?.guards);
  });
});

describe.each(Object.entries(ROUTES))("%s", (key, row) => {
  const method = methodOf(key);
  let staff: ClubStaffAgents;

  beforeAll(async () => {
    staff = await clubWithStaff();
  });

  for (const { name, expect: statuses, call } of row.cases) {
    it.each(VISITORS)(`${name ? `${name}: ` : ""}%s gets the expected status`, async (visitor) => {
      const agent = await agentFor(visitor, staff);
      const user = visitor === "anonymous" ? null : staff[visitor].user;
      const ctx: Context = { staff, club: await clubRunBy(staff), visitor, user, agent };

      const response = await send(agent, method, await call(ctx));

      expect(response.status, JSON.stringify(response.body)).toBe(statuses[visitor]);
    });
  }

  const missing = row.missing;
  if (missing) {
    const isPublic = row.guards.every((guard) => guard.startsWith("public:"));

    it(`answers a missing resource with 404 to an admin, and ${isPublic ? "404" : "401 (before looking)"} to an anonymous caller`, async () => {
      // A new admin: the row's own may be impersonating someone by now.
      const asAdmin = await send((await signIn({ role: "admin" })).agent, method, await missing());
      const asAnonymous = await send(await agentFor("anonymous", staff), method, await missing());

      expect(asAdmin.status, JSON.stringify(asAdmin.body)).toBe(404);
      expect(asAnonymous.status, JSON.stringify(asAnonymous.body)).toBe(isPublic ? 404 : 401);
    });
  }
});
