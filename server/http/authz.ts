import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  clubManagers,
  clubs,
  pendingActions,
  players,
  pointsSystems,
  seasons,
  tournamentRegistrations,
  tournaments,
  users,
} from "@shared/schema";
import type { Viewer } from "@shared/api/common";
import { db, type Database } from "../db";
import { homeClubIds } from "../repositories/players";
import { asyncHandler } from "./async-handler";
import { forbidden, notFound, unauthenticated } from "./errors";

/**
 * Who may do what. A request's user is loaded from the database once (`loadUser`), so a demoted or
 * deactivated account loses access on its next request (SEC-11). A club may be managed by a platform
 * admin, its owner (clubs.owner_id) or one of its managers (club_managers); every staff write checks
 * that for the club the resource belongs to. Deleting a club, season or tournament and changing a
 * club's staff need the owner (or an admin).
 *
 * Players are global, and anyone can open an account and create a club, so a club reaches a player's
 * contact details and edits their record only as the player's home club: the club that added them
 * (POST /api/players with a clubId or tournamentId), else the club of their first surviving
 * registration, recorded once in player_home_clubs. Nothing done later moves it: not a registration
 * elsewhere (by staff or anonymously), and not deleting that club's tournaments or the club itself,
 * after which the player is admins' only (SEC-P2-01, P2REV0-01, P2REV0-SEC-03).
 */

/** The signed-in user, as handlers see it. Only active users are ever attached. */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** The admin behind the session while they impersonate `user`. */
      impersonatorId?: string;
    }
  }
}

export type ClubRole = "owner" | "manager";

/** The things a staff route can act on, each belonging to exactly one club. */
export type ClubResourceKind = "club" | "tournament" | "registration" | "season" | "pointsSystem" | "pendingAction";

/** The queries authorization needs. The default implementation is `createDbAuthzStore`. */
export interface AuthzStore {
  /** The user if they exist and are active, else null. */
  findActiveUser(id: string): Promise<AuthUser | null>;
  /** The user's role in the club, or null (also when the club does not exist). */
  clubRole(userId: string, clubId: string): Promise<ClubRole | null>;
  /** Every club the user owns or manages. */
  managedClubIds(userId: string): Promise<string[]>;
  /** The club a resource belongs to, or null when the resource does not exist. */
  clubIdOf(kind: ClubResourceKind, id: string): Promise<string | null>;
  /**
   * The player's recorded home club: the club that added them, else the club of their first surviving
   * registration (null when neither has happened; it may since have been deleted); null overall when
   * the player does not exist.
   */
  playerHomeClub(playerId: string): Promise<{ homeClubId: string | null } | null>;
}

/** Which clubs a list may show: every club (admins) or the listed ones. */
export type ClubScope = { all: true } | { all: false; clubIds: string[] };

/** Finds the club a request acts on; `resource` names it in the 404 ("Tournament not found"). */
export interface ClubResolver {
  resource: string;
  resolve(req: Request): Promise<string | null>;
}

/** What a guard middleware enforces, read by the route-inventory test (every write must have one). */
export interface GuardInfo {
  kind: "public" | "auth" | "admin" | "club-manager" | "club-owner" | "player-manager";
  detail?: string;
}

const GUARD = Symbol.for("pokerpal.guard");

function tagged<T extends RequestHandler>(handler: T, info: GuardInfo): T {
  Object.defineProperty(handler, GUARD, { value: info });
  return handler;
}

/** The guard a middleware enforces, if it is one of this module's. */
export function guardOf(handler: unknown): GuardInfo | undefined {
  return typeof handler === "function" ? (handler as unknown as Record<symbol, GuardInfo | undefined>)[GUARD] : undefined;
}

export const isAdmin = (user: AuthUser | undefined): boolean => user?.role === "admin";

/**
 * The signed-in user, for a handler behind requireAuth or a club guard: one way to read it, which
 * answers 401 rather than crashing should a route ever lose its guard.
 */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

/** The person at the keyboard: an impersonating admin, else the signed-in user (as audit_log records). */
export function actingUserId(req: Request): string | null {
  return req.impersonatorId ?? req.user?.id ?? null;
}

export function createAuthz(store: AuthzStore) {
  // Per-request memo: loadUser makes a new AuthUser object for every request, so this never outlives one.
  const roles = new WeakMap<AuthUser, Map<string, ClubRole | null>>();

  async function clubRoleOf(user: AuthUser, clubId: string): Promise<ClubRole | null> {
    let byClub = roles.get(user);
    if (!byClub) roles.set(user, (byClub = new Map()));
    if (!byClub.has(clubId)) byClub.set(clubId, await store.clubRole(user.id, clubId));
    return byClub.get(clubId) ?? null;
  }

  /** Admin, owner or manager of the club. */
  async function canManageClub(user: AuthUser | undefined, clubId: string): Promise<boolean> {
    if (!user) return false;
    return isAdmin(user) || (await clubRoleOf(user, clubId)) !== null;
  }

  /** Admin or owner of the club (not a manager). */
  async function canOwnClub(user: AuthUser | undefined, clubId: string): Promise<boolean> {
    if (!user) return false;
    return isAdmin(user) || (await clubRoleOf(user, clubId)) === "owner";
  }

  async function clubScope(user: AuthUser): Promise<ClubScope> {
    return isAdmin(user) ? { all: true } : { all: false, clubIds: await store.managedClubIds(user.id) };
  }

  /** `viewer` for a response about one club. Anonymous viewers manage and own nothing. */
  async function viewerFor(req: Request, clubId: string): Promise<Viewer> {
    const user = req.user;
    if (!user) return { canManage: false, canOwn: false };
    if (isAdmin(user)) return { canManage: true, canOwn: true };
    const role = await clubRoleOf(user, clubId);
    return { canManage: role !== null, canOwn: role === "owner" };
  }

  /** `viewer` for many clubs with at most one query, e.g. for GET /api/clubs (the rows carry their owner). */
  async function viewersFor(req: Request): Promise<(club: { id: string; ownerId: string | null }) => Viewer> {
    const user = req.user;
    if (!user) return () => ({ canManage: false, canOwn: false });
    if (isAdmin(user)) return () => ({ canManage: true, canOwn: true });
    const managed = new Set(await store.managedClubIds(user.id));
    return (club) => ({ canManage: managed.has(club.id), canOwn: club.ownerId === user.id });
  }

  /**
   * Admin, or manages the player's home club (the club that added them, else the club of their first
   * surviving registration, as recorded). Null when the player does not exist. A player with no home
   * club (added by no club and never registered) or whose home club was deleted can only be edited by
   * an admin. Registering a player elsewhere grants nothing.
   */
  async function canManagePlayer(user: AuthUser | undefined, playerId: string): Promise<boolean | null> {
    const found = await store.playerHomeClub(playerId);
    if (found === null) return null;
    if (!user) return false;
    if (isAdmin(user)) return true;
    return found.homeClubId !== null && (await canManageClub(user, found.homeClubId));
  }

  /** Every club the user owns or manages (GET /api/auth/me). */
  const managedClubIds = (userId: string): Promise<string[]> => store.managedClubIds(userId);

  /**
   * Mount once on /api, after the session middleware. Attaches the session's user if they exist and
   * are active (and the admin behind an impersonation); otherwise the request continues anonymously.
   * A session whose user was deleted or deactivated is left alone rather than destroyed here: that
   * would leave the request with no session at all, so a sign-in or sign-up on that same request
   * could not start one. Such a session authorizes nothing; GET /api/auth/me ends it, and demotion,
   * deactivation and password changes delete the affected sessions from the store (SEC-11).
   */
  const loadUser: RequestHandler = asyncHandler(async (req, _res, next) => {
    const userId = req.session?.userId;
    const user = userId ? await store.findActiveUser(userId) : null;
    if (user) {
      req.user = user;
      if (req.session.originalAdminId) req.impersonatorId = req.session.originalAdminId;
    }
    next();
  });

  const requireAuth = tagged<RequestHandler>((req, _res, next) => {
    next(req.user ? undefined : unauthenticated());
  }, { kind: "auth" });

  /** The role is the database's, as loaded by loadUser, never the session's copy. */
  const requireAdmin = tagged<RequestHandler>((req, _res, next) => {
    if (!req.user) return next(unauthenticated());
    next(isAdmin(req.user) ? undefined : forbidden("Admin access required"));
  }, { kind: "admin" });

  function clubGuard(resolver: ClubResolver, kind: "club-manager" | "club-owner"): RequestHandler {
    const allowed = kind === "club-owner" ? canOwnClub : canManageClub;
    const handler = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      // 401 before looking anything up, so anonymous callers cannot probe which ids exist.
      if (!req.user) throw unauthenticated();
      const clubId = await resolver.resolve(req);
      if (clubId === null) throw notFound(`${resolver.resource} not found`);
      if (!(await allowed(req.user, clubId))) {
        throw forbidden(
          kind === "club-owner"
            ? "Only the club's owner or an admin can do that"
            : `You don't have permission to manage this ${resolver.resource.toLowerCase()}`,
        );
      }
      res.locals.clubId = clubId;
      next();
    });
    return tagged(handler, { kind, detail: resolver.resource });
  }

  /** 401 anonymous, 404 when the resource is missing, 403 unless admin/owner/manager of its club. */
  const requireClubManager = (resolver: ClubResolver): RequestHandler => clubGuard(resolver, "club-manager");

  /** As requireClubManager, but managers are refused: for deletes and for changing the club's staff. */
  const requireClubOwner = (resolver: ClubResolver): RequestHandler => clubGuard(resolver, "club-owner");

  /** For PUT /api/players/:id: 401, 404 missing player, 403 unless canManagePlayer. */
  function requirePlayerManager(param = "id"): RequestHandler {
    const handler = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
      if (!req.user) throw unauthenticated();
      const allowed = await canManagePlayer(req.user, req.params[param]);
      if (allowed === null) throw notFound("Player not found");
      if (!allowed) throw forbidden("You don't have permission to manage this player");
      next();
    });
    return tagged(handler, { kind: "player-manager" });
  }

  const byParam = (kind: ClubResourceKind, resource: string) => (param = "id"): ClubResolver => ({
    resource,
    resolve: async (req) => {
      const id = req.params[param];
      return id ? store.clubIdOf(kind, id) : null;
    },
  });

  /** Resolvers for requireClubManager/requireClubOwner: where the club comes from. */
  const clubFrom = {
    club: byParam("club", "Club"),
    tournament: byParam("tournament", "Tournament"),
    registration: byParam("registration", "Registration"),
    season: byParam("season", "Season"),
    pointsSystem: byParam("pointsSystem", "Points system"),
    pendingAction: byParam("pendingAction", "Pending action"),
    /** A club id in the (already validated) body, e.g. POST /api/tournaments { clubId }. */
    body: (field = "clubId"): ClubResolver => ({
      resource: "Club",
      resolve: async (req) => {
        const value: unknown = (req.body as Record<string, unknown> | undefined)?.[field];
        return typeof value === "string" ? store.clubIdOf("club", value) : null;
      },
    }),
  };

  return {
    loadUser,
    requireAuth,
    requireAdmin,
    requireClubManager,
    requireClubOwner,
    requirePlayerManager,
    clubFrom,
    canManageClub,
    canOwnClub,
    canManagePlayer,
    viewersFor,
    clubScope,
    viewerFor,
    managedClubIds,
  };
}

export type Authz = ReturnType<typeof createAuthz>;

/**
 * Marks a deliberately public write (player self-service, sign-in), so the route inventory knows it is
 * not an oversight. Mount it with its limiter (publicWrite, or auth for sign-in and sign-up); the route
 * must use a narrow schema.
 */
export function allowPublic(reason: string): RequestHandler {
  return tagged<RequestHandler>((_req, _res, next) => next(), { kind: "public", detail: reason });
}

/** The club a club guard resolved for this request. */
export function guardedClubId(res: Response): string {
  const clubId: unknown = res.locals.clubId;
  if (typeof clubId !== "string") throw new Error("guardedClubId used on a route without a club guard");
  return clubId;
}

export function createDbAuthzStore(database: Database = db): AuthzStore {
  const first = async <T>(rows: Promise<T[]>): Promise<T | undefined> => (await rows)[0];

  return {
    async findActiveUser(id) {
      const row = await first(
        database
          .select({ id: users.id, email: users.email, role: users.role, name: users.name, isActive: users.isActive })
          .from(users)
          .where(eq(users.id, id))
          .limit(1),
      );
      // is_active is nullable; sign-in has always treated NULL as disabled, and so does this.
      if (!row || !row.isActive) return null;
      return { id: row.id, email: row.email, role: row.role, name: row.name };
    },

    async clubRole(userId, clubId) {
      const row = await first(
        database
          .select({ ownerId: clubs.ownerId, managerId: clubManagers.userId })
          .from(clubs)
          .leftJoin(clubManagers, and(eq(clubManagers.clubId, clubs.id), eq(clubManagers.userId, userId)))
          .where(eq(clubs.id, clubId))
          .limit(1),
      );
      if (!row) return null;
      if (row.ownerId === userId) return "owner";
      return row.managerId ? "manager" : null;
    },

    async managedClubIds(userId) {
      const owned = database.select({ clubId: clubs.id }).from(clubs).where(eq(clubs.ownerId, userId));
      const managed = database
        .select({ clubId: clubManagers.clubId })
        .from(clubManagers)
        .where(eq(clubManagers.userId, userId));
      const rows = await owned.union(managed);
      return rows.map((row) => row.clubId);
    },

    async clubIdOf(kind, id) {
      const row = await first(clubIdQuery(database, kind, id));
      return row?.clubId ?? null;
    },

    async playerHomeClub(playerId) {
      const player = await first(database.select({ id: players.id }).from(players).where(eq(players.id, playerId)).limit(1));
      if (!player) return null;
      return { homeClubId: (await homeClubIds(database, [playerId])).get(playerId) ?? null };
    },
  };
}

function clubIdQuery(database: Database, kind: ClubResourceKind, id: string): Promise<{ clubId: string }[]> {
  switch (kind) {
    case "club":
      return database.select({ clubId: clubs.id }).from(clubs).where(eq(clubs.id, id)).limit(1);
    case "tournament":
      return database.select({ clubId: tournaments.clubId }).from(tournaments).where(eq(tournaments.id, id)).limit(1);
    case "registration":
      return database
        .select({ clubId: tournaments.clubId })
        .from(tournamentRegistrations)
        .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
        .where(eq(tournamentRegistrations.id, id))
        .limit(1);
    case "season":
      return database.select({ clubId: seasons.clubId }).from(seasons).where(eq(seasons.id, id)).limit(1);
    case "pointsSystem":
      return database
        .select({ clubId: seasons.clubId })
        .from(pointsSystems)
        .innerJoin(seasons, eq(seasons.id, pointsSystems.seasonId))
        .where(eq(pointsSystems.id, id))
        .limit(1);
    case "pendingAction":
      return database
        .select({ clubId: tournaments.clubId })
        .from(pendingActions)
        .innerJoin(tournaments, eq(tournaments.id, pendingActions.tournamentId))
        .where(eq(pendingActions.id, id))
        .limit(1);
  }
}

/** The app's authorization, backed by the shared database. */
export const authz: Authz = createAuthz(createDbAuthzStore());

export const {
  loadUser,
  requireAuth,
  requireAdmin,
  requireClubManager,
  requireClubOwner,
  requirePlayerManager,
  clubFrom,
  canManageClub,
  canOwnClub,
  canManagePlayer,
  viewersFor,
  clubScope,
  viewerFor,
  managedClubIds,
} = authz;
