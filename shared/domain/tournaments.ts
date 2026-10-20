/**
 * The tournament vocabularies: the lifecycle statuses and the activity feed's event types. Plain
 * constants, so a page that only shows a tournament (its status badge, its feed) does not load the
 * request schemas in shared/api/tournaments.ts or zod with them. PURE: no runtime imports.
 */

export const TOURNAMENT_STATUSES = ["scheduled", "registration", "in_progress", "completed", "cancelled"] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

/** No further registrations, counts, eliminations or money changes. Reached only via finalize or cancel. */
export const CLOSED_STATUSES: readonly TournamentStatus[] = ["completed", "cancelled"];

/** Taking entries or being played: what the club and dashboard pages count as "active". */
export const ACTIVE_STATUSES: readonly TournamentStatus[] = ["registration", "in_progress"];

const isOneOf = (statuses: readonly TournamentStatus[], status: string | null | undefined) =>
  status !== null && status !== undefined && (statuses as readonly string[]).includes(status);

/** Completed or cancelled (an unknown or missing status is not closed). */
export const isClosedStatus = (status: string | null | undefined): boolean => isOneOf(CLOSED_STATUSES, status);

/** Taking entries or in progress. */
export const isActiveStatus = (status: string | null | undefined): boolean => isOneOf(ACTIVE_STATUSES, status);

/**
 * Every activity_log.event_type the app writes, so writers, the staff-only filter and the client's
 * feed all name the same set (rows written before Phase 2 may hold other text, which the feed shows
 * plainly).
 */
export const ACTIVITY_EVENT_TYPES = [
  "registration",
  "registration_removed",
  "elimination",
  "knockout_credited", // a claim credited for a player the TD had already marked out: not a second elimination
  "player_restored",
  "rebuy",
  "addon",
  "reentry",
  "payment_confirmed",
  "high_hand",
  "status_change",
  "prize_pool_locked",
  "prize_pool_adjusted",
  "rake_rates_changed",
  "tournament_refinalized",
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/**
 * Activity that is staff bookkeeping rather than part of the game: shown only to people who can
 * manage the tournament's club. Everyone else's feed leaves these entries out.
 */
export const STAFF_ONLY_ACTIVITY_TYPES = ["payment_confirmed", "rake_rates_changed"] as const satisfies readonly ActivityEventType[];
