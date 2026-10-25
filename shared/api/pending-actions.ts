/**
 * Pending actions: a player asks (from the public player-actions page) for a re-buy, an add-on or to
 * record a knockout; staff confirm or dismiss it.
 */
import { z } from "zod";
import { PLAYER_ACTION_TYPES } from "../domain/player-actions";
import type { PendingAction } from "../schema";
import { idSchema, type Json } from "./common";
import type { PublicPlayer } from "./public";
import type { ManagedRegistration } from "./registrations";

/**
 * POST /api/tournaments/:id/pending-actions, anyone (public-write limit). Rules: the tournament is not
 * completed or cancelled (409 TOURNAMENT_CLOSED); the player is registered (409 PLAYER_NOT_REGISTERED)
 * and still in (409 PLAYER_ELIMINATED), except for a re-buy when the tournament has a re-buy price
 * (buying back in); re-buys and add-ons are refused once the pool is locked (409 PRIZE_POOL_LOCKED)
 * or beyond maxRebuys; a knockout's target is another registered player (400 INVALID_TARGET) who is
 * still in, or out with no eliminator recorded (409 ALREADY_ELIMINATED, naming who got them, when
 * someone else did); the same request twice is 409 DUPLICATE_PENDING_ACTION.
 */
export const createPendingActionSchema = z
  .object({
    playerId: idSchema,
    actionType: z.enum(PLAYER_ACTION_TYPES),
    targetPlayerId: idSchema.nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.actionType === "knockout" && !input.targetPlayerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetPlayerId"], message: "Choose who was knocked out" });
    }
    if (input.actionType !== "knockout" && input.targetPlayerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetPlayerId"], message: "Only a knockout has a target" });
    }
    if (input.targetPlayerId && input.targetPlayerId === input.playerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetPlayerId"], message: "A player cannot knock themselves out" });
    }
  });
export type CreatePendingActionInput = z.infer<typeof createPendingActionSchema>;

/**
 * GET /api/tournaments/:id/pending-actions (staff), oldest first; also what the POST answers.
 * `clockElapsedMs` is the tournament clock's time when the player asked. `lateNote` is set on a re-buy
 * or add-on asked for once the re-buy period was over on the clock: "after the re-buy period, which
 * ended at 2:15 on the clock" (lateTopUpText). Confirming it is still allowed, so the desk shows the
 * note and asks first; its activity entry says the same (TDN4-REBUY-CLOSE-SILENT).
 */
export type PendingActionDto = Json<PendingAction> & {
  lateNote: string | null;
  player: PublicPlayer | null;
  targetPlayer: PublicPlayer | null;
};

/**
 * POST /api/pending-actions/:id/confirm body (optional). `reenter` answers 409
 * REBUY_BEFORE_ELIMINATION: a re-buy the player asked for while still in, who has been knocked out
 * since (or whose order cannot be told), is either their buy-back (true: they are back in) or the
 * re-buy they paid for before going out (false: it is recorded and they stay out). Without an answer
 * such a confirmation is refused, so the TD decides rather than the server quietly putting a busted
 * player back in (TN-RV2-01). A re-buy asked for after going out is always a buy-back.
 */
export const confirmPendingActionSchema = z.object({ reenter: z.boolean().optional() }).strict();
export type ConfirmPendingActionInput = z.infer<typeof confirmPendingActionSchema>;

/** `details` of 409 REBUY_BEFORE_ELIMINATION, so the actions page can ask the TD. */
export interface RebuyBeforeEliminationDetails {
  playerName: string;
  /** When the player asked (ISO), and when they were knocked out (ISO); either may be unknown on old rows. */
  requestedAt: string | null;
  eliminatedAt: string | null;
}

/**
 * POST /api/pending-actions/:id/confirm (staff): exactly once. One transaction deletes the action
 * (DELETE ... RETURNING; already handled → 404) and applies it: re-buy or add-on +1 (the /counts
 * rules, except that a request made before the prize pool was locked is applied after the lock), or
 * knockout = eliminate the target with eliminatedBy = the player (+1 knockout) at the time of the
 * claim, or credit the player for a target already out with no eliminator; a claim the TD already
 * recorded (target out, knocked out by the claimer) is just cleared. The claimer may have gone out
 * since asking. A refusal rolls back, so the action stays pending: staff dismiss it with
 * DELETE /api/pending-actions/:id (audited as `pending_action.dismiss`). Finalize clears every request
 * still waiting.
 */
export interface ConfirmPendingActionResponse {
  success: true;
  registration: ManagedRegistration;
  /** The re-buy put a player who was out back in. */
  reentered: boolean;
  /** The knocked-out player's registration, for a knockout. */
  target: ManagedRegistration | null;
}
