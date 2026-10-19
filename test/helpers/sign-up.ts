import { loadEnv } from "../../server/config/env";
import { issueSignUpToken } from "../../server/services/sign-up-tokens";

/**
 * The token POST /api/players would give whoever typed this player's details in, which lets an
 * anonymous QR sign-up register a player who has not played at the tournament's club (P2REV0-02).
 * Signed with the worker's own SESSION_SECRET, as the app under test is.
 */
export function signUpTokenFor(playerId: string): string {
  return issueSignUpToken(loadEnv(process.env), playerId);
}
