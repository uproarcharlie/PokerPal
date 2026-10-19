import type { Request } from "express";
import { z } from "zod";
import {
  emailSchema,
  passwordProblems,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type AuthMeResponse,
  type UpdateProfileInput,
} from "@shared/api/auth";
import { db } from "../db";
import { managedClubIds as managedClubIdsOf } from "../http/authz";
import { badRequest, conflict, HttpError, notFound } from "../http/errors";
import { parseOrThrow } from "../http/validate";
import {
  findCredentialsByEmail,
  findPasswordHash,
  findUserById,
  insertUser,
  isEmailTaken,
  updateUserFields,
  type SafeUser,
} from "../repositories/users";
import { recordAudit } from "./audit";
import { passwordHasher } from "./password-hashing";
import { revokeUserSessions } from "./sessions";

/** bcrypt cost for new hashes (about 250 ms per hash or compare with bcryptjs, run off the request thread). */
export const BCRYPT_COST = 12;

/**
 * A cost-12 hash of a random string nobody knows. Sign-in compares against it when the email is
 * unknown, so an unknown email takes as long as a wrong password and the timing does not reveal
 * which emails have accounts (CC-10).
 */
const DUMMY_PASSWORD_HASH = "$2b$12$fuDlSgufIHJowEk39ysCHuopwloQ072WOlitxb0UouOBwaMy3mCG2";

export const EMAIL_TAKEN_MESSAGE = "An account with that email already exists";

export function hashPassword(password: string): Promise<string> {
  return passwordHasher.hash(password, BCRYPT_COST);
}

function assertStrong(password: string, message: string): void {
  const problems = passwordProblems(password);
  if (problems.length > 0) throw badRequest(message, "WEAK_PASSWORD", problems);
}

const newEmailSchema = z.object({ email: emailSchema });

/**
 * A changed email must be well-formed (400 VALIDATION, details as zod's). The account's own address
 * is accepted as stored: sign-up did not check the format before Phase 2.
 */
export function assertEmailAcceptable(email: string, storedEmail: string, message: string): void {
  if (email !== storedEmail.trim().toLowerCase()) parseOrThrow(newEmailSchema, { email }, { message });
}

/** Creates a full member (the role and status are never the caller's to choose). */
export async function registerUser(input: RegisterInput): Promise<SafeUser> {
  assertStrong(input.password, "Password does not meet requirements");
  if (await isEmailTaken(db, input.email)) throw conflict("EMAIL_TAKEN", EMAIL_TAKEN_MESSAGE);
  // A concurrent sign-up with the same email that gets past the check fails on users_email_unique,
  // which the central error handler answers with the same 409 EMAIL_TAKEN (SEC-27).
  return insertUser(db, {
    email: input.email,
    passwordHash: await hashPassword(input.password),
    name: input.name,
    phone: input.phone ?? null,
  });
}

/**
 * The account for a correct email and password, with its sign-in time recorded. The password is
 * always checked, and only then whether the account is disabled, so a disabled account is not
 * revealed to someone who does not know its password (CC-10).
 */
export async function authenticate({ email, password }: LoginInput): Promise<SafeUser> {
  const account = await findCredentialsByEmail(db, email);
  const passwordMatches = await passwordHasher.compare(password, account?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!account || !passwordMatches) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  // is_active is nullable; NULL has always counted as disabled.
  if (!account.isActive) throw new HttpError(403, "ACCOUNT_DISABLED", "Account is disabled");

  const signedIn = await updateUserFields(db, account.id, { lastLoginAt: new Date() });
  if (!signedIn) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  return signedIn;
}

/** `AuthMeResponse` before serialisation (dates are Date objects). */
export interface SessionDescription {
  user: SafeUser;
  impersonator: AuthMeResponse["impersonator"];
  managedClubIds: string[];
}

/**
 * GET /api/auth/me: the signed-in user, the admin behind the session while they impersonate them
 * (so the client can always offer a way back: SEC-13), and the clubs the user owns or manages. Null
 * when the session should end: the user is gone, or the impersonating admin no longer exists or is
 * no longer an active admin (an impersonation lasts only as long as the admin's own access).
 */
export async function describeSession(userId: string, impersonatorId: string | undefined): Promise<SessionDescription | null> {
  const [user, admin, managedClubIds] = await Promise.all([
    findUserById(db, userId),
    impersonatorId ? findUserById(db, impersonatorId) : undefined,
    managedClubIdsOf(userId),
  ]);
  if (!user) return null;
  if (impersonatorId && !(admin && admin.role === "admin" && admin.isActive === true)) return null;
  return {
    user,
    impersonator: admin ? { id: admin.id, name: admin.name, email: admin.email } : null,
    managedClubIds: managedClubIds.sort(),
  };
}

export const PROFILE_INVALID_MESSAGE = "Name and a valid email are required";

const PROFILE_FIELDS = ["name", "email", "phone"] as const;

/**
 * The signed-in user's own name, email and phone. An absent phone keeps the stored one. A change is
 * audited (`user.update`, before/after of the changed fields) like an admin's edit of the same fields,
 * so an admin changing them while impersonating the user is on record as the admin (P2REV0-06).
 */
export async function updateProfile(req: Request, userId: string, input: UpdateProfileInput): Promise<SafeUser> {
  return db.transaction(async (tx) => {
    const current = await findUserById(tx, userId);
    if (!current) throw notFound("User not found");
    assertEmailAcceptable(input.email, current.email, PROFILE_INVALID_MESSAGE);
    if (await isEmailTaken(tx, input.email, userId)) throw conflict("EMAIL_TAKEN", EMAIL_TAKEN_MESSAGE);
    const updated = await updateUserFields(tx, userId, { name: input.name, email: input.email, phone: input.phone });
    if (!updated) throw notFound("User not found");
    const changed = PROFILE_FIELDS.filter((field) => current[field] !== updated[field]);
    if (changed.length > 0) {
      const pick = (user: SafeUser) => Object.fromEntries(changed.map((field) => [field, user[field]]));
      await recordAudit(
        req,
        { action: "user.update", targetType: "user", targetId: userId, data: { before: pick(current), after: pick(updated), via: "profile" } },
        tx,
      );
    }
    return updated;
  });
}

/**
 * Replaces the password after checking the current one, then signs the account out of every other
 * session (SEC-11). `currentSessionId` stays signed in.
 */
export async function changePassword(userId: string, input: ChangePasswordInput, currentSessionId: string): Promise<void> {
  assertStrong(input.newPassword, "New password does not meet requirements");
  const storedHash = await findPasswordHash(db, userId);
  if (!storedHash) throw notFound("User not found");
  if (!(await passwordHasher.compare(input.currentPassword, storedHash))) {
    throw new HttpError(401, "WRONG_PASSWORD", "Current password is incorrect");
  }

  await updateUserFields(db, userId, { passwordHash: await hashPassword(input.newPassword) });
  await revokeUserSessions(userId, { exceptSid: currentSessionId });
}
