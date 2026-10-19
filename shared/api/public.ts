/**
 * What anyone may see. Public projections are allowlists of columns, never a row minus some fields,
 * so a column added later stays private until it is listed here. No public body may carry email,
 * phone, userId, passwordHash, ownerId or any other user id (FORBIDDEN_PUBLIC_KEYS); the server's
 * PII deep-scan test runs `findForbiddenKeys` over every public response.
 */
import { z } from "zod";
import type {
  ActivityLog,
  Club,
  Player,
  PointsAllocation,
  PointsSystem,
  Season,
  Tournament,
  TournamentRegistration,
} from "../schema";
import { limitSchema, type Json, type WithViewer } from "./common";

/** Keys that must never appear anywhere in a public response body. */
export const FORBIDDEN_PUBLIC_KEYS = [
  "email",
  "phone",
  "userId",
  "passwordHash",
  "ownerId",
  "createdBy",
  "actorUserId",
  "prizePoolAdjustedBy",
  "finalizedBy",
  "byUserId",
] as const;

const FORBIDDEN: ReadonlySet<string> = new Set(FORBIDDEN_PUBLIC_KEYS);

/**
 * Paths (e.g. "[0].player.phone") of every forbidden key in `value`, including inside JSON-encoded
 * string fields such as activity_log.event_data. Empty when the body is safe to serve publicly.
 */
export function findForbiddenKeys(value: unknown, path = ""): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return [];
    try {
      return findForbiddenKeys(JSON.parse(text), `${path}<json>`);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item, i) => findForbiddenKeys(item, `${path}[${i}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    return [...(FORBIDDEN.has(key) ? [childPath] : []), ...findForbiddenKeys(child, childPath)];
  });
}

/** `keys` of `row` and nothing else. */
export function pickFields<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) picked[key] = row[key];
  return picked;
}

export const PUBLIC_PLAYER_FIELDS = ["id", "name", "imageUrl"] as const satisfies readonly (keyof Player)[];
export type PublicPlayer = Json<Pick<Player, (typeof PUBLIC_PLAYER_FIELDS)[number]>>;

export const PUBLIC_CLUB_FIELDS = [
  "id",
  "name",
  "slug",
  "description",
  "imageUrl",
  "timezone",
  "address",
  "discordUrl",
  "twitterUrl",
  "facebookUrl",
  "instagramUrl",
  "websiteUrl",
  "rakeLabel",
  "createdAt",
] as const satisfies readonly (keyof Club)[];
export type PublicClub = Json<Pick<Club, (typeof PUBLIC_CLUB_FIELDS)[number]>>;
/** GET /api/clubs, /api/clubs/:id, /api/clubs/slug/:slug */
export type ClubDto = WithViewer<PublicClub>;

export const PUBLIC_SEASON_FIELDS = [
  "id",
  "name",
  "clubId",
  "startDate",
  "endDate",
  "isActive",
  "createdAt",
] as const satisfies readonly (keyof Season)[];
export type PublicSeason = Json<Pick<Season, (typeof PUBLIC_SEASON_FIELDS)[number]>>;

/** Every tournament column except the audit user ids and the (large) finalize snapshot. */
export const PUBLIC_TOURNAMENT_FIELDS = [
  "id",
  "name",
  "description",
  "imageUrl",
  "clubId",
  "seasonId",
  "pointsSystemId",
  "startDateTime",
  "status",
  "buyInAmount",
  "rebuyAmount",
  "addonAmount",
  "maxRebuys",
  "rebuyPeriodMinutes",
  "rakeType",
  "rakeAmount",
  "rebuyRakeType",
  "rebuyRakeAmount",
  "addonRakeType",
  "addonRakeAmount",
  "payoutStructure",
  "customPayouts",
  "enableHighHand",
  "highHandAmount",
  "highHandRakeType",
  "highHandRakeAmount",
  "highHandPayouts",
  "enableLateRegistration",
  "trackPoints",
  "minPlayers",
  "maxPlayers",
  "prizePoolLocked",
  "prizePoolLockedAt",
  "manualPrizePool",
  "rakeOverride",
  "prizePoolAdjustmentReason",
  "prizePoolAdjustedAt",
  "finalizedAt",
  "useClubAddress",
  "address",
  "createdAt",
] as const satisfies readonly (keyof Tournament)[];
export type PublicTournament = Json<Pick<Tournament, (typeof PUBLIC_TOURNAMENT_FIELDS)[number]>>;

/**
 * Registrations hold no personal data; the player is reduced to PublicPlayer. Whether an entry has
 * paid is staff bookkeeping (like the payment_confirmed activity), so it is not here: staff get it as
 * ManagedRegistration (shared/api/registrations) (P2REV0-SEC-04).
 */
export const PUBLIC_REGISTRATION_FIELDS = [
  "id",
  "tournamentId",
  "playerId",
  "registrationTime",
  "buyIns",
  "rebuys",
  "addons",
  "finalPosition",
  "prizeAmount",
  "pointsAwarded",
  "isEliminated",
  "eliminationTime",
  "eliminatedBy",
  "knockouts",
  "enteringHighHands",
  "highHandWinner",
  "highHandAmount",
] as const satisfies readonly (keyof TournamentRegistration)[];
export type PublicRegistrationRow = Json<Pick<TournamentRegistration, (typeof PUBLIC_REGISTRATION_FIELDS)[number]>>;
/** GET /api/tournaments/:id/registrations */
export type PublicRegistration = PublicRegistrationRow & { player: PublicPlayer | null };

export const PUBLIC_POINTS_SYSTEM_FIELDS = [
  "id",
  "seasonId",
  "name",
  "description",
  "participationPoints",
  "knockoutPoints",
  "createdAt",
] as const satisfies readonly (keyof PointsSystem)[];
export type PublicPointsSystem = Json<Pick<PointsSystem, (typeof PUBLIC_POINTS_SYSTEM_FIELDS)[number]>>;

export const PUBLIC_POINTS_ALLOCATION_FIELDS = [
  "id",
  "pointsSystemId",
  "position",
  "positionEnd",
  "points",
  "description",
] as const satisfies readonly (keyof PointsAllocation)[];
export type PublicPointsAllocation = Json<Pick<PointsAllocation, (typeof PUBLIC_POINTS_ALLOCATION_FIELDS)[number]>>;

/** Writers must never put user ids or contact details in eventData or description (who did it goes to audit_log). */
export const PUBLIC_ACTIVITY_FIELDS = [
  "id",
  "tournamentId",
  "playerId",
  "eventType",
  "eventData",
  "description",
  "timestamp",
] as const satisfies readonly (keyof ActivityLog)[];
export type PublicActivity = Json<Pick<ActivityLog, (typeof PUBLIC_ACTIVITY_FIELDS)[number]>>;
export type ActivityDto = PublicActivity & { player: PublicPlayer | null };

/**
 * GET /api/public/tournaments/:id/players?q= : the QR register page's "find yourself" search.
 * Anonymous viewers search the players who have registered for any tournament of that tournament's
 * club; a viewer who can manage the club searches every player (to register a visitor).
 */
export const publicPlayerSearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Type part of a name").max(60),
  limit: limitSchema(10, 25),
});
export type PublicPlayerSearchQuery = z.infer<typeof publicPlayerSearchQuerySchema>;
