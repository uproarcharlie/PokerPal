import type { Request, Response } from "express";
import type { AppEnv } from "../config/env";
import { sameSecret, sign } from "./signing";

/**
 * A browser that has signed in to an account before carries a mark for it, so the per-account sign-in
 * limiter (`authAccount`), which counts failures from every address together, never locks the
 * account's own devices out: someone who knows an email address can no longer keep its owner from
 * signing in by failing on purpose from a few addresses (TN2-06). The per-visitor limiters still
 * apply to everyone. A mark is the server's signature of the email, so it cannot be made without
 * having signed in; the cookie holds the marks of the last few accounts used on that browser.
 */
export const KNOWN_DEVICE_COOKIE = "pp_known_device";
const PURPOSE = "known-device";
const MAX_ACCOUNTS = 5;
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

type SigningEnv = Pick<AppEnv, "SESSION_SECRET">;

const markFor = (env: SigningEnv, email: string) => sign(env, PURPOSE, email.trim().toLowerCase());

/** The marks the browser sent (base64url signatures, separated by "."). */
function marksOf(req: Request): string[] {
  const header = req.headers.cookie;
  if (!header) return [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === KNOWN_DEVICE_COOKIE) {
      return part
        .slice(separator + 1)
        .trim()
        .split(".")
        .filter((mark) => /^[A-Za-z0-9_-]{1,64}$/.test(mark))
        .slice(0, MAX_ACCOUNTS);
    }
  }
  return [];
}

/** Whether this browser has signed in to the account with `email` before. */
export function isKnownDevice(req: Request, env: SigningEnv, email: string): boolean {
  if (!email) return false;
  const expected = markFor(env, email);
  return marksOf(req).some((mark) => sameSecret(mark, expected));
}

/** After a successful sign-in or sign-up: marks the browser as one the account uses. */
export function rememberDevice(req: Request, res: Response, env: Pick<AppEnv, "SESSION_SECRET" | "NODE_ENV">, email: string): void {
  const mark = markFor(env, email);
  const marks = [mark, ...marksOf(req).filter((existing) => existing !== mark)].slice(0, MAX_ACCOUNTS);
  res.cookie(KNOWN_DEVICE_COOKIE, marks.join("."), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: MAX_AGE_MS,
  });
}
