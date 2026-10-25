import type { AppEnv } from "../config/env";
import { sameSecret, sign } from "../http/signing";

/**
 * The QR register page's proof that a visitor typed a player's details in themselves: POST /api/players
 * returns a token for the player it created or matched (by name and phone), and an anonymous sign-up
 * for a player outside the club's own players must carry it (P2REV0-02). Player ids are on every
 * public list, so without it anyone could fill a tournament with other clubs' players.
 *
 * A token issued for a tournament's QR page also names that tournament's club: the player was added
 * there under its sign-up rules (a photo, when the club requires one). One issued with no club, or at
 * another club, still vouches for the player, but never for that club's photo rule (R5REV-SEC-01).
 */
const PURPOSE = "player-sign-up";

/** Long enough to finish the QR page (photo, high-hand choice), short enough not to be worth keeping. */
export const SIGN_UP_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** "<expires>.<signature>", or "<expires>.<clubId>.<signature>" for a player added at `clubId`. */
export function issueSignUpToken(env: Pick<AppEnv, "SESSION_SECRET">, playerId: string, clubId: string | null = null, now = Date.now()): string {
  const expires = String(now + SIGN_UP_TOKEN_TTL_MS);
  if (clubId === null) return `${expires}.${sign(env, PURPOSE, playerId, expires)}`;
  return `${expires}.${clubId}.${sign(env, PURPOSE, playerId, expires, clubId)}`;
}

/**
 * What `token` vouches for, when this server issued it for `playerId` and it has not expired: the club
 * the player was added at (null for none). Null when it vouches for nothing.
 */
export function signUpTokenScope(
  env: Pick<AppEnv, "SESSION_SECRET">,
  playerId: string,
  token: string | undefined,
  now = Date.now(),
): { clubId: string | null } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [expires, ...rest] = parts;
  const signature = rest[rest.length - 1];
  const clubId = parts.length === 3 ? rest[0] : null;
  if (!/^\d{1,15}$/.test(expires ?? "") || !signature || clubId === "") return null;
  if (Number(expires) <= now) return null;
  const expected = clubId === null ? sign(env, PURPOSE, playerId, expires) : sign(env, PURPOSE, playerId, expires, clubId);
  return sameSecret(signature, expected) ? { clubId } : null;
}

/** Whether `token` was issued for `playerId` by this server and has not expired. */
export function isValidSignUpToken(
  env: Pick<AppEnv, "SESSION_SECRET">,
  playerId: string,
  token: string | undefined,
  now = Date.now(),
): boolean {
  return signUpTokenScope(env, playerId, token, now) !== null;
}
