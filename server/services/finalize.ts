/**
 * Finalize v2 (spec D18-D20, §5.5): finishing positions, prizes and season points, written once.
 *
 * The plan is built by shared/domain/finalize, the same code the preview runs, so what the TD
 * previews is what is paid: each place's share floored to whole dollars, the leftover dollars and
 * cents to 1st, from the manual prize pool, else the gross less the manual AP total, else less the AP
 * the rates give. Finalize runs in one transaction that locks the tournament and its registrations,
 * refuses a cancelled or already finalized tournament (a second run needs `force` and the preview's
 * plan hash), and writes the results, the frozen snapshot, the activity entry and the audit row
 * together, or none of them. Player requests still waiting are cleared with them (none could be
 * applied to a completed tournament): the preview warns about each one and the plan hash covers them,
 * so nothing is discarded that the TD was not shown. A correction scores season points with the rules
 * the first finalize froze, not the points settings as they are now.
 */
import { createHash } from "node:crypto";
import type { Request } from "express";
import type {
  FinalizeInput,
  FinalizePreviewDto,
  FinalizePreviewInput,
  FinalizeRefusal,
  FinalizeResultDto,
} from "@shared/api/finalize";
import { buildFinalizePlan, planHashInput, type FinalizePlan, type PendingRequestInput } from "@shared/domain/finalize";
import { rakeLabel } from "@shared/domain/prize-pool";
import type { PointsAllocation, PointsSystem, Tournament } from "@shared/schema";
import { db, type Executor } from "../db";
import { actingUserId } from "../http/authz";
import { badRequest, conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { getClub } from "../repositories/clubs";
import { writeFinalResults } from "../repositories/finalize";
import { deletePendingActionsOfTournament, listPendingActionsWithPlayers } from "../repositories/pending-actions";
import { playerNames } from "../repositories/players";
import { pointsRules } from "../repositories/points";
import { registrationsOf } from "../repositories/registrations";
import { getTournament, lockTournamentForUpdate, setTournamentColumns } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { finishClock } from "./clock";
import { displayWithNames, toPrizePoolDto, type PrizePoolContext } from "./prize-pool";

interface PlanContext extends PrizePoolContext {
  pointsSystem: PointsSystem | null;
  allocations: PointsAllocation[];
  pendingRequests: PendingRequestInput[];
}

/**
 * Everything the plan reads. With `lock`, the registrations stay locked until the transaction ends
 * (the tournament row is already locked, so no request can be added or confirmed meanwhile).
 */
async function loadPlanContext(ex: Executor, tournament: Tournament, { lock }: { lock: boolean }): Promise<PlanContext> {
  const registrations = await registrationsOf(ex, tournament.id, { lock });
  const club = await getClub(ex, tournament.clubId);
  const names = await playerNames(ex, registrations.map((r) => r.playerId));
  const rules = tournament.trackPoints ? await pointsRules(ex, tournament.pointsSystemId) : { pointsSystem: null, allocations: [] };
  const pendingRequests = (await listPendingActionsWithPlayers(ex, tournament.id)).map(({ action, player, targetPlayer }) => ({
    id: action.id,
    actionType: action.actionType,
    playerName: player?.name ?? "Unknown player",
    targetPlayerName: targetPlayer?.name ?? null,
  }));
  return { tournament, registrations, club, playerNames: names, ...rules, pendingRequests };
}

function makePlan(context: PlanContext, finishOrder: readonly string[] | undefined, finalizedAt: Date): FinalizePlan {
  return buildFinalizePlan({
    tournament: context.tournament,
    registrations: context.registrations,
    pointsSystem: context.pointsSystem,
    allocations: context.allocations,
    playerNames: context.playerNames,
    finishOrder,
    finalizedAt: finalizedAt.toISOString(),
    rakeLabel: rakeLabel(context.club),
    pendingRequests: context.pendingRequests,
  });
}

type ReadyPlan = Extract<FinalizePlan, { ok: true }>;

/** sha256 of what the plan would pay, store and discard, first 32 hex characters. */
export function planHash(plan: ReadyPlan): string {
  return createHash("sha256").update(planHashInput(plan.prizePool.net, plan.rows, plan.pendingRequestIds)).digest("hex").slice(0, 32);
}

const REFUSALS: Readonly<Record<FinalizeRefusal, string>> = {
  ACTIVE_PLAYERS_NEED_ORDER: "More than one player is still in: give their finishing order",
  INVALID_FINISH_ORDER: "Give the finishing order of every player still in, or of every player, each once",
  ALREADY_FINALIZED: "This tournament has already been finalized",
  TOURNAMENT_CANCELLED: "A cancelled tournament cannot be finalized",
};

function refusalOf(tournament: Tournament, plan: FinalizePlan, force: boolean): FinalizeRefusal | undefined {
  if (tournament.status === "cancelled") return "TOURNAMENT_CANCELLED";
  if (tournament.status === "completed" && !force) return "ALREADY_FINALIZED";
  return plan.ok ? undefined : plan.problem;
}

/**
 * What a completed tournament paid last time, as every screen shows it (payoutsForDisplay: its
 * snapshot, or for one finalized before v2 its stored prizes).
 */
function previousResults(context: PlanContext): FinalizePreviewDto["previous"] {
  const { tournament } = context;
  if (tournament.status !== "completed") return null;
  const rows = displayWithNames(context).rows.map(({ position, playerName, amountCents }) => ({
    position,
    playerName: playerName ?? "Unknown player",
    amountCents,
  }));
  const results = context.registrations.map((r) => ({
    registrationId: r.id,
    finalPosition: r.finalPosition ?? null,
    pointsAwarded: r.pointsAwarded ?? null,
  }));
  return { finalizedAt: tournament.prizePoolSnapshot?.finalizedAt ?? tournament.finalizedAt?.toISOString() ?? null, rows, results };
}

/**
 * Everything a re-finalize overwrites, for its audit row: the previous snapshot in full and every
 * registration's previous position, prize and points (the snapshot does not hold the points, or the
 * finishers who won nothing). With it a disputed first payout can be rebuilt from the audit log.
 */
function overwrittenResults({ tournament, registrations }: PlanContext) {
  return {
    finalizedAt: tournament.finalizedAt?.toISOString() ?? null,
    snapshot: tournament.prizePoolSnapshot ?? null,
    results: registrations.map((r) => ({
      registrationId: r.id,
      playerId: r.playerId,
      finalPosition: r.finalPosition,
      prizeAmount: r.prizeAmount,
      pointsAwarded: r.pointsAwarded,
    })),
  };
}

function toPreviewDto(context: PlanContext, plan: FinalizePlan, force: boolean): FinalizePreviewDto {
  const code = refusalOf(context.tournament, plan, force);
  return {
    ok: code === undefined,
    ...(code ? { code, message: REFUSALS[code] } : {}),
    requiresForce: context.tournament.status === "completed",
    ...(plan.ok ? { planHash: planHash(plan) } : {}),
    prizePool: toPrizePoolDto(context),
    rows: plan.ok ? plan.rows : [],
    activePlayers: plan.activePlayers,
    warnings: plan.warnings,
    pendingRequests: context.pendingRequests.map((request) => ({ ...request, targetPlayerName: request.targetPlayerName ?? null })),
    previous: previousResults(context),
  };
}

/** POST /api/tournaments/:id/finalize/preview: the plan finalize would write now. No writes. */
export async function previewFinalize(id: string, input: FinalizePreviewInput): Promise<FinalizePreviewDto> {
  const tournament = await getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  const context = await loadPlanContext(db, tournament, { lock: false });
  return toPreviewDto(context, makePlan(context, input.finishOrder, new Date()), input.force === true);
}

const FINALIZED = "Tournament finalized - positions, prizes, and points assigned";
const REFINALIZED = "Tournament finalized again - positions, prizes, and points corrected";

/** POST /api/tournaments/:id/finalize */
export async function finalizeTournament(req: Request, id: string, input: FinalizeInput): Promise<FinalizeResultDto> {
  const force = input.force === true;
  if (force && !input.expectedPlanHash) {
    throw badRequest("Preview the results first: finalizing again needs the preview's plan", "PLAN_HASH_REQUIRED");
  }
  return await db.transaction(async (tx) => {
    const tournament = await lockTournamentForUpdate(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    if (tournament.status === "cancelled") throw conflict("TOURNAMENT_CANCELLED", REFUSALS.TOURNAMENT_CANCELLED);
    const again = tournament.status === "completed";
    if (again && !force) throw conflict("ALREADY_FINALIZED", REFUSALS.ALREADY_FINALIZED);

    const context = await loadPlanContext(tx, tournament, { lock: true });
    const now = new Date();
    const plan = makePlan(context, input.finishOrder, now);
    if (!plan.ok) throw conflict(plan.problem, REFUSALS[plan.problem], { activePlayers: plan.activePlayers });
    const hash = planHash(plan);
    if (input.expectedPlanHash && input.expectedPlanHash !== hash) {
      throw conflict("PLAN_CHANGED", "The results changed since the preview: check them and finalize again", {
        preview: toPreviewDto(context, plan, force),
      });
    }

    await writeFinalResults(tx, plan.rows);
    await setTournamentColumns(tx, id, {
      status: "completed",
      finalizedAt: now,
      finalizedBy: actingUserId(req),
      prizePoolSnapshot: plan.snapshot,
    });
    await finishClock(tx, id);
    await insertActivity(tx, {
      tournamentId: id,
      eventType: again ? "tournament_refinalized" : "status_change",
      description: again ? REFINALIZED : FINALIZED,
    });
    // A request still waiting can never be applied to a completed tournament (TN2-02); the preview listed each one.
    const requestsCleared = await deletePendingActionsOfTournament(tx, id);
    const pool = { netCents: plan.prizePool.net, netSource: plan.prizePool.netSource, planHash: hash, requestsCleared };
    await recordAudit(
      req,
      again
        ? { action: "tournament.refinalize", targetType: "tournament", targetId: id, data: { ...pool, previous: overwrittenResults(context) } }
        : { action: "tournament.finalize", targetType: "tournament", targetId: id, data: pool },
      tx,
    );
    return { success: true, message: "Tournament finalized successfully", snapshot: plan.snapshot };
  });
}
