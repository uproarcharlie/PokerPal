/**
 * Pending actions: a player asks from their phone for a re-buy, an add-on or to record a knockout, and
 * staff confirm (apply) or dismiss it. The request, the confirmation and the dismissal all lock the
 * tournament row first, like every other registration change, so the rules are checked against what
 * is really stored.
 */
import type { Request } from "express";
import type {
  ConfirmPendingActionInput,
  CreatePendingActionInput,
  RebuyBeforeEliminationDetails,
} from "@shared/api/pending-actions";
import { lateTopUpText, notOfferedRefusal, requestRefusal } from "@shared/domain/player-actions";
import type { PendingAction, Tournament, TournamentRegistration } from "@shared/schema";
import { db, type Transaction } from "../db";
import { badRequest, conflict, notFound } from "../http/errors";
import { clockElapsedMsNow } from "../repositories/clock";
import { getPlayer } from "../repositories/players";
import * as pendingActionsRepo from "../repositories/pending-actions";
import { lockPlayerRegistration, lockTournamentForRegistrationWrite } from "../repositories/registrations";
import { getTournament } from "../repositories/tournaments";
import { toPublicPlayer } from "./players";
import { recordAudit } from "./audit";
import { applyCountChange, creditKnockout, eliminate, toManagedRegistration } from "./registrations";
import { assertOpen } from "./tournament-views";

const notRegistered = () => conflict("PLAYER_NOT_REGISTERED", "That player is not registered for this tournament");

const nameOf = async (tx: Transaction, playerId: string | null) =>
  (playerId ? (await getPlayer(tx, playerId))?.name : undefined) ?? "That player";

/**
 * The registration a knockout claim names, locked: another registered player who is still in, or who
 * is out with nobody recorded as their eliminator (the TD marked them out first; confirming credits
 * the claimer). Someone already knocked out by another player is refused, naming who.
 */
async function lockClaimableTarget(
  tx: Transaction,
  tournament: Tournament,
  targetPlayerId: string | null,
): Promise<TournamentRegistration> {
  const target = targetPlayerId ? await lockPlayerRegistration(tx, tournament.id, targetPlayerId) : undefined;
  if (!target) {
    throw badRequest("The knocked-out player must be another player registered for this tournament", "INVALID_TARGET");
  }
  if (target.isEliminated && target.eliminatedBy) {
    throw conflict(
      "ALREADY_ELIMINATED",
      `${await nameOf(tx, targetPlayerId)} is already out, knocked out by ${await nameOf(tx, target.eliminatedBy)}`,
    );
  }
  return target;
}

/**
 * Said of a re-buy or add-on asked for once the re-buy period was over on the clock (lateTopUpText,
 * from the clock's time when the player asked); null otherwise, and always for a knockout.
 */
const lateNoteOf = (tournament: Pick<Tournament, "rebuyPeriodMinutes"> | undefined, action: PendingAction): string | null =>
  action.actionType === "knockout" ? null : lateTopUpText(tournament?.rebuyPeriodMinutes, action.clockElapsedMs);

/** GET /api/tournaments/:id/pending-actions (staff): oldest first, players as PublicPlayer, late requests noted. */
export async function listPendingActions(tournamentId: string) {
  const [tournament, rows] = await Promise.all([
    getTournament(db, tournamentId),
    pendingActionsRepo.listPendingActionsWithPlayers(db, tournamentId),
  ]);
  return rows.map(({ action, player, targetPlayer }) => ({
    ...action,
    lateNote: lateNoteOf(tournament, action),
    player: player ? toPublicPlayer(player) : null,
    targetPlayer: targetPlayer ? toPublicPlayer(targetPlayer) : null,
  }));
}

/**
 * POST /api/tournaments/:id/pending-actions (public). Refused unless the tournament is open, the player
 * is registered, the request could be confirmed now (requestRefusal in shared/domain/player-actions:
 * the player still in, or out and buying back in; for a re-buy or add-on the pool not locked and the
 * re-buy limit not reached), a knockout's target can be claimed (lockClaimableTarget), and the same
 * request is not already waiting. The clock's time is recorded with it, so confirming it later knows
 * whether it was asked for within the re-buy period (P4REV1-R2-01). One asked for after the period is
 * still taken (the TD decides), with its lateNote.
 */
export async function createPendingAction(tournamentId: string, input: CreatePendingActionInput) {
  return db.transaction(async (tx) => {
    const tournament = await lockTournamentForRegistrationWrite(tx, tournamentId);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament);

    const registration = await lockPlayerRegistration(tx, tournament.id, input.playerId);
    if (!registration) throw notRegistered();
    const refusal = requestRefusal(tournament, registration, input.actionType);
    if (refusal) throw conflict(refusal.code, refusal.message);

    const targetPlayerId = input.actionType === "knockout" ? (input.targetPlayerId ?? null) : null;
    if (input.actionType === "knockout") await lockClaimableTarget(tx, tournament, targetPlayerId);

    const request = { tournamentId: tournament.id, playerId: input.playerId, actionType: input.actionType, targetPlayerId };
    if (await pendingActionsRepo.findSamePendingAction(tx, request)) {
      throw conflict("DUPLICATE_PENDING_ACTION", "That request is already waiting for the tournament director");
    }
    const action = await pendingActionsRepo.createPendingAction(tx, { ...request, clockElapsedMs: await clockElapsedMsNow(tx, tournament.id) });
    return { ...action, lateNote: lateNoteOf(tournament, action), player: null, targetPlayer: null };
  });
}

/**
 * Whether confirming a re-buy puts the player back in. A player still in is not affected. A re-buy
 * asked for after the player went out is their buy-back. One asked for while they were still in, by
 * a player knocked out since, may be either (the chips came before the bust, or the TD meant it as
 * the buy-back), so the TD must say (`reenter`), or it is refused with 409 REBUY_BEFORE_ELIMINATION;
 * the same when either time is unknown (TN-RV2-01).
 */
function reentryFor(
  registration: TournamentRegistration,
  requestedAt: Date | null,
  reenter: boolean | undefined,
  playerName: string,
): boolean {
  if (!registration.isEliminated) return true;
  const eliminatedAt = registration.eliminationTime;
  const askedWhileOut = requestedAt !== null && eliminatedAt !== null && requestedAt.getTime() >= eliminatedAt.getTime();
  if (askedWhileOut) return reenter ?? true;
  if (reenter !== undefined) return reenter;
  const details: RebuyBeforeEliminationDetails = {
    playerName,
    requestedAt: requestedAt?.toISOString() ?? null,
    eliminatedAt: eliminatedAt?.toISOString() ?? null,
  };
  throw conflict(
    "REBUY_BEFORE_ELIMINATION",
    `${playerName} asked for this re-buy before being knocked out. Confirm it as a buy-back to put ${playerName} back in, ` +
      "or just record the re-buy they paid for",
    details,
  );
}

/**
 * POST /api/pending-actions/:id/confirm (staff): applies the request exactly once. The action is
 * deleted in the same transaction as the change it makes (already gone → 404), and any refusal rolls
 * both back, so a refused request stays pending for staff to dismiss.
 *
 * A re-buy or add-on asked for before the pool was locked is applied even after the lock: the player
 * paid in time (TN2-01). A re-buy confirmed for a player who is out puts them back in only as
 * `reentryFor` decides. A knockout counts even if the claimer has gone out since asking (they asked
 * while still in), keeps the claim's own time as the elimination time, so a claim confirmed late
 * still ranks the player as busting when they did (MONEY-P2REV-03), and a target the TD has already
 * marked out with no eliminator is credited to the claimer. A claim the TD has already recorded
 * exactly (the target out, knocked out by the claimer) is simply cleared: there is nothing left to do.
 */
export async function confirmPendingAction(actionId: string, input: ConfirmPendingActionInput = {}) {
  return db.transaction(async (tx) => {
    const pending = await pendingActionsRepo.getPendingAction(tx, actionId);
    const tournament = pending && (await lockTournamentForRegistrationWrite(tx, pending.tournamentId));
    const action = tournament && (await pendingActionsRepo.takePendingAction(tx, actionId));
    if (!tournament || !action) throw notFound("Pending action not found");

    const registration = await lockPlayerRegistration(tx, tournament.id, action.playerId);
    if (!registration) throw notRegistered();
    const player = await getPlayer(tx, action.playerId);

    switch (action.actionType) {
      case "rebuy":
      case "addon": {
        // A request queued before the rule (or before the price was taken off) never records a $0 entry.
        const notOffered = notOfferedRefusal(tournament, action.actionType);
        if (notOffered) throw conflict(notOffered.code, `${notOffered.message}: dismiss the request instead`);
        const rebuy = action.actionType === "rebuy";
        const reenter = rebuy && reentryFor(registration, action.timestamp, input.reenter, player?.name ?? "That player");
        const updated = await applyCountChange(tx, { tournament, registration }, rebuy ? { rebuys: 1 } : { addons: 1 }, {
          request: action,
          reenter,
        });
        return {
          success: true as const,
          registration: toManagedRegistration(updated, player),
          reentered: registration.isEliminated === true && updated.isEliminated === false,
          target: null,
        };
      }
      case "knockout": {
        const recorded = action.targetPlayerId ? await lockPlayerRegistration(tx, tournament.id, action.targetPlayerId) : undefined;
        if (recorded?.isEliminated && recorded.eliminatedBy === action.playerId) {
          assertOpen(tournament);
          return {
            success: true as const,
            registration: toManagedRegistration(registration, player),
            reentered: false,
            target: toManagedRegistration(recorded, await getPlayer(tx, recorded.playerId)),
          };
        }
        const locked = { tournament, registration: await lockClaimableTarget(tx, tournament, action.targetPlayerId) };
        const { eliminated, eliminator } = locked.registration.isEliminated
          ? await creditKnockout(tx, locked, action.playerId)
          : await eliminate(tx, locked, action.playerId, { claimed: true, at: action.timestamp });
        return {
          success: true as const,
          registration: toManagedRegistration(eliminator ?? registration, player),
          reentered: false,
          target: toManagedRegistration(eliminated, await getPlayer(tx, eliminated.playerId)),
        };
      }
      default:
        throw badRequest(`Unknown action type "${action.actionType}": dismiss it instead`);
    }
  });
}

/**
 * DELETE /api/pending-actions/:id (staff): dismisses the request without applying it. Like every
 * pending-action write it takes the tournament lock first, and it is audited
 * (`pending_action.dismiss`, with what was asked and when), so a request a player says they paid
 * for never disappears without a trace (P2REV4-CQ2-09).
 */
export async function dismissPendingAction(req: Request, actionId: string): Promise<PendingAction> {
  return db.transaction(async (tx) => {
    const pending = await pendingActionsRepo.getPendingAction(tx, actionId);
    const tournament = pending && (await lockTournamentForRegistrationWrite(tx, pending.tournamentId));
    const action = tournament && (await pendingActionsRepo.takePendingAction(tx, actionId));
    if (!action) throw notFound("Pending action not found");
    await recordAudit(
      req,
      {
        action: "pending_action.dismiss",
        targetType: "tournament",
        targetId: action.tournamentId,
        data: {
          actionId: action.id,
          actionType: action.actionType,
          playerId: action.playerId,
          targetPlayerId: action.targetPlayerId,
          requestedAt: action.timestamp?.toISOString() ?? null,
        },
      },
      tx,
    );
    return action;
  });
}
