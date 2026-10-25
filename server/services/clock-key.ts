/**
 * The venue TV's clock key (P4SEC-TV-FULL-SESSION). Running the clock from the TV's keyboard used to
 * need the TV signed in as club staff: a week-long session with every staff power, on a screen anyone
 * can walk up to. Instead the TD issues a key for one tournament (POST .../clock/key) and opens the
 * TV's link that carries it (shared/domain/urls clockKeyLink). The TV sends it in CLOCK_KEY_HEADER; a
 * request holding the tournament's key in force may run that clock (POST .../clock/actions: the guard
 * is requireClubManagerOr(CLOCK_KEY, ...)) and nothing else. Only the key's sha256 is stored, so the
 * database never holds a usable key.
 *
 * A key is in force for CLOCK_LIMITS.keyLifetimeMs after it was issued, and only while the account
 * that issued it is active and may still manage the club: a manager removed from the staff, a
 * deactivated account or a former owner takes the key's power with them (P4REV3-SEC-01). Issuing a new
 * key, revoking it, removing the clock, and cancelling or finalizing the tournament end it at once.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { CLOCK_KEY_HEADER, CLOCK_LIMITS } from "@shared/domain/clock";
import { db } from "../db";
import { canUserManageClub, type StandInCredential } from "../http/authz";
import { storedClockKeyOf, type StoredClockKey } from "../repositories/clock";

/** 24 random bytes, base64url: 32 characters. */
const KEY_BYTES = 24;
const KEY_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const newClockKey = (): string => randomBytes(KEY_BYTES).toString("base64url");

export const hashClockKey = (key: string): string => createHash("sha256").update(key).digest("hex");

/** When a key issued at `issuedAt` stops working. */
export const clockKeyExpiry = (issuedAt: Date): Date => new Date(issuedAt.getTime() + CLOCK_LIMITS.keyLifetimeMs);

/** The clock key the request carries, when it is shaped like one. */
function clockKeyOf(req: Request): string | null {
  const key = req.get(CLOCK_KEY_HEADER);
  return key !== undefined && KEY_PATTERN.test(key) ? key : null;
}

/** Whether the request carries the key whose hash is `keyHash` (the clock's controlKeyHash; null: none stored). */
export function carriesClockKey(req: Request, keyHash: string | null): boolean {
  const key = clockKeyOf(req);
  if (key === null || keyHash === null) return false;
  const given = Buffer.from(hashClockKey(key), "hex");
  const expected = Buffer.from(keyHash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Whether the stored key of a clock of club `clubId` is in force at `nowMs`: one is stored, it has not
 * expired, and its issuer is an active account that may still manage the club. A key stored without an
 * issuer is not.
 */
export async function clockKeyInForce(key: StoredClockKey, clubId: string, nowMs: number): Promise<boolean> {
  const { controlKeyHash, controlKeyIssuedAt, controlKeyIssuedBy } = key;
  if (controlKeyHash === null || controlKeyIssuedAt === null || controlKeyIssuedBy === null) return false;
  if (nowMs >= clockKeyExpiry(controlKeyIssuedAt).getTime()) return false;
  return canUserManageClub(controlKeyIssuedBy, clubId);
}

/** Whether the request carries the clock key in force for tournament `tournamentId`. */
export async function holdsClockKey(req: Request, tournamentId: string): Promise<boolean> {
  if (clockKeyOf(req) === null) return false;
  const stored = await storedClockKeyOf(db, tournamentId);
  return stored !== undefined && carriesClockKey(req, stored.controlKeyHash) && (await clockKeyInForce(stored, stored.clubId, Date.now()));
}

/** The clock key, for a route on /api/tournaments/:id/...: it stands in for a club manager there. */
export const CLOCK_KEY: StandInCredential = {
  name: "clock key",
  accepts: (req) => {
    const tournamentId = req.params.id;
    return typeof tournamentId === "string" ? holdsClockKey(req, tournamentId) : Promise.resolve(false);
  },
};
