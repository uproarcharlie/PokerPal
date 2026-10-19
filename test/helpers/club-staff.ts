/**
 * Signed-in visitors for authorization tests, relative to one club: a platform admin, the club's owner,
 * one of its managers, a signed-in user with no role there, and a manager whose account was
 * deactivated after signing in. Import it by path (the helpers' index is frozen in Phase 2).
 *
 * - `clubWithStaff()` makes a club and signs in every kind of visitor at once (most route tests).
 * - `signInClubRole(role, clubId)` signs in one visitor at an existing club.
 * - `VISITORS`, `agentFor`, `MANAGER_ROUTE` and `OWNER_ROUTE` drive a table over them.
 */
import { eq } from "drizzle-orm";
import request from "supertest";
import { clubManagers, clubs, users, type Club } from "@shared/schema";
import { createClub, type NewClub } from "../factories/clubs";
import { createClubManager } from "../factories/club-managers";
import { createUser } from "../factories/users";
import { getApp } from "./app";
import { loginAs, signIn, type SignedIn } from "./auth";
import { testDb } from "./db";

/** A club and a signed-in agent for every kind of visitor its authorization tells apart. */
export interface ClubStaffAgents {
  club: Club;
  owner: SignedIn;
  manager: SignedIn;
  /** Signed in, but neither staff of this club nor an admin. */
  stranger: SignedIn;
  admin: SignedIn;
  /** A manager of the club whose account was deactivated after signing in. */
  deactivated: SignedIn;
}

export async function clubWithStaff(overrides: Partial<NewClub> = {}): Promise<ClubStaffAgents> {
  const owner = await signIn();
  const club = await createClub({ ...overrides, ownerId: owner.user.id });
  const [manager, stranger, admin, deactivated] = [await signIn(), await signIn(), await signIn({ role: "admin" }), await signIn()];
  await createClubManager({ clubId: club.id, userId: manager.user.id, createdBy: owner.user.id });
  await createClubManager({ clubId: club.id, userId: deactivated.user.id, createdBy: owner.user.id });
  await testDb().update(users).set({ isActive: false }).where(eq(users.id, deactivated.user.id));
  return { club, owner, manager, stranger, admin, deactivated };
}

/** Who a request comes from, relative to one club (signed in). */
export type ClubRole = "admin" | "owner" | "manager" | "stranger";

export const CLUB_ROLES: readonly ClubRole[] = ["admin", "owner", "manager", "stranger"];

/** Roles that may manage the club (admin, its owner, its managers). */
export const STAFF_ROLES: readonly ClubRole[] = ["admin", "owner", "manager"];

/**
 * Signs in a new factory user with `role` at the club: a platform admin, the club's owner (replacing
 * any owner it had), one of its managers, or a signed-in user with no role there.
 */
export async function signInClubRole(role: ClubRole, clubId: string): Promise<SignedIn> {
  const user = await createUser({ role: role === "admin" ? "admin" : "full_member" });
  if (role === "owner") await testDb().update(clubs).set({ ownerId: user.id }).where(eq(clubs.id, clubId));
  if (role === "manager") await testDb().insert(clubManagers).values({ clubId, userId: user.id });
  return loginAs({ email: user.email });
}

/** A signed-in manager of the club whose account is then deactivated: their session must count for nothing. */
export async function signInDeactivatedManager(clubId: string): Promise<SignedIn> {
  const signedIn = await signInClubRole("manager", clubId);
  await testDb().update(users).set({ isActive: false }).where(eq(users.id, signedIn.user.id));
  return signedIn;
}

/**
 * Who is asking, for authorization matrices over one club (see clubWithStaff): nobody signed in, a
 * signed-in user with no role there, its manager, its owner, a platform admin, or a manager whose
 * account was deactivated after signing in.
 */
export type Visitor = "anonymous" | "stranger" | "manager" | "owner" | "admin" | "deactivated";

export const VISITORS: readonly Visitor[] = ["anonymous", "stranger", "manager", "owner", "admin", "deactivated"];

export async function agentFor(visitor: Visitor, staff: ClubStaffAgents): Promise<request.Agent> {
  return visitor === "anonymous" ? request.agent(await getApp()) : staff[visitor].agent;
}

/** What each visitor gets from a route open to the club's managers (and admins), when it succeeds. */
export const MANAGER_ROUTE: Readonly<Record<Visitor, number>> = {
  anonymous: 401,
  stranger: 403,
  manager: 200,
  owner: 200,
  admin: 200,
  deactivated: 401,
};

/** The same for a route open only to the club's owner (and admins). */
export const OWNER_ROUTE: Readonly<Record<Visitor, number>> = { ...MANAGER_ROUTE, manager: 403 };
