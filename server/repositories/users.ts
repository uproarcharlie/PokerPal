import { and, asc, eq, ne, sql } from "drizzle-orm";
import { players, users, type User } from "@shared/schema";
import type { Executor } from "../db";

/** A users row without the password hash: the only shape that ever leaves this module for a response. */
export type SafeUser = Omit<User, "passwordHash">;

/** Every users column except password_hash. */
const safeUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  phone: users.phone,
  imageUrl: users.imageUrl,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

/**
 * Emails are stored lower-cased (sign-up, profile and admin edits all lower-case them), but rows
 * from before that rule may not be, so lookups compare lower-cased. `email` must already be.
 */
const emailIs = (email: string) => sql`lower(${users.email}) = ${email}`;

export async function findUserById(ex: Executor, id: string): Promise<SafeUser | undefined> {
  const [user] = await ex.select(safeUserColumns).from(users).where(eq(users.id, id)).limit(1);
  return user;
}

/**
 * The one rule for which account signs in with `email` (lower-cased), for every lookup by email
 * (sign-in, adding a club manager, setting a club's owner): compared lower-cased, an exact match
 * first in case two legacy rows differ only in case, then the oldest, then by id, so every lookup
 * picks the same account (P2REV4-CQ-10).
 */
export function accountForEmail(email: string) {
  return { where: emailIs(email), order: [sql`${users.email} = ${email} DESC`, asc(users.createdAt), asc(users.id)] as const };
}

/** The user signing in with `email` (lower-cased), with the hash to check the password against. */
export async function findCredentialsByEmail(ex: Executor, email: string): Promise<User | undefined> {
  const rule = accountForEmail(email);
  const [user] = await ex
    .select()
    .from(users)
    .where(rule.where)
    .orderBy(...rule.order)
    .limit(1);
  return user;
}

export async function findPasswordHash(ex: Executor, id: string): Promise<string | undefined> {
  const [row] = await ex.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, id)).limit(1);
  return row?.passwordHash;
}

/** Whether an account other than `exceptId` signs in with `email` (lower-cased). */
export async function isEmailTaken(ex: Executor, email: string, exceptId?: string): Promise<boolean> {
  const [row] = await ex
    .select({ id: users.id })
    .from(users)
    .where(exceptId ? and(emailIs(email), ne(users.id, exceptId)) : emailIs(email))
    .limit(1);
  return row !== undefined;
}

export interface NewAccount {
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
}

/** A new full member. A concurrent sign-up with the same email fails on users_email_unique (409). */
export async function insertUser(ex: Executor, account: NewAccount): Promise<SafeUser> {
  const [user] = await ex
    .insert(users)
    .values({ ...account, role: "full_member", isActive: true })
    .returning(safeUserColumns);
  return user;
}

export type UserPatch = Partial<Pick<User, "name" | "email" | "phone" | "role" | "isActive" | "passwordHash" | "lastLoginAt">>;

/** Writes only the fields present in `patch` (plus updatedAt, unless it is just a sign-in). */
export async function updateUserFields(ex: Executor, id: string, patch: UserPatch): Promise<SafeUser | undefined> {
  const loginOnly = Object.keys(patch).every((key) => key === "lastLoginAt");
  const [user] = await ex
    .update(users)
    .set(loginOnly ? patch : { ...patch, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(safeUserColumns);
  return user;
}

/** The user's row, locked until the transaction ends, so concurrent admin edits apply one at a time. */
export async function lockUser(ex: Executor, id: string): Promise<SafeUser | undefined> {
  const [user] = await ex.select(safeUserColumns).from(users).where(eq(users.id, id)).for("update").limit(1);
  return user;
}

/**
 * Ids of every active admin, locked until the transaction ends. Two admins demoting each other at
 * once therefore queue here, and the second sees the first's change (LAST_ADMIN).
 */
export async function lockActiveAdminIds(ex: Executor): Promise<string[]> {
  const rows = await ex
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
    .orderBy(asc(users.id))
    .for("update");
  return rows.map((row) => row.id);
}

export async function listSafeUsers(ex: Executor): Promise<SafeUser[]> {
  return ex.select(safeUserColumns).from(users).orderBy(asc(users.createdAt), asc(users.id));
}

/** The player columns the admin user list shows. */
export async function listPlayersForAdmin(ex: Executor) {
  return ex
    .select({
      id: players.id,
      name: players.name,
      email: players.email,
      phone: players.phone,
      userId: players.userId,
      createdAt: players.createdAt,
    })
    .from(players)
    .orderBy(asc(players.createdAt), asc(players.id));
}
