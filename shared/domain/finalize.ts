/**
 * The finalize plan: who finished where, what each is paid and the points they get, plus the snapshot
 * finalize freezes on the tournament. PURE: no I/O, no clock (the caller passes the time), and no
 * runtime imports outside shared/domain. The server hashes `planHashInput(plan)` and writes the rows
 * in one transaction; the preview shows exactly the same plan, so what the TD sees is what is paid.
 *
 * Money is the v2 rule (`allocatePayouts`: each place's share floored to whole dollars, the leftover
 * dollars and cents to 1st, so the places add up to the pool exactly), or for custom places each
 * place's own amount (`placeAmounts`), with any difference from the money available settled as the
 * tournament chose (./prize-difference, round 5 item 16: kept by the club, added to 1st, shared across
 * the places, carried over, or added by the club): finalize pays exactly the prizes set, and the
 * snapshot records where the difference went. Places beyond the number of entrants are not paid (as
 * before; the warnings say how much). The waiting list (round 5, item 15: sign-ups beyond Max players
 * nobody accepted) never played: it is not ranked, paid, scored or counted. Only paid players are in the
 * pool (round 6), so a plan with players in the field whose payment is not confirmed is refused
 * (UNPAID_PLAYERS) until the TD confirms them or leaves them out (`excludeUnpaid`): left out, they are
 * not ranked, paid or scored either, and any result an earlier finalize stored for them is cleared.
 * A deal (./deal) replaces what the players still in are paid, sharing exactly what their places pay
 * together.
 */
import { dealProblems, type Dealable, type DealInput, type DealProblem, type SnapshotDeal } from "./deal";
import { centsToDecimalString, formatMoney, toCents, type Cents, type MoneyInput } from "./money";
import { PAYOUT_ALGORITHM, undistributedCents, type PayoutAlgorithm, type PayoutPlace, type PayoutStructureKey } from "./payouts";
import { carryTargetName, differenceSentence, type CarriedIn, type PrizeDifference } from "./prize-difference";
import { isPlayerActionType, PLAYER_ACTION_LABELS } from "./player-actions";
import { pointsForFinish, type AllocationInput, type PointsRules, type PointsSystemInput } from "./points";
import {
  amountDueCents,
  computePrizePool,
  hasPaid,
  type EntryInput,
  type NetSource,
  type PrizePoolBreakdown,
  type PrizePoolInput,
} from "./prize-pool";
import { rankFinishers, type FinisherInput, type FinishOrderProblem, type FinishOrderSource } from "./standings";
import { bySignUp, fieldEntries } from "./waiting-list";

export const FINALIZE_SNAPSHOT_VERSION = 1 as const;

/**
 * Where a difference between the prizes as set and the money available for prizes went (round 5,
 * item 16), as finalize paid it; `carryTarget` names where carried money went ("Winter League").
 */
export type SnapshotDifference = PrizeDifference & { carryTarget?: string };

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
    /** `places`: only for a custom structure with fixed places (round 5); basisPoints are then each place's share of this pool. */
    structure: { requested: string; used: PayoutStructureKey; basisPoints: number[]; places?: PayoutPlace[]; error?: string };
    /** Only when the prizes as set were not exactly the money available (round 5): where the difference went. */
    difference?: SnapshotDifference;
    /** Only when money carried over from earlier tournaments was in the pool (round 5). */
    carriedIn?: CarriedIn[];
  };
  /** The points rules scored with (absent from snapshots written before they were frozen). */
  points?: SnapshotPointsRules;
  /** The deal the players still in made, when they made one (round 5): `paid` holds what it paid them. */
  deal?: SnapshotDeal;
  /**
   * Positions 1..min(places, entrants), including any zero amounts, and every player in a deal (who may
   * finish below the paid places; their basisPoints are then 0).
   */
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
  /** The prize a previous finalize stored. */
  prizeAmount?: MoneyInput;
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
  /** What the players still in agreed to share instead of their places' payouts (checked with dealProblems). */
  deal?: DealInput;
  /** Where money carried over goes, as named (carryTargetName of the tournament's season); default "the next tournament". */
  carryTarget?: string;
  /**
   * Leave the players in the field whose payment is not confirmed out of the results (round 6): not
   * ranked, paid or scored, like the waiting list. Without it, a plan with any is refused (UNPAID_PLAYERS).
   */
  excludeUnpaid?: boolean;
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

/** A player in the field whose payment is not confirmed (round 6): what they owe, for the TD to take it or leave them out. */
export interface UnpaidPlayer extends ActivePlayer {
  /** amountDueCents: every buy-in, re-buy and add-on at the tournament's prices, and the high-hand entry. */
  amountDueCents: Cents;
}

interface PlanCommon {
  prizePool: PrizePoolBreakdown;
  /** Players still in, in the order to suggest: as given, else as last finalized, else by id. */
  activePlayers: ActivePlayer[];
  warnings: string[];
  /** The ids of the requests finalize would discard, sorted (part of the plan hash). */
  pendingRequestIds: string[];
  /** What a deal would share: the players still in and their places' payouts together; null with fewer than two in. */
  dealable: Dealable | null;
  /** The players in the field whose payment is not confirmed, by sign-up order: left out with excludeUnpaid, else the plan is refused. */
  unpaid: UnpaidPlayer[];
}

/**
 * DEAL_INVALID: the deal given does not share exactly what the players still in would be paid (see
 * `dealProblems`). UNPAID_PLAYERS: players in the field have not paid (`unpaid`), and the plan was not
 * told to leave them out. A finishing order is checked first: it is needed either way.
 */
export type FinalizePlanProblem = FinishOrderProblem | "DEAL_INVALID" | "UNPAID_PLAYERS";

export type FinalizePlan =
  | (PlanCommon & {
      ok: true;
      rows: FinalizeRow[];
      snapshot: PrizePoolSnapshot;
      /** Registrations left out of the results (unpaid, waiting) that hold a place, prize or points from an earlier finalize: finalize clears them. */
      clearedRegistrationIds: string[];
    })
  | (PlanCommon & { ok: false; problem: FinalizePlanProblem; dealProblems?: DealProblem[] });

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
  const { tournament } = input;
  const field = fieldEntries(input.registrations, tournament.maxPlayers);
  const nameOf = (playerId: string) => input.playerNames.get(playerId) ?? UNKNOWN_PLAYER;
  const unpaid = unpaidPlayers(tournament, field, nameOf);
  // Who is ranked: the field, or with excludeUnpaid only its paid players.
  const registrations = input.excludeUnpaid ? field.filter(hasPaid) : field;
  // Paid players only, as today's rule has it, even when correcting a tournament completed before it.
  const prizePool = computePrizePool(tournament, field.filter(hasPaid));
  const warnings = planWarnings(input, registrations, unpaid, prizePool);
  const activePlayers = suggestedActivePlayers(registrations, input.finishOrder, nameOf);
  const pendingRequestIds = (input.pendingRequests ?? []).map((request) => request.id).sort();

  const ranked = rankFinishers(registrations, input.finishOrder);
  if (!ranked.ok) {
    const dealable = dealableBeforeOrder(prizePool, activePlayers);
    return { ok: false, problem: ranked.problem, prizePool, activePlayers, warnings, pendingRequestIds, dealable, unpaid };
  }

  const points = pointsRulesFor(input);
  const rules: PointsRules = points;
  const planned = ranked.ordered.map((registration, index): FinalizeRow => {
    const finalPosition = index + 1;
    return withAmount(
      {
        registrationId: registration.id,
        playerId: registration.playerId,
        playerName: nameOf(registration.playerId),
        finalPosition,
        amountCents: 0,
        prizeAmount: null,
        pointsAwarded: pointsForFinish(rules, finalPosition, registration.knockouts),
      },
      prizePool.payouts[index]?.amountCents ?? 0,
    );
  });

  const stillIn = new Set(activePlayers.map((player) => player.registrationId));
  const dealable = dealableOf(planned.filter((row) => stillIn.has(row.registrationId)));
  if (unpaid.length > 0 && !input.excludeUnpaid) {
    return { ok: false, problem: "UNPAID_PLAYERS", prizePool, activePlayers, warnings, pendingRequestIds, dealable, unpaid };
  }
  let rows = planned;
  let deal: SnapshotDeal | undefined;
  if (input.deal) {
    const problems = dealProblems(dealable, input.deal);
    if (problems.length > 0) {
      return { ok: false, problem: "DEAL_INVALID", dealProblems: problems, prizePool, activePlayers, warnings, pendingRequestIds, dealable, unpaid };
    }
    const agreed = new Map(input.deal.amounts.map(({ registrationId, amountCents }) => [registrationId, amountCents]));
    rows = planned.map((row) => (agreed.has(row.registrationId) ? withAmount(row, agreed.get(row.registrationId) as Cents) : row));
    deal = {
      reason: input.deal.reason.trim(),
      totalCents: (dealable as Dealable).totalCents,
      players: planned
        .filter((row) => agreed.has(row.registrationId))
        .map((row) => ({
          registrationId: row.registrationId,
          playerId: row.playerId,
          playerName: row.playerName,
          position: row.finalPosition,
          plannedCents: row.amountCents,
          amountCents: agreed.get(row.registrationId) as Cents,
        })),
    };
    warnings.push(dealWarning(deal));
  }

  const { structure, difference, carriedIn } = prizePool;
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
        ...(structure.places ? { places: structure.places.map((place) => ({ ...place })) } : {}),
        ...(structure.error ? { error: structure.error } : {}),
      },
      ...(difference.cents !== 0 ? { difference: snapshotDifference(difference, input.carryTarget) } : {}),
      ...(carriedIn.length > 0 ? { carriedIn: carriedIn.map((entry) => ({ ...entry })) } : {}),
    },
    points,
    ...(deal ? { deal } : {}),
    paid: rows
      .filter((row, index) => index < structure.basisPoints.length || (deal !== undefined && stillIn.has(row.registrationId)))
      .map((row) => ({
        position: row.finalPosition,
        registrationId: row.registrationId,
        playerId: row.playerId,
        playerName: row.playerName,
        basisPoints: structure.basisPoints[row.finalPosition - 1] ?? 0,
        amountCents: row.amountCents,
      })),
    warnings: [...warnings, ...pointsChangeWarnings(registrations, rows, tournament.status === "completed", nameOf)],
  };

  const ranks = new Set(rows.map((row) => row.registrationId));
  const clearedRegistrationIds = input.registrations
    .filter((r) => !ranks.has(r.id) && (r.finalPosition != null || toCents(r.prizeAmount) > 0 || r.pointsAwarded != null))
    .map((r) => r.id)
    .sort();
  return { ok: true, prizePool, activePlayers, warnings: snapshot.warnings, rows, snapshot, pendingRequestIds, dealable, unpaid, clearedRegistrationIds };
}

/** The field's players whose payment is not confirmed, in sign-up order, with what each owes. */
function unpaidPlayers(
  tournament: FinalizeTournamentInput,
  field: readonly FinalizeRegistrationInput[],
  nameOf: (playerId: string) => string,
): UnpaidPlayer[] {
  return field
    .filter((r) => !hasPaid(r))
    .sort(bySignUp)
    .map((r) => ({ registrationId: r.id, playerId: r.playerId, playerName: nameOf(r.playerId), amountDueCents: amountDueCents(tournament, r) }));
}

function snapshotDifference(difference: PrizeDifference, carryTarget: string | undefined): SnapshotDifference {
  return { ...difference, ...(difference.carriedOverCents > 0 ? { carryTarget: carryTarget ?? carryTargetName(null) } : {}) };
}

function withAmount(row: FinalizeRow, amountCents: Cents): FinalizeRow {
  return { ...row, amountCents, prizeAmount: amountCents > 0 ? centsToDecimalString(amountCents) : null };
}

/** The players still in, with what their places pay (rows of theirs, in finish order); null with fewer than two. */
function dealableOf(rows: readonly FinalizeRow[]): Dealable | null {
  if (rows.length < 2) return null;
  return {
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    players: rows.map((row) => ({
      registrationId: row.registrationId,
      playerId: row.playerId,
      playerName: row.playerName,
      position: row.finalPosition,
      plannedCents: row.amountCents,
    })),
  };
}

/**
 * Before the finish order is known, what the players still in share: the payouts of places 1 to N
 * (they take those places between them, whatever the order).
 */
function dealableBeforeOrder(prizePool: PrizePoolBreakdown, activePlayers: readonly ActivePlayer[]): Dealable | null {
  if (activePlayers.length < 2) return null;
  return {
    totalCents: prizePool.payouts.slice(0, activePlayers.length).reduce((sum, payout) => sum + payout.amountCents, 0),
    players: activePlayers.map((player) => ({ ...player, position: null, plannedCents: null })),
  };
}

function dealWarning(deal: SnapshotDeal): string {
  return `Deal: the ${plural(deal.players.length, "player")} still in share ${formatMoney(deal.totalCents)} as agreed (${deal.reason})`;
}

/**
 * The text the plan hash is taken over: the pool, every row finalize writes, the player requests it
 * would discard, and where a difference from the money available goes (round 5: kept, carried over or
 * added by the club; a plan with none hashes as before). Any change to what would be paid, stored,
 * carried over or thrown away (a request arriving after the preview) changes it, so finalize can
 * refuse a plan that moved since the preview.
 */
export function planHashInput(
  netCents: Cents,
  rows: readonly FinalizeRow[],
  pendingRequestIds: readonly string[] = [],
  difference?: Pick<PrizeDifference, "cents" | "choice" | "keptByClubCents" | "carriedOverCents" | "addedByClubCents"> | null,
): string {
  return JSON.stringify([
    netCents,
    rows.map((r) => [r.registrationId, r.finalPosition, r.prizeAmount, r.pointsAwarded]),
    [...pendingRequestIds].sort(),
    ...(difference && difference.cents !== 0
      ? [[difference.choice, difference.keptByClubCents, difference.carriedOverCents, difference.addedByClubCents]]
      : []),
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

/** The plan's warnings; `registrations` are the players ranked (the field, less any unpaid players left out). */
function planWarnings(
  input: FinalizePlanInput,
  registrations: readonly FinalizeRegistrationInput[],
  unpaid: readonly UnpaidPlayer[],
  pool: PrizePoolBreakdown,
): string[] {
  const { tournament } = input;
  const warnings: string[] = [];

  if (tournament.status === "completed") {
    warnings.push(
      tournament.prizePoolSnapshot
        ? "Finalizing again replaces the stored positions, prizes and points"
        : "This tournament was finalized before payouts were recorded in full: its stored prizes will be overwritten",
    );
    const previousDeal = tournament.prizePoolSnapshot?.deal;
    if (previousDeal && !input.deal) {
      warnings.push(`It was finalized with a deal (${previousDeal.reason}): without one, the players still in are paid their places' payouts`);
    }
  }
  if (!tournament.prizePoolLocked) warnings.push("The prize pool is not locked");

  // Players who have not paid and are not left out refuse the plan (`unpaid` lists them); left out, it says who.
  if (unpaid.length > 0 && input.excludeUnpaid) {
    const names = unpaid.map((player) => player.playerName);
    const listed = names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", ");
    const one = unpaid.length === 1;
    warnings.push(`${plural(unpaid.length, "player")} who ${one ? "has" : "have"} not paid ${one ? "is" : "are"} left out, not ranked, paid or scored: ${listed}`);
  }
  const waitingList = input.registrations.length - registrations.length - (input.excludeUnpaid ? unpaid.length : 0);
  if (waitingList > 0) {
    warnings.push(`${plural(waitingList, "sign-up")} on the waiting list ${waitingList === 1 ? "is" : "are"} not ranked, paid or counted in the pool`);
  }

  if (pool.netSource === "ap_override") {
    warnings.push(
      `${input.rakeLabel} is set manually to ${formatMoney(pool.rake.applied)} (the rates give ${formatMoney(pool.rake.calculated)})`,
    );
  } else if (pool.netSource === "manual_pool") {
    warnings.push(`The prize pool is set manually to ${formatMoney(pool.manualPrizePool ?? pool.net)} (calculated ${formatMoney(pool.netAfterAp)})`);
  }
  for (const entry of pool.carriedIn) {
    warnings.push(`${formatMoney(entry.amountCents)} carried over from ${entry.fromName} is in the prize pool`);
  }
  const difference = differenceSentence(pool.difference, input.carryTarget ?? carryTargetName(null));
  if (difference) warnings.push(difference.replace(/\.$/, ""));
  if (pool.structure.error) warnings.push(pool.structure.error);
  if (pool.structure.warning) warnings.push(pool.structure.warning);

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
