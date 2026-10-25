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
 * the first finalize froze, not the points settings as they are now. A deal (round 5) pays the players
 * still in the amounts they agreed, sharing exactly what their places pay together (409 DEAL_INVALID
 * otherwise); it is frozen in the snapshot, logged publicly with its reason and audited. Finalize pays
 * exactly the prizes set (round 5, item 16): where a difference from the money available went (kept by
 * the club, added to the places, carried over, or added by the club) is frozen in the snapshot, logged
 * publicly and audited, and money carried over is recorded for the next tournament (carry-overs).
 * Only paid players are in the pool (round 6): while anyone in the field has not paid, finalize refuses
 * (409 UNPAID_PLAYERS) until the TD confirms each payment or leaves them out (excludeUnpaid), and a
 * player left out loses any place, prize or points an earlier finalize stored.
 */
import { createHash } from "node:crypto";
import type { Request } from "express";
import type { AuditData } from "@shared/api/admin";
import {
  toDealInput,
  type FinalizeInput,
  type FinalizePreviewDto,
  type FinalizePreviewInput,
  type FinalizeRefusal,
  type FinalizeResultDto,
} from "@shared/api/finalize";
import { describeDeal, type SnapshotDeal } from "@shared/domain/deal";
import { buildFinalizePlan, planHashInput, type FinalizePlan, type PendingRequestInput, type SnapshotDifference } from "@shared/domain/finalize";
import { carryTargetName, differenceSentence } from "@shared/domain/prize-difference";
import { rakeLabel } from "@shared/domain/prize-pool";
import type { PointsAllocation, PointsSystem, Tournament } from "@shared/schema";
import { db, type Executor } from "../db";
import { actingUserId } from "../http/authz";
import { badRequest, conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { getClub } from "../repositories/clubs";
import { carryOverOfSource } from "../repositories/carry-overs";
import { writeFinalResults } from "../repositories/finalize";
import { deletePendingActionsOfTournament, listPendingActionsWithPlayers } from "../repositories/pending-actions";
import { playerNames } from "../repositories/players";
import { pointsRules } from "../repositories/points";
import { registrationsOf, updateTournamentRegistration } from "../repositories/registrations";
import { getTournament, lockTournamentForUpdate, setTournamentColumns } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { carryOverChangeProblem, recordCarryOver } from "./carry-overs";
import { finishClock } from "./clock";
import { carryTargetOf, displayWithNames, toPrizePoolDto, type PrizePoolContext } from "./prize-pool";

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
  return { tournament, registrations, club, playerNames: names, carryTarget: await carryTargetOf(ex, tournament), ...rules, pendingRequests };
}

/** What the TD chose in the preview or finalize request: the finishing order, a deal, and whether unpaid players are left out. */
type PlanChoices = Pick<FinalizeInput, "finishOrder" | "deal" | "excludeUnpaid">;

/** The plan for the choices, paying the players still in the deal's amounts when one is sent. */
function makePlan(context: PlanContext, { finishOrder, deal, excludeUnpaid }: PlanChoices, finalizedAt: Date): FinalizePlan {
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
    deal: deal ? toDealInput(deal) : undefined,
    carryTarget: context.carryTarget,
    excludeUnpaid: excludeUnpaid === true,
  });
}

type ReadyPlan = Extract<FinalizePlan, { ok: true }>;

/** sha256 of what the plan would pay, store, carry over and discard, first 32 hex characters. */
export function planHash(plan: ReadyPlan): string {
  const input = planHashInput(plan.prizePool.net, plan.rows, plan.pendingRequestIds, plan.prizePool.difference);
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

const REFUSALS: Readonly<Record<FinalizeRefusal, string>> = {
  ACTIVE_PLAYERS_NEED_ORDER: "More than one player is still in: give their finishing order",
  INVALID_FINISH_ORDER: "Give the finishing order of every player still in, or of every player, each once",
  ALREADY_FINALIZED: "This tournament has already been finalized",
  TOURNAMENT_CANCELLED: "A cancelled tournament cannot be finalized",
  DEAL_INVALID: "The deal must share exactly what the players still in would be paid",
  UNPAID_PLAYERS: "Some players have not paid, so they are not in the prize pool: confirm their payments, or leave them out",
};

function refusalOf(tournament: Tournament, plan: FinalizePlan, force: boolean): FinalizeRefusal | undefined {
  if (tournament.status === "cancelled") return "TOURNAMENT_CANCELLED";
  if (tournament.status === "completed" && !force) return "ALREADY_FINALIZED";
  return plan.ok ? undefined : plan.problem;
}

/** The refusal's sentence; for unpaid players it names them: "Dee and Eve have not paid, so …". */
function refusalMessage(code: FinalizeRefusal, plan: FinalizePlan): string {
  if (code !== "UNPAID_PLAYERS" || plan.unpaid.length === 0) return REFUSALS[code];
  const names = plan.unpaid.map((player) => player.playerName);
  const who =
    names.length === 1 ? `${names[0]} has` : names.length <= 3 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)} have` : `${names.length} players have`;
  const one = names.length === 1;
  return `${who} not paid, so ${one ? "is" : "are"} not in the prize pool: confirm ${one ? "the payment" : "their payments"}, or leave them out`;
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

/**
 * `toPreviewDto`'s warnings beyond the plan's: a correction that would change money this tournament
 * carried over that another tournament has already added to its pool (finalize refuses it).
 */
async function carryOverWarnings(ex: Executor, context: PlanContext, plan: FinalizePlan): Promise<string[]> {
  if (context.tournament.status !== "completed") return [];
  const problem = await carryOverChangeProblem(ex, await carryOverOfSource(ex, context.tournament.id), plan.prizePool.difference.carriedOverCents);
  return problem ? [problem] : [];
}

function toPreviewDto(context: PlanContext, plan: FinalizePlan, force: boolean, extraWarnings: readonly string[] = []): FinalizePreviewDto {
  const code = refusalOf(context.tournament, plan, force);
  return {
    ok: code === undefined,
    ...(code ? { code, message: refusalMessage(code, plan) } : {}),
    requiresForce: context.tournament.status === "completed",
    ...(plan.ok ? { planHash: planHash(plan) } : {}),
    // The pool the plan pays: paid players only, also when correcting a tournament completed before that rule.
    prizePool: { ...toPrizePoolDto(context), breakdown: plan.prizePool },
    rows: plan.ok ? plan.rows : [],
    activePlayers: plan.activePlayers,
    dealable: plan.dealable,
    dealProblems: plan.ok ? [] : (plan.dealProblems ?? []),
    unpaid: plan.unpaid,
    warnings: [...plan.warnings, ...extraWarnings],
    pendingRequests: context.pendingRequests.map((request) => ({ ...request, targetPlayerName: request.targetPlayerName ?? null })),
    previous: previousResults(context),
  };
}

/** POST /api/tournaments/:id/finalize/preview: the plan finalize would write now. No writes. */
export async function previewFinalize(id: string, input: FinalizePreviewInput): Promise<FinalizePreviewDto> {
  const tournament = await getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  const context = await loadPlanContext(db, tournament, { lock: false });
  const plan = makePlan(context, input, new Date());
  return toPreviewDto(context, plan, input.force === true, await carryOverWarnings(db, context, plan));
}

const FINALIZED = "Tournament finalized - positions, prizes, and points assigned";
const REFINALIZED = "Tournament finalized again - positions, prizes, and points corrected";

/** The public feed's line for a deal: "Deal: Alice $450, Bob $350 (Chip chop at 2 handed)". */
const dealDescription = (deal: SnapshotDeal) => `Deal: ${describeDeal(deal)} (${deal.reason})`;

/**
 * The public feed's line for where a difference went: "The prizes add up to $950, $50 less than the
 * $1,000 available for prizes: it is carried over to Winter League".
 */
const differenceDescription = (difference: SnapshotDifference) =>
  (differenceSentence(difference, difference.carryTarget ?? carryTargetName(null)) ?? "").replace(/\.$/, "");

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
    const plan = makePlan(context, input, now);
    if (!plan.ok && plan.problem === "DEAL_INVALID") {
      const dealProblems = plan.dealProblems ?? [];
      throw conflict("DEAL_INVALID", dealProblems[0]?.message ?? REFUSALS.DEAL_INVALID, { dealProblems, dealable: plan.dealable });
    }
    if (!plan.ok && plan.problem === "UNPAID_PLAYERS") {
      throw conflict("UNPAID_PLAYERS", refusalMessage("UNPAID_PLAYERS", plan), { unpaid: plan.unpaid, activePlayers: plan.activePlayers });
    }
    if (!plan.ok) throw conflict(plan.problem, REFUSALS[plan.problem], { activePlayers: plan.activePlayers });
    const hash = planHash(plan);
    if (input.expectedPlanHash && input.expectedPlanHash !== hash) {
      throw conflict("PLAN_CHANGED", "The results changed since the preview: check them and finalize again", {
        preview: toPreviewDto(context, plan, force),
      });
    }

    const { difference } = plan.snapshot.pool;
    await recordCarryOver(tx, req, tournament, difference);
    await writeFinalResults(tx, plan.rows);
    // A player left out (unpaid, or now on the waiting list) keeps no place, prize or points from an earlier finalize.
    for (const registrationId of plan.clearedRegistrationIds) {
      await updateTournamentRegistration(tx, registrationId, { finalPosition: null, prizeAmount: null, pointsAwarded: null });
    }
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
    const { deal } = plan.snapshot;
    if (deal) {
      await insertActivity(tx, { tournamentId: id, eventType: "deal", description: dealDescription(deal), eventData: JSON.stringify(deal) });
    }
    if (difference) {
      await insertActivity(tx, {
        tournamentId: id,
        eventType: "prize_pool_adjusted",
        description: differenceDescription(difference),
        eventData: JSON.stringify({ mode: "finalized", difference }),
      });
    }
    // A request still waiting can never be applied to a completed tournament (TN2-02); the preview listed each one.
    const requestsCleared = await deletePendingActionsOfTournament(tx, id);
    const unpaidLeftOut = input.excludeUnpaid ? plan.unpaid.map((player) => player.registrationId) : [];
    const pool: AuditData["tournament.finalize"] = {
      netCents: plan.prizePool.net,
      netSource: plan.prizePool.netSource,
      planHash: hash,
      requestsCleared,
      ...(deal ? { deal } : {}),
      ...(difference ? { difference } : {}),
      ...(unpaidLeftOut.length > 0 ? { unpaidLeftOut } : {}),
      ...(plan.clearedRegistrationIds.length > 0 ? { resultsCleared: plan.clearedRegistrationIds } : {}),
    };
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
