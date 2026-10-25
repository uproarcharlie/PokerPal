/**
 * Prize pool and AP (the club's name for rake: clubs.rake_label) for one tournament (spec §5.2 #19-#20).
 * Precedence: a manual prize pool beats the manual AP total (rakeOverride), which beats the AP the
 * rates give. Both overrides are written by one endpoint in one UPDATE, so at most one is ever set.
 * They may be changed while the pool is locked, until the tournament is completed or cancelled
 * (409 TOURNAMENT_CLOSED). Every change is logged to the activity feed and the audit log.
 */
import { z } from "zod";
import { toCents, type Cents } from "../domain/money";
import { PAYOUT_PLACE_LIMITS, PAYOUT_STRUCTURE_KEYS, payoutPlacesProblems, type PayoutPlace } from "../domain/payouts";
import { PRIZE_DIFFERENCE_CHOICES, type CarriedIn } from "../domain/prize-difference";
import type { PayoutDisplaySource, PrizePoolBreakdown } from "../domain/prize-pool";
import { RAKE_RATE_KEYS } from "../domain/rake-rates";
import { idSchema, moneySchema, rakeTypeSchema } from "./common";
import type { TournamentDetailDto, TournamentStatus } from "./tournaments";

const reasonSchema = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * Where a difference between the prizes as set and the money available for prizes goes (round 5,
 * item 16; tournaments.prize_difference, shared/domain/prize-difference): the club keeps it (the
 * default), it is added to 1st, shared across the paid places, or carried over. Sent with a manual
 * prize pool or custom places; left out, the stored choice stays as it is.
 */
export const prizeDifferenceSchema = z.enum(PRIZE_DIFFERENCE_CHOICES);

/**
 * PUT /api/tournaments/:id/prize-pool/adjustment
 * - calculated: clear both overrides.
 * - ap_override: a fixed AP total replacing buy-in, re-buy and add-on rake (high-hand rake is
 *   separate). It does not grow with later entries. Over the current gross: 400 AP_EXCEEDS_GROSS
 *   (details: { grossCents }).
 * - manual_pool: a fixed prize pool, which may exceed gross (the club adds the difference), with
 *   where any difference below what is available goes (`prizeDifference`).
 */
export const prizePoolAdjustmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("calculated"), reason: reasonSchema }),
  z.object({ mode: z.literal("ap_override"), amount: moneySchema, reason: reasonSchema }),
  z.object({ mode: z.literal("manual_pool"), amount: moneySchema, prizeDifference: prizeDifferenceSchema.optional(), reason: reasonSchema }),
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

/** One place of a custom structure as the payout editor sends it: a percentage of the pool (at most 2 decimal places) or an amount. */
export const payoutPlaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), percent: z.number().gt(0, "Above 0%").max(100, "At most 100%") }),
  z.object({ kind: z.literal("amount"), amount: moneySchema }),
]);
export type PayoutPlaceInput = z.infer<typeof payoutPlaceSchema>;

/**
 * The domain's form of the places sent: percentages in basis points (one with more than 2 decimal
 * places stays a fraction of a basis point, which payoutPlacesProblems refuses), amounts in cents.
 */
export function toPayoutPlaces(places: readonly PayoutPlaceInput[]): PayoutPlace[] {
  return places.map((place): PayoutPlace => {
    if (place.kind === "amount") return { kind: "amount", amountCents: toCents(place.amount) };
    const basisPoints = Math.round(place.percent * 100);
    return { kind: "percent", basisPoints: Math.abs(place.percent * 100 - basisPoints) > 1e-6 ? place.percent * 100 : basisPoints };
  });
}

/**
 * PUT /api/tournaments/:id/prize-pool/payouts (round 5, the payout editor; staff, mid-game too): the
 * payout structure, and for "custom" its places (required, 1 to 50, each a percentage of the pool or a
 * fixed amount, checked by shared/domain/payouts payoutPlacesProblems: 400 VALIDATION with each issue
 * at `places[i]`). Stored in tournaments.custom_payouts by serializeCustomPayouts (the classic array
 * when every place is a percentage adding up to 100%). A standard structure leaves the stored custom
 * places as they are, so going back to Custom brings them back.
 * The places are paid as set (round 5, item 16): when they add up to less than the money available,
 * `prizeDifference` says where the rest goes (left out: the stored choice, else the club keeps it);
 * when they add up to more, the club adds the difference ("Added by the club"). Allowed while the pool
 * is locked (the published payouts change: the editor says so), until the tournament is completed or
 * cancelled (409 TOURNAMENT_CLOSED). A change (of the structure, the places or the choice) is logged to
 * the activity feed ("payouts_changed", staff-only since round 6, with the reason and where the difference goes) and
 * audited ("tournament.payouts"); sending what is stored changes and logs nothing. Answers
 * ApUpdateResponse.
 */
const payoutPlacesSchema = z.array(payoutPlaceSchema).min(1, "Pay at least one place").max(PAYOUT_PLACE_LIMITS.maxPlaces);

export const payoutsUpdateSchema = z
  .object({
    payoutStructure: z.enum(PAYOUT_STRUCTURE_KEYS),
    places: payoutPlacesSchema.optional(),
    prizeDifference: prizeDifferenceSchema.optional(),
    reason: reasonSchema,
  })
  .superRefine((input, ctx) => {
    if (input.payoutStructure !== "custom") return;
    if (!input.places) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["places"], message: "Set up the places a custom structure pays" });
      return;
    }
    // Places their own rules already refused (a blank amount, 150%, none at all) are not judged again as a whole.
    if (!payoutPlacesSchema.safeParse(input.places).success) return;
    for (const problem of payoutPlacesProblems(toPayoutPlaces(input.places))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: problem.place === null ? ["places"] : ["places", problem.place - 1], message: problem.message });
    }
  });
export type PayoutsUpdateInput = z.infer<typeof payoutsUpdateSchema>;

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
 * GET /api/tournaments/:id/prize-pool (the club's staff, round 6: it carries the AP and what the club
 * keeps; the public page reads GET /api/public/tournaments/:id/prizes), and part of every money response. Computed on the
 * server by shared/domain/prize-pool; a client that computes locally must use the same functions.
 * `breakdown` is always the live calculation; `display` is what to show as the payouts. Only paid
 * players' entries are in either (round 6, poolEntries: `breakdown.counts.registrations` is how many
 * paid), except for a tournament completed before snapshots, shown as it was paid.
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
  /** The last manual adjustment, if any (its reason is the staff's, like the activity entry). */
  adjustment: { reason: string | null; adjustedAt: string } | null;
  /**
   * Where money carried over from this tournament goes, as the screens name it (carryTargetName): its
   * season ("Winter League"), else "the next tournament" (round 5, item 16).
   */
  carryTarget: string;
}

/**
 * Money another tournament of the club carried over (round 5, item 16; a prize_carry_overs row) that
 * this tournament may add to its pool: from a completed tournament of the same season, or of the
 * club when it had no season.
 */
export interface CarryOverDto {
  id: string;
  fromTournamentId: string;
  /** The tournament's name when it was finalized. */
  fromName: string;
  /** When that tournament was finalized (ISO). */
  carriedAt: string;
  amountCents: Cents;
  /** The season it was carried over to, or null for the club's next tournament. */
  seasonName: string | null;
}

/**
 * GET /api/tournaments/:id/prize-pool/carry-overs (the club's staff): what this tournament may add to
 * its pool, and what it already has (tournaments.carried_in).
 */
export interface CarryOversDto {
  available: CarryOverDto[];
  carriedIn: CarriedIn[];
}

/**
 * POST /api/tournaments/:id/prize-pool/carry-overs/:carryOverId adds that money to this pool;
 * DELETE takes it out again (it is then free for another tournament). Both while the tournament is
 * open (409 TOURNAMENT_CLOSED), logged to the staff's feed ("prize_pool_adjusted"); 404 for a carry-over this
 * tournament cannot take, 409 CONFLICT when another tournament took it first. Answers
 * ApUpdateResponse.
 */
export const carryOverParamsSchema = z.object({ id: idSchema, carryOverId: idSchema });

/** PUT /api/tournaments/:id/prize-pool/adjustment and /rates (200). */
export interface ApUpdateResponse {
  tournament: TournamentDetailDto;
  prizePool: PrizePoolDto;
}
