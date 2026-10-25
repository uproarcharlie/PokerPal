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

/** Not started yet: a clock started with "also start the tournament" moves these to in_progress. */
export const UPCOMING_STATUSES = ["scheduled", "registration"] as const satisfies readonly TournamentStatus[];
export type UpcomingStatus = (typeof UPCOMING_STATUSES)[number];

const isOneOf = (statuses: readonly TournamentStatus[], status: string | null | undefined) =>
  status !== null && status !== undefined && (statuses as readonly string[]).includes(status);

/** Completed or cancelled (an unknown or missing status is not closed). */
export const isClosedStatus = (status: string | null | undefined): boolean => isOneOf(CLOSED_STATUSES, status);

/** Taking entries or in progress. */
export const isActiveStatus = (status: string | null | undefined): boolean => isOneOf(ACTIVE_STATUSES, status);

/** Scheduled or open for registration. */
export const isUpcomingStatus = (status: string | null | undefined): status is UpcomingStatus => isOneOf(UPCOMING_STATUSES, status);

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
  // Phase 4 seating (one event per operation; a bust's release and the server's self-heal write none)
  "tables_added",
  "table_updated",
  "table_removed",
  "table_broken",
  "seating_drawn",
  "seat_assigned",
  "seats_swapped",
  "seat_released",
  "seating_balanced",
  "final_table",
  "seating_undone", // the last table break, draw, balance or final table taken back
  // Phase 4 clock (manual actions only: auto-advance writes nothing), shared/domain/clock CLOCK_EVENT_TYPES
  "clock_started",
  "clock_paused",
  "clock_resumed",
  "clock_level_changed",
  "clock_time_adjusted",
  "clock_reset",
  "clock_undone",
  "clock_structure_updated",
  "early_bird",
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/**
 * Activity that is staff bookkeeping rather than part of the game: shown only to people who can
 * manage the tournament's club. Everyone else's feed leaves these entries out.
 */
export const STAFF_ONLY_ACTIVITY_TYPES = [
  "payment_confirmed",
  "rake_rates_changed",
  "table_updated",
  "clock_time_adjusted",
  "clock_reset",
  "clock_undone",
  "clock_structure_updated",
  "early_bird",
] as const satisfies readonly ActivityEventType[];
