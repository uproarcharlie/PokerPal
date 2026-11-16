/**
 * What anyone may see. Public projections are allowlists of columns, never a row minus some fields,
 * so a column added later stays private until it is listed here. No public body may carry email,
 * phone, userId, passwordHash, ownerId or any other user id (FORBIDDEN_PUBLIC_KEYS); the server's
 * PII deep-scan test runs `findForbiddenKeys` over every public response.
 *
 * Nor what the club takes (round 6, the owner: "Don't show the rake or what is kept by the club"): its
 * AP, its rates, a manual AP total or prize pool and the reason for it, what it keeps, adds or carries
 * over (FORBIDDEN_TAKINGS_KEYS). Only people who run the club are sent those; everyone else, and every
 * screen in the room (the TV), gets the prize pool and the payouts the server works out from them
 * (shared/api/live-display: PublicPrizesDto, LiveDisplayDto.money), and the money carried in from an
 * earlier game.
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
  // Who gave a free entry (round 7): a user id, kept on the server for the audit log.
  "freeEntryBy",
] as const;

/** Paths of every key of `keys` in `value`, at any depth, JSON text inside strings included. */
function findKeys(keys: ReadonlySet<string>, value: unknown, path: string): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return [];
    try {
      return findKeys(keys, JSON.parse(text), `${path}<json>`);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item, i) => findKeys(keys, item, `${path}[${i}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    return [...(keys.has(key) ? [childPath] : []), ...findKeys(keys, child, childPath)];
  });
}

const FORBIDDEN: ReadonlySet<string> = new Set(FORBIDDEN_PUBLIC_KEYS);

/**
 * Paths (e.g. "[0].player.phone") of every forbidden key in `value`, including inside JSON-encoded
 * string fields such as activity_log.event_data. Empty when the body is safe to serve publicly.
 */
export const findForbiddenKeys = (value: unknown): string[] => findKeys(FORBIDDEN, value, "");

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
  // Round 5: the tables' defaults, whether the QR sign-up asks for a photo, and the colours every page of the club wears.
  "defaultSeatsPerTable",
  "defaultTableShape",
  "requireSignupPhoto",
  "theme",
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

/**
 * A tournament as anyone may see it: every column except the audit user ids, the (large) finalize
 * snapshot and the club's takings (TOURNAMENT_TAKINGS_FIELDS). The money carried into its pool from an
 * earlier game (`carriedIn`, round 5 item 16) is public: it is what players play for.
 */
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
  "maxAddons",
  "rebuyOrAddon",
  "rebuyPeriodMinutes",
  "payoutStructure",
  "customPayouts",
  "enableHighHand",
  "highHandAmount",
  "highHandPayouts",
  "enableLateRegistration",
  "trackPoints",
  "minPlayers",
  "maxPlayers",
  "prizePoolLocked",
  "prizePoolLockedAt",
  "finalizedAt",
  "useClubAddress",
  "address",
  // Round 5 seating settings (stored values; null takes the club's or the app's default: resolveSeatingSettings).
  "seatsPerTable",
  "startingTables",
  "openTableAt",
  "autoSeat",
  "tableShape",
  "createdAt",
  "carriedIn",
] as const satisfies readonly (keyof Tournament)[];

/**
 * What the club takes of a tournament, and how (round 6): its AP rates (buy-in, re-buy, add-on and
 * high hand), a manual AP total, the reason and time the pool was last adjusted, and where a
 * difference between the prizes as set and the money available goes (round 5 item 16). Also a prize
 * pool fixed by hand (R7FREV0-LEAK-01): since round 7 the pool shown is what the places pay, so a manual
 * pool beside it would tell anyone the leftover the club keeps (the public prize pool,
 * GET /api/public/tournaments/:id/prizes, says what the players play for). Sent only to someone who runs
 * the club (the server's toPublicTournament), for the AP panel, the payout editor and the tournament
 * form. (The public `customPayouts` still shows percentages adding up to less than 100% as set, and so
 * the share such a structure leaves the club: what each place is paid is public by design.)
 */
export const TOURNAMENT_TAKINGS_FIELDS = [
  "manualPrizePool",
  "rakeType",
  "rakeAmount",
  "rebuyRakeType",
  "rebuyRakeAmount",
  "addonRakeType",
  "addonRakeAmount",
  "highHandRakeType",
  "highHandRakeAmount",
  "rakeOverride",
  "prizePoolAdjustmentReason",
  "prizePoolAdjustedAt",
  "prizeDifference",
] as const satisfies readonly (keyof Tournament)[];
export type TournamentTakings = Json<Pick<Tournament, (typeof TOURNAMENT_TAKINGS_FIELDS)[number]>>;

/**
 * A tournament as the API answers it: the public fields, and the takings only for a viewer who runs its
 * club (absent for everyone else, so a public page can never show them by mistake).
 */
export type PublicTournament = Json<Pick<Tournament, (typeof PUBLIC_TOURNAMENT_FIELDS)[number]>> & Partial<TournamentTakings>;

/**
 * Keys that tell what the club takes (round 6): the takings columns, and the figures the prize-pool
 * maths, the finalize snapshot, the TV and the activity feed work them into (the AP itself, the gross
 * the pool is taken from, how the pool was set, what was kept, added or carried over, and to where),
 * and what it pays in for free entries, how many it gave and to whom (round 7: a registration's free
 * entry, whether the club funds it and why, are the staff's bookkeeping, as its payment is). None may appear in a body sent
 * to someone who does not run the club, nor in any body the TV or the public prize pool is sent,
 * whoever looks: the server's no-takings scan runs `findTakingsKeys` over every public response. The
 * club's name for its take (`rakeLabel`) is not a figure, and stays public.
 */
export const FORBIDDEN_TAKINGS_KEYS = [
  ...TOURNAMENT_TAKINGS_FIELDS,
  "rake",
  "impliedRake",
  "impliedRakeCents",
  "rakeCalculatedCents",
  "rakeOverrideCents",
  "netAfterAp",
  "netSource",
  "gross",
  "grossCents",
  "difference",
  "keptByClubCents",
  "carriedOverCents",
  "addedByClubCents",
  "addedToPrizesCents",
  "carryTarget",
  "apCents",
  "clubAddedCents",
  "adjustment",
  "freeEntries",
  "freeBuyIns",
  "fundedFreeEntries",
  "fundedBuyIns",
  "freeEntry",
  "freeEntryFunded",
  "freeEntryReason",
  "freeEntryNote",
  "freeEntryAt",
] as const;

const TAKINGS: ReadonlySet<string> = new Set(FORBIDDEN_TAKINGS_KEYS);

/** Paths of every takings key in `value` (FORBIDDEN_TAKINGS_KEYS), as findForbiddenKeys finds personal data. */
export const findTakingsKeys = (value: unknown): string[] => findKeys(TAKINGS, value, "");

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
  "earlyBird",
] as const satisfies readonly (keyof TournamentRegistration)[];
export type PublicRegistrationRow = Json<Pick<TournamentRegistration, (typeof PUBLIC_REGISTRATION_FIELDS)[number]>>;

/**
 * Round 5 (item 15): an entry's place on the waiting list behind a full field (1 = next in, sign-up
 * order: shared/domain/waiting-list), or null when it is in the field. Public, like the standings it
 * is shown in. Every registration list, sign-up, payment confirmation and update answers with it;
 * optional only because count changes and player requests do not work it out.
 */
export interface WaitingListPlace {
  waitingListPosition?: number | null;
}

/** GET /api/tournaments/:id/registrations */
export type PublicRegistration = PublicRegistrationRow & WaitingListPlace & { player: PublicPlayer | null };

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

/** The longest name a player may have (POST /api/players, PUT /api/players/:id). */
export const PLAYER_NAME_MAX = 100;

/** The longest part of a name the "find yourself" search takes. */
export const NAME_SEARCH_MAX = 60;

/**
 * GET /api/public/tournaments/:id/players?q= : the QR register page's "find yourself" search.
 * Anonymous viewers search the players who have registered for any tournament of that tournament's
 * club; a viewer who can manage the club searches every player (to register a visitor).
 *
 * `match`: "contains" (the default) finds names containing `q`, A to Z; "exact" finds the players
 * called exactly `q` (a whole name, up to PLAYER_NAME_MAX), its spacing tidied and its case folded as
 * normaliseName compares names (round 7, item 9: "Already played here? That's me", which must find a
 * returning player however many other names contain theirs: R7FREV1-01).
 */
export const publicPlayerSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1, "Type part of a name").max(PLAYER_NAME_MAX),
    match: z.enum(["contains", "exact"]).default("contains"),
    limit: limitSchema(10, 25),
  })
  .refine((query) => query.match === "exact" || query.q.length <= NAME_SEARCH_MAX, {
    path: ["q"],
    message: `Type at most ${NAME_SEARCH_MAX} characters`,
  });
export type PublicPlayerSearchQuery = z.infer<typeof publicPlayerSearchQuerySchema>;
