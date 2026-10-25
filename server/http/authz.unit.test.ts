import express, { type Express, type RequestHandler } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asyncHandler } from "./async-handler";
import { allowPublic, createAuthz, guardedClubId, guardOf, type AuthUser, type AuthzStore, type ClubRole } from "./authz";
import { errorHandler } from "./errors";

/**
 * An in-memory AuthzStore: users, club roles and which club each resource belongs to. Each test
 * builds the app with a fake session (header x-user) so no session store is needed.
 */
interface World {
  users: Map<string, AuthUser & { isActive: boolean }>;
  roles: Map<string, ClubRole>; // `${userId}:${clubId}`
  resources: Map<string, string>; // `${kind}:${id}` → clubId
  /** Each player's home club (their first registration's); null when they never registered. */
  playerHomes: Map<string, string | null>;
}

let world: World;
let calls: Record<keyof AuthzStore, number>;

const store: AuthzStore = {
  async findActiveUser(id) {
    calls.findActiveUser++;
    const user = world.users.get(id);
    return user && user.isActive ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
  },
  async clubRole(userId, clubId) {
    calls.clubRole++;
    return world.roles.get(`${userId}:${clubId}`) ?? null;
  },
  async managedClubIds(userId) {
    calls.managedClubIds++;
    return Array.from(world.roles.keys())
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => key.split(":")[1]);
  },
  async clubIdOf(kind, id) {
    calls.clubIdOf++;
    return world.resources.get(`${kind}:${id}`) ?? null;
  },
  async playerHomeClub(playerId) {
    calls.playerHomeClub++;
    const home = world.playerHomes.get(playerId);
    return home === undefined ? null : { homeClubId: home };
  },
};

const authz = createAuthz(store);

function addUser(id: string, role = "full_member", isActive = true) {
  world.users.set(id, { id, email: `${id}@example.test`, name: id, role, isActive });
}

beforeEach(() => {
  world = { users: new Map(), roles: new Map(), resources: new Map(), playerHomes: new Map() };
  calls = { findActiveUser: 0, clubRole: 0, managedClubIds: 0, clubIdOf: 0, playerHomeClub: 0 };
  addUser("admin", "admin");
  addUser("owner");
  addUser("manager");
  addUser("stranger");
  addUser("demoted-admin");
  addUser("disabled", "admin", false);
  world.roles.set("owner:club-1", "owner");
  world.roles.set("manager:club-1", "manager");
  world.resources.set("club:club-1", "club-1");
  world.resources.set("tournament:t-1", "club-1");
  world.resources.set("registration:r-1", "club-1");
  world.resources.set("season:s-1", "club-1");
  world.resources.set("pointsSystem:ps-1", "club-1");
  world.resources.set("pendingAction:pa-1", "club-1");
  world.playerHomes.set("p-1", "club-1");
  world.playerHomes.set("p-visitor", "club-2");
  world.playerHomes.set("p-new", null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fake session middleware: the x-user header plays the role of the session's userId. */
const fakeSession: RequestHandler = (req, _res, next) => {
  const userId = req.get("x-user");
  Object.assign(req, { session: userId ? { userId, originalAdminId: req.get("x-impersonator") } : undefined });
  next();
};

function appWith(path: string, ...guards: RequestHandler[]): Express {
  const app = express();
  app.use(express.json());
  app.use(fakeSession, authz.loadUser);
  app.all(
    path,
    ...guards,
    asyncHandler(async (req, res) => {
      res.json({ user: req.user?.id ?? null, impersonatorId: req.impersonatorId ?? null, clubId: res.locals.clubId ?? null });
    }),
  );
  app.use(errorHandler);
  return app;
}

const as = (userId: string | null) => (userId ? { "x-user": userId } : {});

describe("loadUser", () => {
  it("attaches the session's active user, as read from the store", async () => {
    const response = await request(appWith("/")).get("/").set(as("owner"));

    expect(response.body.user).toBe("owner");
  });

  it("continues anonymously for a deactivated or deleted user, leaving the session for sign-in to replace", async () => {
    const destroyed = vi.fn();
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { session: { userId: req.get("x-user"), destroy: destroyed } });
      next();
    }, authz.loadUser);
    app.get("/", (req, res) => {
      res.json({ user: req.user ?? null, sessionUserId: req.session.userId });
    });

    for (const userId of ["disabled", "gone"]) {
      const response = await request(app).get("/").set(as(userId));

      expect(response.body).toEqual({ user: null, sessionUserId: userId });
    }
    expect(destroyed).not.toHaveBeenCalled();
  });

  it("records the impersonating admin", async () => {
    const response = await request(appWith("/")).get("/").set({ ...as("stranger"), "x-impersonator": "admin" });

    expect(response.body).toMatchObject({ user: "stranger", impersonatorId: "admin" });
  });
});

describe("requireAuth / requireAdmin", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("requireAuth: 401 anonymous, deactivated or deleted; any active user passes", async () => {
    const app = appWith("/", authz.requireAuth);

    expect((await request(app).get("/")).status).toBe(401);
    expect((await request(app).get("/").set(as("disabled"))).status).toBe(401);
    expect((await request(app).get("/").set(as("gone"))).status).toBe(401);
    expect((await request(app).get("/").set(as("stranger"))).status).toBe(200);
  });

  it("requireAdmin reads the role from the store on every request, never the session's copy", async () => {
    const app = appWith("/", authz.requireAdmin);

    expect((await request(app).get("/")).body).toEqual({ error: "Authentication required", code: "UNAUTHENTICATED" });
    expect((await request(app).get("/").set(as("admin"))).status).toBe(200);
    const refused = await request(app).get("/").set(as("demoted-admin"));
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "Admin access required", code: "FORBIDDEN" });
    expect((await request(app).get("/").set(as("disabled"))).status).toBe(401);
  });
});

describe("requireClubManager", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it.each([
    ["club", "/clubs/club-1", authz.clubFrom.club()],
    ["tournament", "/tournaments/t-1", authz.clubFrom.tournament()],
    ["registration", "/registrations/r-1", authz.clubFrom.registration()],
    ["season", "/seasons/s-1", authz.clubFrom.season()],
    ["points system", "/points-systems/ps-1", authz.clubFrom.pointsSystem()],
    ["pending action", "/pending-actions/pa-1", authz.clubFrom.pendingAction()],
  ])("lets the admin, owner and managers of a %s's club through, and refuses everyone else", async (_kind, url, resolver) => {
    const app = appWith(url.replace(/[^/]+$/, ":id"), authz.requireClubManager(resolver));

    for (const userId of ["admin", "owner", "manager"]) {
      const response = await request(app).post(url).set(as(userId));
      expect(response.status).toBe(200);
      expect(response.body.clubId).toBe("club-1");
    }
    expect((await request(app).post(url).set(as("stranger"))).status).toBe(403);
    expect((await request(app).post(url).set(as("demoted-admin"))).status).toBe(403);
    expect((await request(app).post(url)).status).toBe(401);
  });

  it("answers 404 naming the resource when it does not exist, and 401 first for anonymous callers", async () => {
    const app = appWith("/tournaments/:id", authz.requireClubManager(authz.clubFrom.tournament()));

    const missing = await request(app).post("/tournaments/nope").set(as("owner"));
    const anonymous = await request(app).post("/tournaments/nope");

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
    expect(anonymous.status).toBe(401);
    expect(calls.clubIdOf).toBe(1);
  });

  it("resolves a club named in the body", async () => {
    const app = appWith("/tournaments", authz.requireClubManager(authz.clubFrom.body()));

    expect((await request(app).post("/tournaments").set(as("manager")).send({ clubId: "club-1" })).status).toBe(200);
    expect((await request(app).post("/tournaments").set(as("stranger")).send({ clubId: "club-1" })).status).toBe(403);
    expect((await request(app).post("/tournaments").set(as("owner")).send({ clubId: "club-9" })).status).toBe(404);
    expect((await request(app).post("/tournaments").set(as("owner")).send({ clubId: 7 })).status).toBe(404);
  });

  it("looks a user's role in a club up once per request", async () => {
    const app = appWith(
      "/tournaments/:id",
      authz.requireClubManager(authz.clubFrom.tournament()),
      authz.requireClubManager(authz.clubFrom.tournament()),
    );

    await request(app).post("/tournaments/t-1").set(as("manager"));
    await request(app).post("/tournaments/t-1").set(as("manager"));

    expect(calls.clubRole).toBe(2);
  });
});

describe("requireClubManagerOr", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  /** A stand-in credential: the x-key header "good" for tournament t-1. */
  const key = {
    name: "test key",
    accepts: async (req: express.Request) => req.get("x-key") === "good" && req.params.id === "t-1",
  };

  it("lets a request carrying the credential through without a session", async () => {
    const app = appWith("/tournaments/:id", authz.requireClubManagerOr(key, authz.clubFrom.tournament()));

    const response = await request(app).post("/tournaments/t-1").set("x-key", "good");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null, impersonatorId: null, clubId: null });
  });

  it("is requireClubManager for everyone else: 401 before looking, 404, 403, and staff through", async () => {
    const app = appWith("/tournaments/:id", authz.requireClubManagerOr(key, authz.clubFrom.tournament()));

    expect((await request(app).post("/tournaments/t-1").set("x-key", "bad")).status).toBe(401);
    expect((await request(app).post("/tournaments/nope").set("x-key", "good")).status).toBe(401);
    expect(calls.clubIdOf).toBe(0);
    expect((await request(app).post("/tournaments/nope").set(as("owner"))).status).toBe(404);
    expect((await request(app).post("/tournaments/t-1").set(as("stranger"))).status).toBe(403);
    const manager = await request(app).post("/tournaments/t-1").set(as("manager")).set("x-key", "bad");
    expect(manager.status).toBe(200);
    expect(manager.body.clubId).toBe("club-1");
  });

  it("is named for the route inventory with its credential", () => {
    expect(guardOf(authz.requireClubManagerOr(key, authz.clubFrom.tournament()))).toEqual({ kind: "club-manager", detail: "Tournament or test key" });
  });
});

describe("requireClubOwner", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("lets only the admin and the owner through: managers cannot delete or change staff", async () => {
    const app = appWith("/clubs/:id", authz.requireClubOwner(authz.clubFrom.club()));

    expect((await request(app).delete("/clubs/club-1").set(as("admin"))).status).toBe(200);
    expect((await request(app).delete("/clubs/club-1").set(as("owner"))).status).toBe(200);
    const manager = await request(app).delete("/clubs/club-1").set(as("manager"));
    expect(manager.status).toBe(403);
    expect(manager.body.error).toBe("Only the club's owner or an admin can do that");
    expect((await request(app).delete("/clubs/club-9").set(as("owner"))).status).toBe(404);
  });
});

describe("requirePlayerManager", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("lets through the admin and staff of the player's home club", async () => {
    const app = appWith("/players/:id", authz.requirePlayerManager());

    expect((await request(app).put("/players/p-1").set(as("manager"))).status).toBe(200);
    expect((await request(app).put("/players/p-1").set(as("owner"))).status).toBe(200);
    expect((await request(app).put("/players/p-1").set(as("admin"))).status).toBe(200);
    expect((await request(app).put("/players/p-1").set(as("stranger"))).status).toBe(403);
    expect((await request(app).put("/players/p-1")).status).toBe(401);
    expect((await request(app).put("/players/missing").set(as("owner"))).status).toBe(404);
  });

  it("refuses staff of a club the player only visited: a later registration grants nothing (SEC-P2-01)", async () => {
    const app = appWith("/players/:id", authz.requirePlayerManager());

    expect((await request(app).put("/players/p-visitor").set(as("owner"))).status).toBe(403);
    expect((await request(app).put("/players/p-visitor").set(as("admin"))).status).toBe(200);
  });

  it("leaves a player who never registered anywhere to admins", async () => {
    const app = appWith("/players/:id", authz.requirePlayerManager());

    expect((await request(app).put("/players/p-new").set(as("owner"))).status).toBe(403);
    expect((await request(app).put("/players/p-new").set(as("admin"))).status).toBe(200);
  });
});

describe("helpers for handlers", () => {
  const user = (id: string, role = "full_member"): AuthUser => ({ id, email: `${id}@x`, name: id, role });

  it("canManageClub / canOwnClub", async () => {
    expect(await authz.canManageClub(undefined, "club-1")).toBe(false);
    expect(await authz.canManageClub(user("manager"), "club-1")).toBe(true);
    expect(await authz.canManageClub(user("manager"), "club-2")).toBe(false);
    expect(await authz.canManageClub(user("anyone", "admin"), "club-2")).toBe(true);
    expect(await authz.canOwnClub(user("manager"), "club-1")).toBe(false);
    expect(await authz.canOwnClub(user("owner"), "club-1")).toBe(true);
  });

  it("clubScope: every club for an admin, else the owned and managed ones", async () => {
    expect(await authz.clubScope(user("x", "admin"))).toEqual({ all: true });
    expect(await authz.clubScope(user("owner"))).toEqual({ all: false, clubIds: ["club-1"] });
    expect(await authz.clubScope(user("stranger"))).toEqual({ all: false, clubIds: [] });
  });

  it("viewersFor answers for many clubs with one lookup, owners from the rows", async () => {
    const forManager = await authz.viewersFor({ user: user("manager") } as express.Request);
    const forOwner = await authz.viewersFor({ user: user("owner") } as express.Request);
    const forAnonymous = await authz.viewersFor({} as express.Request);
    const forAdmin = await authz.viewersFor({ user: user("x", "admin") } as express.Request);
    const club1 = { id: "club-1", ownerId: "owner" };
    const club2 = { id: "club-2", ownerId: null };

    expect([forManager(club1), forManager(club2)]).toEqual([
      { canManage: true, canOwn: false },
      { canManage: false, canOwn: false },
    ]);
    expect(forOwner(club1)).toEqual({ canManage: true, canOwn: true });
    expect(forAnonymous(club1)).toEqual({ canManage: false, canOwn: false });
    expect(forAdmin(club2)).toEqual({ canManage: true, canOwn: true });
    expect(calls.managedClubIds).toBe(2);
  });

  it("viewerFor gives the response's viewer block: managers manage, only owners and admins own (TN-09)", async () => {
    expect(await authz.viewerFor({ user: user("owner") } as express.Request, "club-1")).toEqual({ canManage: true, canOwn: true });
    expect(await authz.viewerFor({ user: user("manager") } as express.Request, "club-1")).toEqual({ canManage: true, canOwn: false });
    expect(await authz.viewerFor({ user: user("x", "admin") } as express.Request, "club-1")).toEqual({ canManage: true, canOwn: true });
    expect(await authz.viewerFor({} as express.Request, "club-1")).toEqual({ canManage: false, canOwn: false });
  });

  it("guardedClubId refuses to guess when no club guard ran", () => {
    expect(() => guardedClubId({ locals: {} } as express.Response)).toThrow(/without a club guard/);
    expect(guardedClubId({ locals: { clubId: "club-1" } } as unknown as express.Response)).toBe("club-1");
  });
});

describe("guard tags, for the route inventory", () => {
  it("names what each guard enforces", () => {
    expect(guardOf(authz.requireAuth)).toEqual({ kind: "auth" });
    expect(guardOf(authz.requireAdmin)).toEqual({ kind: "admin" });
    expect(guardOf(authz.requireClubManager(authz.clubFrom.season()))).toEqual({ kind: "club-manager", detail: "Season" });
    expect(guardOf(authz.requireClubOwner(authz.clubFrom.club()))).toEqual({ kind: "club-owner", detail: "Club" });
    expect(guardOf(authz.requirePlayerManager())).toEqual({ kind: "player-manager" });
    expect(guardOf(allowPublic("QR sign-up"))).toEqual({ kind: "public", detail: "QR sign-up" });
    expect(guardOf(authz.loadUser)).toBeUndefined();
    expect(guardOf("not a function")).toBeUndefined();
  });

  it("allowPublic lets every request through", async () => {
    const response = await request(appWith("/", allowPublic("test"))).post("/");

    expect(response.status).toBe(200);
  });
});
