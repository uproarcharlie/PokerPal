/**
 * The finalize plan: who finished where, what each is paid and the points they get, plus the snapshot
 * finalize freezes on the tournament. PURE: no I/O, no clock (the caller passes the time), and no
 * runtime imports outside shared/domain. The server hashes `planHashInput(plan)` and writes the rows
 * in one transaction; the preview shows exactly the same plan, so what the TD sees is what is paid.
 *
 * Money is the v2 rule (`allocatePayouts`): each place's share floored to whole dollars, the leftover
 * dollars and cents to 1st, so the places add up to the pool exactly. Places beyond the number of
 * entrants are not paid (as before; the warnings say how much). Unpaid registrations still count.
 */
import { centsToDecimalString, formatMoney, toCents, type Cents, type MoneyInput } from "./money";
import { PAYOUT_ALGORITHM, undistributedCents, type PayoutAlgorithm, type PayoutStructureKey } from "./payouts";
import { isPlayerActionType, PLAYER_ACTION_LABELS } from "./player-actions";
import { pointsForFinish, type AllocationInput, type PointsRules, type PointsSystemInput } from "./points";
import {
  computePrizePool,
  type EntryInput,
  type NetSource,
  type PrizePoolBreakdown,
  type PrizePoolInput,
} from "./prize-pool";
import { rankFinishers, type FinisherInput, type FinishOrderProblem, type FinishOrderSource } from "./standings";

export const FINALIZE_SNAPSHOT_VERSION = 1 as const;

/**
 * The season-points rules a finalize scored with, frozen with the payouts: a later correction
 * (Correct Results) scores with these, whatever has happened to the tournament's points system since
 * (deleted, its allocations added to, the tournament's settings changed), so fixing two places never
 * quietly changes everyone else's points (P2REV1-01).
 */
export interface SnapshotPointsRules {
  trackPoints: boolean;
  pointsSystem: { participationPoints: number | null; knockoutPoints: number | null } | null;
  allocations: Array<{ position: number; positionEnd: number | null; points: number }>;
}

/**
 * tournaments.prize_pool_snapshot: what finalize paid, frozen. Completed tournaments are displayed
 * from it and never recomputed. Amounts are integer cents. No user ids: finalized_by is a column.
 */
export interface PrizePoolSnapshot {
  v: typeof FINALIZE_SNAPSHOT_VERSION;
  algorithm: PayoutAlgorithm;
  finalizedAt: string;
  entrants: number;
  finishOrderSource: FinishOrderSource;
  pool: {
    grossCents: Cents;
    rakeCalculatedCents: Cents;
    rakeOverrideCents: Cents | null;
    manualPrizePoolCents: Cents | null;
    netCents: Cents;
    netSource: NetSource;
    impliedRakeCents: Cents;
    structure: { requested: string; used: PayoutStructureKey; basisPoints: number[]; error?: string };
  };
  /** The points rules scored with (absent from snapshots written before they were frozen). */
  points?: SnapshotPointsRules;
  /** Positions 1..min(places, entrants), including any zero amounts. */
  paid: Array<{
    position: number;
    registrationId: string;
    playerId: string;
    playerName: string;
    basisPoints: number;
    amountCents: Cents;
  }>;
  warnings: string[];
}

/** The tournament fields the plan reads. A `Tournament` row fits as it is. */
export interface FinalizeTournamentInput extends PrizePoolInput {
  status?: string | null;
  trackPoints?: boolean | null;
  prizePoolLocked?: boolean | null;
  prizePoolSnapshot?: PrizePoolSnapshot | null;
  rebuyAmount?: MoneyInput;
  addonAmount?: MoneyInput;
}

/** A registration as the plan reads it. A `TournamentRegistration` row fits as it is. */
export interface FinalizeRegistrationInput extends EntryInput, FinisherInput {
  id: string;
  playerId: string;
  knockouts?: number | null;
  paymentConfirmed?: boolean | null;
  /** The position a previous finalize stored, used to suggest the finish order again. */
  finalPosition?: number | null;
  /** The points a previous finalize stored, compared with the new ones on a correction. */
  pointsAwarded?: number | null;
}

/** A player request still waiting for the TD (a pending action): finalize discards it. */
export interface PendingRequestInput {
  id: string;
  actionType: string;
  playerName: string;
  /** The knocked-out player, for a knockout claim. */
  targetPlayerName?: string | null;
}

export interface FinalizePlanInput {
  tournament: FinalizeTournamentInput;
  registrations: readonly FinalizeRegistrationInput[];
  /** The tournament's points system, or null when it has none. */
  pointsSystem: PointsSystemInput | null;
  /** The system's allocations, by position then id. */
  allocations: readonly AllocationInput[];
  playerNames: ReadonlyMap<string, string>;
  /** Players still in, best first (see rankFinishers). */
  finishOrder?: readonly string[];
  /** When the plan is frozen, as an ISO string. */
  finalizedAt: string;
  /** The club's name for rake (rakeLabel(club)), used in the warnings. */
  rakeLabel: string;
  /** Player requests still waiting: finalize deletes them, so the TD is warned and the plan hash covers them. */
  pendingRequests?: readonly PendingRequestInput[];
}

/** One registration as finalize writes it. */
export interface FinalizeRow {
  registrationId: string;
  playerId: string;
  playerName: string;
  finalPosition: number;
  amountCents: Cents;
  /** The decimal(10,2) text finalize stores, or null for no prize. */
  prizeAmount: string | null;
  pointsAwarded: number | null;
}

export interface ActivePlayer {
  registrationId: string;
  playerId: string;
  playerName: string;
}

interface PlanCommon {
  prizePool: PrizePoolBreakdown;
  /** Players still in, in the order to suggest: as given, else as last finalized, else by id. */
  activePlayers: ActivePlayer[];
  warnings: string[];
  /** The ids of the requests finalize would discard, sorted (part of the plan hash). */
  pendingRequestIds: string[];
}

export type FinalizePlan =
  | (PlanCommon & { ok: true; rows: FinalizeRow[]; snapshot: PrizePoolSnapshot })
  | (PlanCommon & { ok: false; problem: FinishOrderProblem });

const UNKNOWN_PLAYER = "Unknown player";

/**
 * The points rules a plan scores with: for a completed tournament (a correction), the ones its
 * finalize froze in the snapshot; otherwise, or for a snapshot from before they were frozen, the
 * tournament's points settings as they are now.
 */
export function pointsRulesFor(input: Pick<FinalizePlanInput, "tournament" | "pointsSystem" | "allocations">): SnapshotPointsRules {
  const frozen = input.tournament.status === "completed" ? input.tournament.prizePoolSnapshot?.points : undefined;
  if (frozen) return frozen;
  return {
    trackPoints: input.tournament.trackPoints === true,
    pointsSystem: input.pointsSystem
      ? { participationPoints: input.pointsSystem.participationPoints ?? null, knockoutPoints: input.pointsSystem.knockoutPoints ?? null }
      : null,
    allocations: input.allocations.map(({ position, positionEnd, points }) => ({ position, positionEnd: positionEnd ?? null, points })),
  };
}

export function buildFinalizePlan(input: FinalizePlanInput): FinalizePlan {
  const { tournament, registrations } = input;
  const prizePool = computePrizePool(tournament, registrations);
  const nameOf = (playerId: string) => input.playerNames.get(playerId) ?? UNKNOWN_PLAYER;
  const warnings = planWarnings(input, prizePool);
  const activePlayers = suggestedActivePlayers(registrations, input.finishOrder, nameOf);
  const pendingRequestIds = (input.pendingRequests ?? []).map((request) => request.id).sort();

  const ranked = rankFinishers(registrations, input.finishOrder);
  if (!ranked.ok) return { ok: false, problem: ranked.problem, prizePool, activePlayers, warnings, pendingRequestIds };

  const points = pointsRulesFor(input);
  const rules: PointsRules = points;
  const rows = ranked.ordered.map((registration, index): FinalizeRow => {
    const finalPosition = index + 1;
    const amountCents = prizePool.payouts[index]?.amountCents ?? 0;
    return {
      registrationId: registration.id,
      playerId: registration.playerId,
      playerName: nameOf(registration.playerId),
      finalPosition,
      amountCents,
      prizeAmount: amountCents > 0 ? centsToDecimalString(amountCents) : null,
      pointsAwarded: pointsForFinish(rules, finalPosition, registration.knockouts),
    };
  });

  const { structure } = prizePool;
  const snapshot: PrizePoolSnapshot = {
    v: FINALIZE_SNAPSHOT_VERSION,
    algorithm: PAYOUT_ALGORITHM,
    finalizedAt: input.finalizedAt,
    entrants: registrations.length,
    finishOrderSource: ranked.source,
    pool: {
      grossCents: prizePool.gross.total,
      rakeCalculatedCents: prizePool.rake.calculated,
      rakeOverrideCents: prizePool.rake.override,
      manualPrizePoolCents: prizePool.manualPrizePool,
      netCents: prizePool.net,
      netSource: prizePool.netSource,
      impliedRakeCents: prizePool.impliedRake,
      structure: {
        requested: structure.requested,
        used: structure.used,
        basisPoints: [...structure.basisPoints],
        ...(structure.error ? { error: structure.error } : {}),
      },
    },
    points,
    paid: rows.slice(0, structure.basisPoints.length).map((row, index) => ({
      position: row.finalPosition,
      registrationId: row.registrationId,
      playerId: row.playerId,
      playerName: row.playerName,
      basisPoints: structure.basisPoints[index],
      amountCents: row.amountCents,
    })),
    warnings: [...warnings, ...pointsChangeWarnings(registrations, rows, tournament.status === "completed", nameOf)],
  };

  return { ok: true, prizePool, activePlayers, warnings: snapshot.warnings, rows, snapshot, pendingRequestIds };
}

/**
 * The text the plan hash is taken over: the pool, every row finalize writes and the player requests it
 * would discard. Any change to what would be paid, stored or thrown away (a request arriving after the
 * preview) changes it, so finalize can refuse a plan that moved since the preview.
 */
export function planHashInput(netCents: Cents, rows: readonly FinalizeRow[], pendingRequestIds: readonly string[] = []): string {
  return JSON.stringify([
    netCents,
    rows.map((r) => [r.registrationId, r.finalPosition, r.prizeAmount, r.pointsAwarded]),
    [...pendingRequestIds].sort(),
  ]);
}

/** On a correction: the players whose place stays the same but whose points would change. */
function pointsChangeWarnings(
  registrations: readonly FinalizeRegistrationInput[],
  rows: readonly FinalizeRow[],
  correcting: boolean,
  nameOf: (playerId: string) => string,
): string[] {
  if (!correcting) return [];
  const before = new Map(registrations.map((r) => [r.id, r]));
  const shown = (points: number | null | undefined) => (points == null ? "none" : String(points));
  const changed = rows.filter((row) => {
    const stored = before.get(row.registrationId);
    return stored?.finalPosition === row.finalPosition && (stored.pointsAwarded ?? null) !== row.pointsAwarded;
  });
  if (changed.length === 0) return [];
  const listed = changed
    .slice(0, 3)
    .map((row) => `${nameOf(row.playerId)} ${shown(before.get(row.registrationId)?.pointsAwarded)} → ${shown(row.pointsAwarded)}`);
  const more = changed.length > 3 ? ` and ${changed.length - 3} more` : "";
  return [`Season points change for ${plural(changed.length, "player")} whose place stays the same: ${listed.join(", ")}${more}`];
}

/** "Bob's re-buy ($25)", "Alice's knockout of Carl". */
function describeRequest(tournament: FinalizeTournamentInput, request: PendingRequestInput): string {
  const type = request.actionType;
  if (!isPlayerActionType(type)) return `${request.playerName}'s "${type}" request`;
  if (type === "knockout") return `${request.playerName}'s knockout of ${request.targetPlayerName ?? "another player"}`;
  const price = toCents(type === "rebuy" ? tournament.rebuyAmount : tournament.addonAmount);
  return `${request.playerName}'s ${PLAYER_ACTION_LABELS[type]}${price > 0 ? ` (${formatMoney(price)})` : ""}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function planWarnings(input: FinalizePlanInput, pool: PrizePoolBreakdown): string[] {
  const { tournament, registrations } = input;
  const warnings: string[] = [];

  if (tournament.status === "completed") {
    warnings.push(
      tournament.prizePoolSnapshot
        ? "Finalizing again replaces the stored positions, prizes and points"
        : "This tournament was finalized before payouts were recorded in full: its stored prizes will be overwritten",
    );
  }
  if (!tournament.prizePoolLocked) warnings.push("The prize pool is not locked");

  const unpaid = registrations.filter((r) => !r.paymentConfirmed).length;
  if (unpaid > 0) warnings.push(`${plural(unpaid, "payment")} not confirmed`);

  if (pool.netSource === "ap_override") {
    warnings.push(
      `${input.rakeLabel} is set manually to ${formatMoney(pool.rake.applied)} (the rates give ${formatMoney(pool.rake.calculated)})`,
    );
  } else if (pool.netSource === "manual_pool") {
    warnings.push(`The prize pool is set manually to ${formatMoney(pool.net)} (calculated ${formatMoney(pool.netAfterAp)})`);
  }
  if (pool.structure.error) warnings.push(pool.structure.error);

  if (registrations.length > 0 && pool.net <= 0) {
    warnings.push("The prize pool is $0 or less, so nobody is paid");
  }
  const undistributed = undistributedCents(pool.payouts, registrations.length);
  if (undistributed > 0) {
    warnings.push(`Only ${plural(registrations.length, "player")}: ${formatMoney(undistributed)} of the pool is not paid out`);
  }

  const pending = input.pendingRequests ?? [];
  if (pending.length > 0) {
    const listed = pending.slice(0, 5).map((request) => describeRequest(tournament, request));
    const more = pending.length > 5 ? ` and ${pending.length - 5} more` : "";
    warnings.push(
      `${plural(pending.length, "player request")} still waiting will be discarded: ${listed.join(", ")}${more}. ` +
        "Confirm or dismiss them under Confirm Actions first",
    );
  }
  return warnings;
}

function suggestedActivePlayers(
  registrations: readonly FinalizeRegistrationInput[],
  finishOrder: readonly string[] | undefined,
  nameOf: (playerId: string) => string,
): ActivePlayer[] {
  const given = new Map((finishOrder ?? []).map((id, index) => [id, index]));
  const rank = (r: FinalizeRegistrationInput) => given.get(r.id) ?? Number.MAX_SAFE_INTEGER;
  const stored = (r: FinalizeRegistrationInput) => r.finalPosition ?? Number.MAX_SAFE_INTEGER;
  return registrations
    .filter((r) => !r.isEliminated)
    .sort((a, b) => rank(a) - rank(b) || stored(a) - stored(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({ registrationId: r.id, playerId: r.playerId, playerName: nameOf(r.playerId) }));
}
