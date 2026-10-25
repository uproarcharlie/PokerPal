/**
 * POST /api/tournaments/:id/finalize/preview and /finalize (spec §5.2 #21-#22, §5.5, D18-D20).
 *
 * Finalize runs in one transaction: lock the tournament and its registrations, build the plan with
 * shared/domain (computePrizePool + allocatePayouts: whole-dollar shares floored, the leftover
 * dollars and cents to 1st, so the places add up to the pool exactly), check `expectedPlanHash`,
 * write positions, prizes, points, status "completed", finalizedAt/By and the immutable snapshot,
 * then the activity entry and the audit row. What the preview shows is what finalize pays.
 */
import { z } from "zod";
import { DEAL_LIMITS, type Dealable, type DealInput, type DealProblem } from "../domain/deal";
import type { PrizePoolSnapshot } from "../domain/finalize";
import { toCents, type Cents } from "../domain/money";
import { idSchema, moneySchema, requiredText } from "./common";
import type { PrizePoolDto } from "./prize-pool";

/** sha256 hex of the plan, first 32 characters (see buildFinalizePlan). */
export const planHashSchema = z.string().regex(/^[0-9a-f]{32}$/, "Invalid plan hash");

/**
 * A correction (`force` on a completed tournament) scores season points with the rules its first
 * finalize froze in the snapshot, not the tournament's points settings as they are now (P2REV1-01).
 *
 * - finishOrder: the ACTIVE (not eliminated) registration ids, best first. Required when two or more
 *   players are still in (409 ACTIVE_PLAYERS_NEED_ORDER); must be exactly those ids
 *   (409 INVALID_FINISH_ORDER). With one player in it may be omitted. Eliminated players are ranked
 *   by elimination time, latest first, ties by registration id. Or EVERY registration id, best first:
 *   the whole order as given, which is how a re-finalize corrects who busted when (D19).
 * - expectedPlanHash: the preview's planHash. If the plan changed since (a late rebuy, an edit),
 *   409 PLAN_CHANGED with `details: { preview }`. Required with `force` (400 PLAN_HASH_REQUIRED).
 * - force: re-finalize a completed tournament (never a cancelled one), after a preview.
 */
/**
 * A deal or chop (round 5): what each player still in is paid instead of their place's payout, and
 * why. It must name every player still in exactly once, and the amounts must add up to what their
 * places pay together (FinalizePreviewDto.dealable.totalCents): otherwise the preview is not ok
 * (code DEAL_INVALID, `dealProblems` say what to fix) and finalize answers 409 DEAL_INVALID
 * (details: { dealProblems, dealable }). The finish order still decides positions and season points.
 * Recorded in the snapshot (`deal`), the activity feed ("deal") and the audit log.
 */
export const dealSchema = z.object({
  amounts: z
    .array(z.object({ registrationId: idSchema, amount: moneySchema }))
    .min(2, "A deal needs two or more players")
    .max(50),
  reason: requiredText(DEAL_LIMITS.maxReasonLength),
});
export type DealRequest = z.infer<typeof dealSchema>;

/** The domain's form of a validated deal: amounts in cents. */
export function toDealInput(deal: DealRequest): DealInput {
  return { reason: deal.reason, amounts: deal.amounts.map(({ registrationId, amount }) => ({ registrationId, amountCents: toCents(amount) })) };
}

export const finalizeSchema = z.object({
  finishOrder: z.array(idSchema).max(500).optional(),
  expectedPlanHash: planHashSchema.optional(),
  force: z.boolean().optional(),
  deal: dealSchema.optional(),
});
export type FinalizeInput = z.infer<typeof finalizeSchema>;

/** POST /api/tournaments/:id/finalize/preview: the same inputs, no writes. */
export const finalizePreviewSchema = finalizeSchema.pick({ finishOrder: true, force: true, deal: true });
export type FinalizePreviewInput = z.infer<typeof finalizePreviewSchema>;

export { FINALIZE_SNAPSHOT_VERSION } from "../domain/finalize";
/**
 * tournaments.prize_pool_snapshot: what finalize paid, frozen (defined with the plan that builds it).
 * Completed tournaments are displayed from it (D20) and never recomputed.
 */
export type { PrizePoolSnapshot };

/**
 * What anyone may see of a snapshot on GET /api/tournaments/:id: the pool, who was paid what and the
 * points rules scored with. Its `warnings` are the TD's bookkeeping (how many payments were not
 * confirmed, which player requests finalize discarded) and go only to people who run the club
 * (P2REV1-MONEY-02, SEC-P2REV-05), like payment status and pending requests everywhere else.
 */
export const PUBLIC_SNAPSHOT_FIELDS = [
  "v",
  "algorithm",
  "finalizedAt",
  "entrants",
  "finishOrderSource",
  "pool",
  "points",
  "deal",
  "paid",
] as const satisfies readonly (keyof PrizePoolSnapshot)[];
export type PublicPrizePoolSnapshot = Pick<PrizePoolSnapshot, (typeof PUBLIC_SNAPSHOT_FIELDS)[number]>;

/** One registration as finalize will write it. prizeAmount is the decimal text stored ("238.00") or null. */
export interface FinalizeRowDto {
  registrationId: string;
  playerId: string;
  playerName: string;
  finalPosition: number;
  amountCents: Cents;
  prizeAmount: string | null;
  pointsAwarded: number | null;
}

export type FinalizeRefusal =
  | "ACTIVE_PLAYERS_NEED_ORDER"
  | "INVALID_FINISH_ORDER"
  | "ALREADY_FINALIZED"
  | "TOURNAMENT_CANCELLED"
  | "DEAL_INVALID";

/** POST /api/tournaments/:id/finalize/preview (200 even when finalize would refuse: see `ok`/`code`). */
export interface FinalizePreviewDto {
  ok: boolean;
  code?: FinalizeRefusal;
  message?: string;
  /** True for a completed tournament: finalize then needs force + expectedPlanHash. */
  requiresForce: boolean;
  planHash?: string;
  prizePool: PrizePoolDto;
  rows: FinalizeRowDto[];
  /** Still-in players, for the finish-order picker. */
  activePlayers: Array<{ registrationId: string; playerId: string; playerName: string }>;
  /**
   * What a deal shares (round 5): the players still in, with what their places pay once the finish
   * order is known, and the total a deal must add up to. Null with fewer than two players still in.
   * With a deal in the request, `rows` already pay the deal's amounts.
   */
  dealable: Dealable | null;
  /** Why the deal sent cannot be paid (code DEAL_INVALID); empty otherwise. */
  dealProblems: DealProblem[];
  /**
   * E.g. pool not locked, N payments not confirmed, $X undistributed, AP override or manual pool
   * active, player requests that will be discarded, points that change on a correction.
   */
  warnings: string[];
  /**
   * Player requests still waiting (re-buys, add-ons, knockout claims): finalize discards them, and the
   * plan hash covers them, so one that arrives after the preview is a PLAN_CHANGED (P2REV1-02).
   */
  pendingRequests: Array<{ id: string; actionType: string; playerName: string; targetPlayerName: string | null }>;
  /**
   * What was paid last time, for a re-finalize (from the snapshot, or stored prizes for legacy rows),
   * and every registration's stored place and points, to show beside the new ones.
   */
  previous: {
    finalizedAt: string | null;
    rows: Array<{ position: number; playerName: string; amountCents: Cents }>;
    results: Array<{ registrationId: string; finalPosition: number | null; pointsAwarded: number | null }>;
  } | null;
}

/** POST /api/tournaments/:id/finalize (200). */
export interface FinalizeResultDto {
  success: true;
  message: string;
  snapshot: PrizePoolSnapshot;
}
