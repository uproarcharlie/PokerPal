import { and, asc, eq, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { pendingActions, players, type InsertPendingAction, type PendingAction, type Player } from "@shared/schema";
import type { Executor } from "../db";

export async function getPendingAction(ex: Executor, id: string): Promise<PendingAction | undefined> {
  const [action] = await ex.select().from(pendingActions).where(eq(pendingActions.id, id));
  return action;
}

/**
 * Stamps the request's time here, as the other drizzle-written times are (UTC), rather than leaving it
 * to the column's now() default, which follows the database session's time zone: the time is compared
 * with prizePoolLockedAt and becomes a claimed knockout's elimination time.
 */
export async function createPendingAction(ex: Executor, insertAction: InsertPendingAction): Promise<PendingAction> {
  const [action] = await ex
    .insert(pendingActions)
    .values({ ...insertAction, timestamp: new Date() })
    .returning();
  return action;
}

/** Deletes every request a player made or is named in for a tournament (their entry is being removed); how many. */
export async function deletePendingActionsForPlayer(ex: Executor, tournamentId: string, playerId: string): Promise<number> {
  const removed = await ex
    .delete(pendingActions)
    .where(
      and(
        eq(pendingActions.tournamentId, tournamentId),
        or(eq(pendingActions.playerId, playerId), eq(pendingActions.targetPlayerId, playerId)),
      ),
    )
    .returning({ id: pendingActions.id });
  return removed.length;
}

/** Deletes every request still waiting for a tournament (it has been finalized, so none can be applied); how many. */
export async function deletePendingActionsOfTournament(ex: Executor, tournamentId: string): Promise<number> {
  const removed = await ex.delete(pendingActions).where(eq(pendingActions.tournamentId, tournamentId)).returning({ id: pendingActions.id });
  return removed.length;
}

/** Deletes the action and returns it; undefined when it was already gone (so it is handled once). */
export async function takePendingAction(ex: Executor, id: string): Promise<PendingAction | undefined> {
  const [action] = await ex.delete(pendingActions).where(eq(pendingActions.id, id)).returning();
  return action;
}

/** An identical request still waiting: same tournament, player, type and target. */
export async function findSamePendingAction(
  ex: Executor,
  action: Pick<InsertPendingAction, "tournamentId" | "playerId" | "actionType" | "targetPlayerId">,
): Promise<PendingAction | undefined> {
  const [existing] = await ex
    .select()
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.tournamentId, action.tournamentId),
        eq(pendingActions.playerId, action.playerId),
        eq(pendingActions.actionType, action.actionType),
        action.targetPlayerId ? eq(pendingActions.targetPlayerId, action.targetPlayerId) : isNull(pendingActions.targetPlayerId),
      ),
    )
    .limit(1);
  return existing;
}

export interface PendingActionWithPlayers {
  action: PendingAction;
  player: Player | null;
  targetPlayer: Player | null;
}

const targetPlayers = alias(players, "target_players");

/** A tournament's pending actions with both players, oldest first, in one query (perf-23). */
export async function listPendingActionsWithPlayers(ex: Executor, tournamentId: string): Promise<PendingActionWithPlayers[]> {
  return await ex
    .select({ action: pendingActions, player: players, targetPlayer: targetPlayers })
    .from(pendingActions)
    .leftJoin(players, eq(players.id, pendingActions.playerId))
    .leftJoin(targetPlayers, eq(targetPlayers.id, pendingActions.targetPlayerId))
    .where(eq(pendingActions.tournamentId, tournamentId))
    .orderBy(asc(pendingActions.timestamp), asc(pendingActions.id));
}
