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
  "PHOTO_REQUIRED", // 400, a QR sign-up at a club that requires a photo (clubs.require_signup_photo) without one, or registering there a player without one added elsewhere
  "PLAYER_NOT_FOUND",
  "ALREADY_REGISTERED",
  "TOURNAMENT_FULL", // 409, accepting a player (payment confirmed, or a waiting-list entry's first re-buy, add-on, knockout or bust) once Max players are in the field (round 5, item 15); sign-ups themselves join the waiting list
  "HIGH_HAND_NOT_AVAILABLE",
  "PRIZE_POOL_LOCKED",
  "MAX_REBUYS_REACHED",
  "MAX_ADDONS_REACHED", // 409, past the tournament's add-ons per player (maxAddons)
  "REBUY_OR_ADDON", // 409, a re-buy and an add-on for one player where the format allows one or the other (rebuyOrAddon)
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
  "HIGH_HAND_ENTRIES", // 409, turning the high hand off (details.entrants) or removing its price (details.count) while entries are in it
  "REBUYS_RECORDED", // 409, removing the re-buy price while re-buys are recorded (details.count)
  "ADDONS_RECORDED", // 409, removing the add-on price while add-ons are recorded (details.count)
  "ENTRIES_REPRICED", // 409, a new price for entries already recorded, sent without repriceEntries (details.changes)
  "REBUY_BEFORE_ELIMINATION", // 409, confirming a re-buy asked for before the player went out: say whether it puts them back in
  "REGISTRATION_IN_PLAY", // 409, removing an entry that already has results, counts or knockouts
  // tournaments, money, finalize
  "TOURNAMENT_LIMIT_REACHED", // 409, the club already has MAX_UPCOMING_TOURNAMENTS_PER_CLUB upcoming tournaments
  "TOURNAMENT_CLOSED",
  "INVALID_STATUS_TRANSITION",
  "AP_EXCEEDS_GROSS",
  "PERCENT_OVER_100",
  "AMOUNT_REQUIRED",
  "AMOUNT_OVER_PRICE", // 400, a fixed AP rate above the price of its entry (details.field): the pool would go below zero
  "ALREADY_FINALIZED",
  "TOURNAMENT_CANCELLED",
  "ACTIVE_PLAYERS_NEED_ORDER",
  "INVALID_FINISH_ORDER",
  "PLAN_CHANGED",
  "PLAN_HASH_REQUIRED",
  "DEAL_INVALID", // 409 (finalize), a deal that does not share exactly what the players still in would be paid (details { dealProblems, dealable })
  "UNPAID_PLAYERS", // 409 (finalize, round 6), players in the field have not paid: confirm them or send excludeUnpaid (details { unpaid, activePlayers })
  // tables and seating (phase4-contracts §2)
  "TABLE_NOT_FOUND", // 404, a table that is not this tournament's
  "TABLE_LIMIT", // 409, more than 50 active tables
  "TABLE_NUMBER_TAKEN", // 409
  "TABLE_OCCUPIED", // 409, removing a table someone sits at (break it or move them first)
  "SEATS_OCCUPIED", // 409, shrinking a table below an occupied seat (details.seatNumbers)
  "TABLES_EXIST", // 409, one-tap setup when a table is already active
  "TABLE_NOT_ACTIVE", // 409, an archived table
  "LAST_TABLE", // 409, breaking the only active table
  "NO_TABLES", // 409
  "INSUFFICIENT_SEATS", // 409, details { needed, available }
  "SEAT_TAKEN", // 409, details { occupantRegistrationId }
  "SEAT_OUT_OF_RANGE", // 400
  "NOT_SEATED", // 409, a swap for a player with no seat
  "PLAYER_NOT_ACTIVE", // 409, eliminated, or not this tournament's (details { registrationId })
  "STALE_PLAN", // 409, balance/break/redraw/final table/move/undo against a seating that changed (details { seating })
  "SEAT_CONFLICT", // 409, a concurrent change took the seat first: refresh and retry
  // clock (phase4-contracts §3); every 409 carries details { display: LiveDisplayDto }
  "NO_CLOCK", // 404
  "CLOCK_EXISTS",
  "STRUCTURE_CHANGED",
  "CURRENT_LEVEL_REMOVED",
  "CLOCK_FINISHED",
  "LEVEL_CHANGED",
  "LEVEL_OUT_OF_RANGE",
  "NO_NEXT_LEVEL", // 409, next on the final level (the structure ran out): add levels to go on
  "NO_PREVIOUS_LEVEL", // 409, prev on the first level
  "NOTHING_TO_UNDO", // also seating's undo, with details { seating }: the change was undone already or is no longer the last
  "NO_LEVELS",
  "VERSION_CONFLICT", // 409, the clock changed on every one of the server's retries
  "CLOCK_IN_USE", // 409, removing a clock that is running or paused: reset it first
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
