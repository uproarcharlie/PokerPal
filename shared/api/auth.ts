/** /api/auth/*: sign-up, sign-in, the session user, profile and password. */
import { z } from "zod";
import type { User } from "../schema";
import { optionalText, requiredText, type Json } from "./common";

export const PASSWORD_MIN_LENGTH = 8;
/** Long enough for any passphrase; bcrypt only reads the first 72 bytes. */
export const PASSWORD_MAX_LENGTH = 200;

/** Every rule `password` breaks, in the wording the API has always used (empty when it is acceptable). */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  if (!/[A-Z]/.test(password)) problems.push("Password must contain at least one uppercase letter");
  if (!/[a-z]/.test(password)) problems.push("Password must contain at least one lowercase letter");
  if (!/[0-9]/.test(password)) problems.push("Password must contain at least one number");
  return problems;
}

/** A new email address: trimmed, lower-cased (as every stored email is) and well-formed. */
export const emailSchema = z.string().trim().toLowerCase().max(254).email("Invalid email address");

/**
 * An existing account's email: trimmed and lower-cased, but not format-checked, because sign-up
 * never checked the format before Phase 2 and those accounts must still sign in. Use it to find an
 * account (sign-in, adding a club manager) and where an unchanged address must be accepted (profile
 * and admin edits, whose services check a changed address against `emailSchema`).
 */
export const accountEmailSchema = z.string().trim().toLowerCase().min(1, "Required").max(254);

/**
 * A password as typed: a string, never trimmed. Strength is checked by the route with
 * `passwordProblems` (400 WEAK_PASSWORD, details: the broken rules), not here.
 */
export const passwordSchema = z.string().min(1, "Required").max(PASSWORD_MAX_LENGTH);

/** Free-text phone as entered, at most 32 characters; blank stores NULL. */
export const phoneSchema = optionalText(32);

/** POST /api/auth/register */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: requiredText(100),
  phone: phoneSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** POST /api/auth/login. JSON only: the server no longer parses form-encoded bodies (CC-13). */
export const loginSchema = z.object({
  email: accountEmailSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * PUT /api/auth/profile. An absent phone keeps the stored one; null or blank clears it. A changed
 * email must be well-formed; the unchanged one is accepted as stored.
 */
export const updateProfileSchema = z.object({
  name: requiredText(100),
  email: accountEmailSchema,
  phone: phoneSchema,
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** POST /api/auth/change-password */
export const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** The signed-in user as the auth endpoints return it: every users column except the password hash. */
export type SessionUser = Json<Omit<User, "passwordHash">>;

/** POST /api/auth/register (201), /login (200), PUT /api/auth/profile (200) */
export interface AuthUserResponse {
  message: string;
  user: SessionUser;
}

/** GET /api/auth/me, signed in. */
export interface AuthMeResponse {
  user: SessionUser;
  /** The admin behind the session while they impersonate `user`; null otherwise (SEC-13). */
  impersonator: { id: string; name: string; email: string } | null;
  /** Clubs the user owns or manages. An admin may manage every club; check `user.role` for that. */
  managedClubIds: string[];
}

/**
 * GET /api/auth/me when nobody is signed in (200, not 401: asking is not an error, and every public page
 * asks, so a 401 put an error in the browser's console on each one). Also the answer once a session has
 * ended (its user deleted or deactivated, its impersonating admin no longer one).
 */
export interface SignedOutMeResponse {
  user: null;
}

/** GET /api/auth/me */
export type MeResponse = AuthMeResponse | SignedOutMeResponse;

/** POST /api/auth/logout, /change-password */
export interface MessageResponse {
  message: string;
}
