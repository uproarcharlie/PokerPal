/** /api/tournaments/*: tournament config, listing and the activity feed. Money endpoints: prize-pool.ts, finalize.ts. */
import { z } from "zod";
import { PAYOUT_STRUCTURE_KEYS, parseCustomPayouts } from "../domain/payouts";
import { HIGH_HAND_PRIZES_MAX } from "../domain/prize-pool";
import { TOURNAMENT_STATUSES } from "../domain/tournaments";
import {
  dateSchema,
  idSchema,
  imageUrlSchema,
  integerSchema,
  limitSchema,
  moneySchema,
  nullableIntegerSchema,
  optionalMoneySchema,
  optionalText,
  rakeTypeSchema,
  requiredText,
  type WithViewer,
} from "./common";
import type { PrizePoolSnapshot, PublicPrizePoolSnapshot } from "./finalize";
import type { PublicTournament } from "./public";

export type { ActivityEventType, TournamentStatus } from "../domain/tournaments";
export const tournamentStatusSchema = z.enum(TOURNAMENT_STATUSES);

export { PAYOUT_STRUCTURE_KEYS };


/** JSON array of percentages for 1st place onwards, e.g. "[60,40]"; checked by shared/domain/payouts. */
const customPayoutsSchema = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .max(2000)
      .nullable()
      .superRefine((raw, ctx) => {
        if (raw === null) return;
        const parsed = parseCustomPayouts(raw);
        if (!parsed.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error });
      }),
  )
  .optional();

/** Config fields shared by create and update. Money is decimal(10,2) text; rates are checked by mergeRakeRates. */
const configFields = {
  name: requiredText(120),
  description: optionalText(5000),
  imageUrl: imageUrlSchema,
  seasonId: z.preprocess((value) => (value === "" ? null : value), idSchema.nullable()).optional(),
  pointsSystemId: z.preprocess((value) => (value === "" ? null : value), idSchema.nullable()).optional(),
  startDateTime: dateSchema,
  buyInAmount: moneySchema,
  rebuyAmount: optionalMoneySchema,
  addonAmount: optionalMoneySchema,
  maxRebuys: nullableIntegerSchema(0, 1000),
  rebuyPeriodMinutes: nullableIntegerSchema(0, 24 * 60),
  rakeType: rakeTypeSchema,
  rakeAmount: optionalMoneySchema,
  rebuyRakeType: rakeTypeSchema.optional(),
  rebuyRakeAmount: optionalMoneySchema,
  addonRakeType: rakeTypeSchema.optional(),
  addonRakeAmount: optionalMoneySchema,
  payoutStructure: z.enum(PAYOUT_STRUCTURE_KEYS),
  customPayouts: customPayoutsSchema,
  enableHighHand: z.boolean().optional(),
  highHandAmount: optionalMoneySchema,
  highHandRakeType: rakeTypeSchema.optional(),
  highHandRakeAmount: optionalMoneySchema,
  highHandPayouts: integerSchema(1, HIGH_HAND_PRIZES_MAX).optional(),
  enableLateRegistration: z.boolean().optional(),
  trackPoints: z.boolean().optional(),
  minPlayers: nullableIntegerSchema(0, 1000),
  maxPlayers: integerSchema(2, 1000),
  useClubAddress: z.boolean().optional(),
  address: optionalText(300),
};

/**
 * The most upcoming tournaments (scheduled or open for registration, not started more than a few hours
 * ago) one club may have. Upcoming tournaments are listed on the public home page and any account can
 * open a club, so a club cannot flood it (SEC-P2REV-04); no real club plans this far ahead.
 */
export const MAX_UPCOMING_TOURNAMENTS_PER_CLUB = 100;

/**
 * POST /api/tournaments. The caller must be able to manage `clubId`; seasonId must be one of that
 * club's seasons (400 SEASON_NOT_IN_CLUB) and pointsSystemId one of that season's systems
 * (400 POINTS_SYSTEM_NOT_IN_SEASON). New tournaments start as a draft ("scheduled") or open
 * ("registration"). The AP rates are merged over "none" and checked by mergeRakeRates
 * (shared/domain/rake-rates), exactly as every later change is: 400 PERCENT_OVER_100, or
 * AMOUNT_REQUIRED for a percentage or fixed rate with no amount; a rate of "none" stores 0.00. Money
 * set by the AP endpoints and finalize is never accepted here. A club has at most
 * MAX_UPCOMING_TOURNAMENTS_PER_CLUB upcoming tournaments (409 TOURNAMENT_LIMIT_REACHED), and an
 * account or visitor creates only so many per hour (429).
 */
export const createTournamentSchema = z.object({
  ...configFields,
  // As the columns' defaults: no rake, Standard payouts.
  rakeType: rakeTypeSchema.default("none"),
  payoutStructure: z.enum(PAYOUT_STRUCTURE_KEYS).default("standard"),
  clubId: idSchema,
  status: z.enum(["scheduled", "registration"]).default("scheduled"),
});
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

/**
 * PUT /api/tournaments/:id: any subset of the config, plus:
 * - clubId: accepted only when unchanged (400 CANNOT_MOVE); a tournament never changes club.
 * - status: not "completed" (that is finalize's job: 400 INVALID_STATUS_TRANSITION). A completed
 *   tournament's status cannot change; a cancelled one may be reopened as scheduled or registration.
 * - prizePoolLocked: true stamps prizePoolLockedAt on the server and logs "prize_pool_locked".
 * - manualPrizePool: routed through the prize-pool adjustment service (mode manual_pool, or
 *   calculated for null/blank), so it clears rakeOverride and is logged (spec D13).
 * - AP rates (rakeType/rakeAmount and the re-buy, add-on and high-hand pairs): merged over the stored
 *   rates and checked exactly as PUT …/prize-pool/rates does (400 PERCENT_OVER_100, AMOUNT_REQUIRED),
 *   logged and audited the same way; a change to the buy-in, re-buy or add-on rate clears the manual
 *   AP total (the high-hand rake does not: the high hand is never part of it).
 * - buy-in, re-buy or add-on amounts may not drop the gross below a manual AP total (400 AP_EXCEEDS_GROSS).
 * - the high-hand settings (enabled, fee, rake, number of prizes) may not leave the awards already
 *   made not fitting the pot (409 HIGH_HAND_OVER_POOL / HIGH_HAND_AWARDED: take an award back first).
 * Money config is refused once the tournament is completed or cancelled (409 TOURNAMENT_CLOSED); a
 * value resent unchanged is accepted.
 */
export const updateTournamentSchema = z
  .object({
    ...configFields,
    clubId: idSchema,
    status: tournamentStatusSchema,
    prizePoolLocked: z.boolean(),
    /**
     * The TD was told what a new price re-prices among the entries already recorded (409 ENTRIES_REPRICED,
     * answered only once nothing else refuses the change).
     */
    repriceEntries: z.boolean(),
    manualPrizePool: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      moneySchema.nullable(),
    ),
  })
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), "Nothing to update");
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;

/**
 * GET /api/tournaments?clubId=&seasonId=&status=&upcoming=true&limit= : every filter given applies;
 * oldest created first. `upcoming` keeps the tournaments not started yet (scheduled or open for
 * registration), soonest start first; `limit` keeps a public page's list short (the home page).
 */
export const tournamentsQuerySchema = z.object({
  clubId: idSchema.optional(),
  seasonId: idSchema.optional(),
  status: tournamentStatusSchema.optional(),
  upcoming: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type TournamentsQuery = z.infer<typeof tournamentsQuerySchema>;

/** GET /api/tournaments: one SQL query, counts by aggregate (no per-tournament queries: perf-19). */
/**
 * GET /api/tournaments/counts: how many tournaments each club and each season has, and how many of a
 * club's are active, so the Clubs and Seasons pages count them without downloading every tournament
 * ever run (P3REV3-CQ-12). A club or season with none is left out (read it as 0).
 */
export interface TournamentCountsDto {
  clubs: Record<string, { total: number; active: number }>;
  seasons: Record<string, number>;
}

export type TournamentListItemDto = PublicTournament & {
  /**
   * Registrations with payment confirmed, for someone who runs the tournament's club; null for
   * everyone else (who has paid is staff bookkeeping: P2REV0-SEC-04).
   */
  confirmedPlayerCount: number | null;
  registeredCount: number;
};

/** GET /api/tournaments/:id, and the body of create/update. */
export type TournamentDetailDto = WithViewer<
  PublicTournament & {
    /**
     * What finalize paid; null until finalized (and for tournaments finalized before v2). Its
     * `warnings` are sent only to people who run the club (`PUBLIC_SNAPSHOT_FIELDS`).
     */
    prizePoolSnapshot: (PublicPrizePoolSnapshot & Partial<Pick<PrizePoolSnapshot, "warnings">>) | null;
  }
>;

/**
 * GET /api/tournaments/:id/activity?limit= : newest first. The default covers a whole big night (a
 * 50-player game with re-buys and add-ons logs about 300 entries), so the feed never loses its start.
 */
export const activityQuerySchema = z.object({ limit: limitSchema(1000, 2000) });
