import { describe, expect, it } from "vitest";
import { sign } from "../http/signing";
import { issueSignUpToken, isValidSignUpToken, SIGN_UP_TOKEN_TTL_MS, signUpTokenScope } from "./sign-up-tokens";

const env = { SESSION_SECRET: "sign-up-token-test-secret" };
const NOW = Date.UTC(2026, 9, 23, 19, 0, 0);
const PLAYER = "player-1";

describe("sign-up tokens (P2REV0-02, P2REV4-CQ2-02)", () => {
  it("accepts a token for its player until just before it expires, two hours after it was issued", () => {
    const token = issueSignUpToken(env, PLAYER, null, NOW);

    expect(isValidSignUpToken(env, PLAYER, token, NOW)).toBe(true);
    expect(isValidSignUpToken(env, PLAYER, token, NOW + SIGN_UP_TOKEN_TTL_MS - 1)).toBe(true);
    expect(SIGN_UP_TOKEN_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("refuses it from the moment it expires, and ever after", () => {
    const token = issueSignUpToken(env, PLAYER, null, NOW);

    expect(isValidSignUpToken(env, PLAYER, token, NOW + SIGN_UP_TOKEN_TTL_MS)).toBe(false);
    expect(isValidSignUpToken(env, PLAYER, token, NOW + SIGN_UP_TOKEN_TTL_MS + 1)).toBe(false);
    expect(isValidSignUpToken(env, PLAYER, token, NOW + 365 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("cannot be stretched: a later expiry with the old signature fails the signature", () => {
    const [, signature] = issueSignUpToken(env, PLAYER, null, NOW).split(".");
    const stretched = `${NOW + 10 * SIGN_UP_TOKEN_TTL_MS}.${signature}`;

    expect(isValidSignUpToken(env, PLAYER, stretched, NOW + SIGN_UP_TOKEN_TTL_MS)).toBe(false);
  });

  it("refuses another player's token, another server's, and one signed for another purpose", () => {
    const token = issueSignUpToken(env, PLAYER, null, NOW);
    const expires = String(NOW + SIGN_UP_TOKEN_TTL_MS);

    expect(isValidSignUpToken(env, "player-2", token, NOW)).toBe(false);
    expect(isValidSignUpToken({ SESSION_SECRET: "another-server" }, PLAYER, token, NOW)).toBe(false);
    expect(isValidSignUpToken(env, PLAYER, `${expires}.${sign(env, "known-device", PLAYER, expires)}`, NOW)).toBe(false);
  });

  it("names the club it was issued at, which cannot be changed or taken off (R5REV-SEC-01)", () => {
    const token = issueSignUpToken(env, PLAYER, "club-1", NOW);
    const [expires, , signature] = token.split(".");

    expect(signUpTokenScope(env, PLAYER, token, NOW)).toEqual({ clubId: "club-1" });
    expect(signUpTokenScope(env, PLAYER, issueSignUpToken(env, PLAYER, null, NOW), NOW)).toEqual({ clubId: null });
    expect(signUpTokenScope(env, PLAYER, `${expires}.club-2.${signature}`, NOW)).toBeNull();
    expect(signUpTokenScope(env, PLAYER, `${expires}.${signature}`, NOW)).toBeNull();
    expect(signUpTokenScope(env, PLAYER, `${expires}..${signature}`, NOW)).toBeNull();
    expect(signUpTokenScope(env, "player-2", token, NOW)).toBeNull();
    expect(signUpTokenScope(env, PLAYER, token, NOW + SIGN_UP_TOKEN_TTL_MS)).toBeNull();
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["no signature", `${NOW + SIGN_UP_TOKEN_TTL_MS}.`],
    ["an extra segment", `${issueSignUpToken(env, PLAYER, null, NOW)}.extra`],
    ["a non-numeric expiry", `soon.${sign(env, "player-sign-up", PLAYER, "soon")}`],
    ["an expiry too long to be a time", `${"9".repeat(16)}.${sign(env, "player-sign-up", PLAYER, "9".repeat(16))}`],
  ])("refuses %s", (_label, token) => {
    expect(isValidSignUpToken(env, PLAYER, token, NOW)).toBe(false);
  });
});
