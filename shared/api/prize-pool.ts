/**
 * Prize pool and AP (the club's name for rake: clubs.rake_label) for one tournament (spec §5.2 #19-#20).
 * Precedence: a manual prize pool beats the manual AP total (rakeOverride), which beats the AP the
 * rates give. Both overrides are written by one endpoint in one UPDATE, so at most one is ever set.
 * They may be changed while the pool is locked, until the tournament is completed or cancelled
 * (409 TOURNAMENT_CLOSED). Every change is logged to the activity feed and the audit log.
 */
import { z } from "zod";
import type { Cents } from "../domain/money";
import type { PayoutDisplaySource, PrizePoolBreakdown } from "../domain/prize-pool";
import { RAKE_RATE_KEYS } from "../domain/rake-rates";
import { moneySchema, rakeTypeSchema } from "./common";
import type { TournamentDetailDto, TournamentStatus } from "./tournaments";

const reasonSchema = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * PUT /api/tournaments/:id/prize-pool/adjustment
 * - calculated: clear both overrides.
 * - ap_override: a fixed AP total replacing buy-in, re-buy and add-on rake (high-hand rake is
 *   separate). It does not grow with later entries. Over the current gross: 400 AP_EXCEEDS_GROSS
 *   (details: { grossCents }).
 * - manual_pool: a fixed prize pool, which may exceed gross (the club adds the difference).
 */
export const prizePoolAdjustmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("calculated"), reason: reasonSchema }),
  z.object({ mode: z.literal("ap_override"), amount: moneySchema, reason: reasonSchema }),
  z.object({ mode: z.literal("manual_pool"), amount: moneySchema, reason: reasonSchema }),
]);
export type PrizePoolAdjustmentInput = z.infer<typeof prizePoolAdjustmentSchema>;


/**
 * PUT /api/tournaments/:id/prize-pool/rates: change the AP rates after creation. The request is merged
 * over the stored rates per component, then checked: a percentage over 100 is 400 PERCENT_OVER_100
 * and a percentage or fixed type without an amount is 400 AMOUNT_REQUIRED (details: { field }); a
 * fixed rate above the price of its entry is 400 AMOUNT_OVER_PRICE (details: { field }), since the
 * prize pool would go below zero.
 * "none" stores amount "0.00". Unless keepOverride, the AP override is cleared (the manual pool is not).
 */
export const rakeRatesSchema = z
  .object({
    rakeType: rakeTypeSchema.optional(),
    rakeAmount: moneySchema.optional(),
    rebuyRakeType: rakeTypeSchema.optional(),
    rebuyRakeAmount: moneySchema.optional(),
    addonRakeType: rakeTypeSchema.optional(),
    addonRakeAmount: moneySchema.optional(),
    highHandRakeType: rakeTypeSchema.optional(),
    highHandRakeAmount: moneySchema.optional(),
    keepOverride: z.boolean().default(false),
    reason: reasonSchema,
  })
  .refine((input) => RAKE_RATE_KEYS.some((key) => input[key] !== undefined), "Nothing to update");
export type RakeRatesInput = z.infer<typeof rakeRatesSchema>;

/** One paid place as the screens show it. */
export interface PayoutDisplayRowDto {
  position: number;
  amountCents: Cents;
  /** Null for legacy stored prizes, whose share was never recorded. */
  percentage: number | null;
  registrationId?: string;
  playerName?: string;
}

/**
 * Which payouts a screen shows (D20): a completed tournament shows what was paid, from its snapshot
 * ("snapshot"), or, if finalized before snapshots existed, from the stored prizes ("stored"), or says
 * that no prize was recorded when its results were entered by hand ("unrecorded", no rows); a
 * cancelled one pays nothing ("cancelled", no rows); any other tournament shows what finalize would
 * pay now ("live"): the v2 payouts of the current pool, for as many places as there are entrants.
 * `undistributedCents` is the part of the pool nobody is paid (places beyond the entrants, D28),
 * which every payout card warns about.
 */
export interface PayoutDisplayDto {
  source: PayoutDisplaySource;
  rows: PayoutDisplayRowDto[];
  totalCents: Cents;
  undistributedCents: Cents;
}

/**
 * GET /api/tournaments/:id/prize-pool (public), and part of every money response. Computed on the
 * server by shared/domain/prize-pool; a client that computes locally must use the same functions.
 * `breakdown` is always the live calculation; `display` is what to show as the payouts.
 */
export interface PrizePoolDto {
  tournamentId: string;
  status: TournamentStatus;
  /** rakeLabel(club): "AP", or "Rake" by default. */
  rakeLabel: string;
  locked: boolean;
  /** The figures can still change: the pool is not locked and the tournament is not completed. */
  estimated: boolean;
  breakdown: PrizePoolBreakdown;
  display: PayoutDisplayDto;
  /** The last manual adjustment, if any (the reason is public, like the activity feed). */
  adjustment: { reason: string | null; adjustedAt: string } | null;
}

/** PUT /api/tournaments/:id/prize-pool/adjustment and /rates (200). */
export interface ApUpdateResponse {
  tournament: TournamentDetailDto;
  prizePool: PrizePoolDto;
}
