import type { AppEnv } from "../config/env";
import { sameSecret, sign } from "../http/signing";

/**
 * The QR register page's proof that a visitor typed a player's details in themselves: POST /api/players
 * returns a token for the player it created or matched (by name and phone), and an anonymous sign-up
 * for a player outside the club's own players must carry it (P2REV0-02). Player ids are on every
 * public list, so without it anyone could fill a tournament with other clubs' players.
 */
const PURPOSE = "player-sign-up";

/** Long enough to finish the QR page (photo, high-hand choice), short enough not to be worth keeping. */
export const SIGN_UP_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export function issueSignUpToken(env: Pick<AppEnv, "SESSION_SECRET">, playerId: string, now = Date.now()): string {
  const expires = String(now + SIGN_UP_TOKEN_TTL_MS);
  return `${expires}.${sign(env, PURPOSE, playerId, expires)}`;
}

/** Whether `token` was issued for `playerId` by this server and has not expired. */
export function isValidSignUpToken(
  env: Pick<AppEnv, "SESSION_SECRET">,
  playerId: string,
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const [expires, signature, extra] = token.split(".");
  if (extra !== undefined || !/^\d{1,15}$/.test(expires ?? "") || !signature) return false;
  if (Number(expires) <= now) return false;
  return sameSecret(signature, sign(env, PURPOSE, playerId, expires));
}
