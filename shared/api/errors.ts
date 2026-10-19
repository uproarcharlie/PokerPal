/**
 * The one error body every /api endpoint sends, and the machine-readable codes it can carry.
 * `error` is a sentence for people (the client toasts it); `code` is what code branches on;
 * `details` is code-specific (zod issues for VALIDATION, `{ activePlayers }` for finalize, ...).
 * There is no `message` alias: no client code reads one from an error body.
 */

export interface ApiErrorBody {
  error: string;
  code?: ErrorCode;
  details?: unknown;
}

export const ERROR_CODES = [
  // generic, set by the central error handler
  "VALIDATION", // 400, details: zod issues ({ path, message, code, ... }[])
  "BAD_JSON", // 400, the body is not valid JSON
  "UNAUTHENTICATED", // 401
  "FORBIDDEN", // 403
  "NOT_FOUND", // 404
  "CONFLICT", // 409, a unique constraint with no friendlier code
  "FK_VIOLATION", // 409, a referenced row is missing or still in use
  "CHECK_VIOLATION", // 400
  "RETRY", // 409, deadlock or serialization failure: safe to repeat
  "PAYLOAD_TOO_LARGE", // 413
  "UNSUPPORTED_MEDIA_TYPE", // 415
  "RATE_LIMITED", // 429
  "INTERNAL", // 500, never with internals
  "SERVICE_UNAVAILABLE", // 503
  // auth and admin
  "INVALID_CREDENTIALS",
  "ACCOUNT_DISABLED",
  "EMAIL_TAKEN",
  "WEAK_PASSWORD",
  "WRONG_PASSWORD",
  "LAST_ADMIN",
  "CANNOT_MODIFY_SELF",
  "CANNOT_IMPERSONATE_ADMIN",
  "USER_INACTIVE",
  "NOT_IMPERSONATING",
  "USER_NOT_FOUND",
  // clubs, staff, seasons, points
  "SLUG_TAKEN",
  "CLUB_LIMIT_REACHED", // 409, an account other than an admin's already owns MAX_CLUBS_PER_OWNER clubs
  "ALREADY_MANAGER",
  "IS_OWNER",
  "INVITE_INVALID", // 404, a staff invitation that is unknown, revoked or used by someone else
  "INVITE_EXPIRED", // 409
  "INVITE_FOR_ANOTHER_ACCOUNT", // 403, signed in to an account that does not use the invited address
  "CANNOT_MOVE",
  "SEASON_NOT_IN_CLUB",
  "POINTS_SYSTEM_NOT_IN_SEASON",
  "ALLOCATION_OVERLAP",
  // players, registrations, pending actions
  "PHONE_TAKEN",
  "PLAYER_NOT_FOUND",
  "ALREADY_REGISTERED",
  "TOURNAMENT_FULL",
  "HIGH_HAND_NOT_AVAILABLE",
  "PRIZE_POOL_LOCKED",
  "MAX_REBUYS_REACHED",
  "PLAYER_NOT_REGISTERED",
  "PLAYER_ELIMINATED",
  "ALREADY_ELIMINATED",
  "NOT_ELIMINATED",
  "INVALID_TARGET",
  "DUPLICATE_PENDING_ACTION",
  "NOT_OFFERED", // 409, a re-buy or add-on asked for at a tournament that does not sell one
  "COUNT_BELOW_ZERO",
  "HIGH_HAND_AWARDED",
  "HIGH_HAND_OVER_POOL",
  "HIGH_HAND_ENTRIES", // 409, turning the high hand off while entries are in it (details.entrants)
  "REBUY_BEFORE_ELIMINATION", // 409, confirming a re-buy asked for before the player went out: say whether it puts them back in
  "REGISTRATION_IN_PLAY", // 409, removing an entry that already has results, counts or knockouts
  // tournaments, money, finalize
  "TOURNAMENT_LIMIT_REACHED", // 409, the club already has MAX_UPCOMING_TOURNAMENTS_PER_CLUB upcoming tournaments
  "TOURNAMENT_CLOSED",
  "INVALID_STATUS_TRANSITION",
  "AP_EXCEEDS_GROSS",
  "PERCENT_OVER_100",
  "AMOUNT_REQUIRED",
  "ALREADY_FINALIZED",
  "TOURNAMENT_CANCELLED",
  "ACTIVE_PLAYERS_NEED_ORDER",
  "INVALID_FINISH_ORDER",
  "PLAN_CHANGED",
  "PLAN_HASH_REQUIRED",
  // images
  "NO_FILE",
  "FILE_TOO_LARGE",
  "INVALID_IMAGE",
  "STORAGE_UNAVAILABLE",
  "UPLOAD_TIMEOUT", // 408, the upload's body did not arrive in time
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

/** Whether a parsed response body is an API error, e.g. before reading `error` for a toast. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string";
}
