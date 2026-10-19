/**
 * A tournament's prize pool and AP (the club's name for rake), spec §5.2 #19-#20 and D11-D16. Every
 * figure comes from shared/domain/prize-pool, the same functions the client uses, so what the TD sees
 * is what finalize pays. The manual AP total and the manual prize pool are written together by one
 * UPDATE, so at most one is ever set. Both may change while the pool is locked, until the tournament
 * is completed or cancelled. Every change is logged to the activity feed (who did it goes to the
 * audit log only).
 */
import type { Request } from "express";
import type { PrizePoolAdjustmentInput, PrizePoolDto, RakeRatesInput } from "@shared/api/prize-pool";
import type { TournamentStatus } from "@shared/api/tournaments";
import { formatMoney, isAmountSet, toCents, type MoneyInput } from "@shared/domain/money";
import { computePrizePool, payoutsForDisplay, rakeLabel, type PayoutDisplay } from "@shared/domain/prize-pool";
import {
  mergeRakeRates,
  RAKE_COMPONENT_NAMES,
  RAKE_COMPONENTS,
  rateText,
  type MergedRakeRates,
  type RakeRates,
} from "@shared/domain/rake-rates";
import type { Club, Tournament, TournamentRegistration } from "@shared/schema";
import { db, type Executor } from "../db";
import { actingUserId, viewerFor } from "../http/authz";
import { badRequest, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { getClub } from "../repositories/clubs";
import { playerNames } from "../repositories/players";
import { registrationsOf } from "../repositories/registrations";
import { getTournament, lockTournamentForUpdate, setTournamentColumns } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { assertHighHandAwardsFit, assertOpen, toTournamentDetail, type TournamentDetail } from "./tournament-views";

type ClubLabel = Pick<Club, "rakeLabel"> | undefined;

export interface PrizePoolContext {
  tournament: Tournament;
  registrations: readonly TournamentRegistration[];
  club: ClubLabel;
  /** Player names by player id. */
  playerNames: ReadonlyMap<string, string>;
}

/** Everything a prize-pool response needs, read with `ex` (pass the transaction that changed it). */
export async function loadPrizePoolContext(ex: Executor, tournament: Tournament): Promise<PrizePoolContext> {
  const registrations = await registrationsOf(ex, tournament.id);
  const club = await getClub(ex, tournament.clubId);
  const names = await playerNames(ex, registrations.map((r) => r.playerId));
  return { tournament, registrations, club, playerNames: names };
}

/**
 * Who each paid row went to: the name the snapshot froze, or for stored prizes the player's current
 * name. Used by every response that lists what was paid (the prize pool, the finalize preview).
 */
export function paidPlayerName(
  { tournament, registrations, playerNames: names }: PrizePoolContext,
  display: PayoutDisplay,
): (registrationId: string) => string | undefined {
  if (display.source === "snapshot") {
    const frozen = new Map((tournament.prizePoolSnapshot?.paid ?? []).map((place) => [place.registrationId, place.playerName]));
    return (registrationId) => frozen.get(registrationId);
  }
  const playerOf = new Map(registrations.map((r) => [r.id, r.playerId]));
  return (registrationId) => names.get(playerOf.get(registrationId) ?? "");
}

/** What a screen shows as the payouts (payoutsForDisplay), each paid row with its player's name. */
export function displayWithNames(context: PrizePoolContext): PrizePoolDto["display"] {
  const { tournament, registrations } = context;
  const display = payoutsForDisplay(tournament, computePrizePool(tournament, registrations), registrations);
  const nameOf = paidPlayerName(context, display);
  const rows = display.rows.map((row) => {
    const playerName = row.registrationId ? nameOf(row.registrationId) : undefined;
    return playerName ? { ...row, playerName } : row;
  });
  return { ...display, rows };
}

/** GET /api/tournaments/:id/prize-pool and the prizePool part of every money response. */
export function toPrizePoolDto(context: PrizePoolContext): PrizePoolDto {
  const { tournament, registrations, club } = context;
  const breakdown = computePrizePool(tournament, registrations);

  const locked = tournament.prizePoolLocked === true;
  return {
    tournamentId: tournament.id,
    status: tournament.status as TournamentStatus,
    rakeLabel: rakeLabel(club),
    locked,
    estimated: !locked && tournament.status !== "completed",
    breakdown,
    display: displayWithNames(context),
    adjustment: tournament.prizePoolAdjustedAt
      ? { reason: tournament.prizePoolAdjustmentReason ?? null, adjustedAt: tournament.prizePoolAdjustedAt.toISOString() }
      : null,
  };
}

export async function getPrizePool(id: string): Promise<PrizePoolDto> {
  const tournament = await getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  return toPrizePoolDto(await loadPrizePoolContext(db, tournament));
}

/** Both unset, or both amounts of the same value ("300" is "300.00"). */
function sameAmount(a: MoneyInput, b: MoneyInput): boolean {
  return isAmountSet(a) === isAmountSet(b) && (!isAmountSet(a) || toCents(a) === toCents(b));
}

/**
 * Whether two rates take the same AP: the same type and amount, or both "none" whatever amount is
 * stored beside it (a row from before "none" stored 0.00 may keep the amount typed before; resending
 * it is not a change: MONEY-P2REV-04).
 */
function sameRate(type: string | null, amount: MoneyInput, storedType: string | null, storedAmount: MoneyInput): boolean {
  if (type !== storedType) return false;
  return type === "none" || sameAmount(amount, storedAmount);
}

const withReason = (text: string, reason: string | null) => (reason ? `${text} - ${reason}` : text);

export interface AdjustmentRequest {
  /** Locked by the caller's transaction. */
  tournament: Tournament;
  registrations: readonly TournamentRegistration[];
  club: ClubLabel;
  adjustment: PrizePoolAdjustmentInput;
}

/**
 * Sets the manual AP total or the manual prize pool (clearing the other), or clears both, inside the
 * caller's transaction. A request that changes nothing writes nothing. Returns the updated row.
 */
export async function applyPrizePoolAdjustment(tx: Executor, req: Request, request: AdjustmentRequest): Promise<Tournament> {
  const { tournament, registrations, club, adjustment } = request;
  const manualPrizePool = adjustment.mode === "manual_pool" ? adjustment.amount : null;
  const rakeOverride = adjustment.mode === "ap_override" ? adjustment.amount : null;
  const reason = adjustment.reason ?? null;
  // Checked before the closed rule: resending what is stored is not a change, even once it is closed.
  if (
    sameAmount(tournament.manualPrizePool, manualPrizePool) &&
    sameAmount(tournament.rakeOverride, rakeOverride) &&
    (reason === null || reason === tournament.prizePoolAdjustmentReason)
  ) {
    return tournament;
  }
  assertOpen(tournament, "its prize pool");
  const label = rakeLabel(club);
  const before = computePrizePool(tournament, registrations);
  if (rakeOverride !== null) assertApWithinGross(label, toCents(rakeOverride), before.gross.total);

  const updated =
    (await setTournamentColumns(tx, tournament.id, {
      manualPrizePool,
      rakeOverride,
      prizePoolAdjustmentReason: reason,
      prizePoolAdjustedAt: new Date(),
      prizePoolAdjustedBy: actingUserId(req),
    })) ?? tournament;
  const after = computePrizePool(updated, registrations);

  const amountCents = adjustment.mode === "calculated" ? null : toCents(adjustment.amount);
  const description =
    adjustment.mode === "ap_override"
      ? `${label} set manually to ${formatMoney(after.rake.applied)} (the rates give ${formatMoney(after.rake.calculated)})`
      : adjustment.mode === "manual_pool"
        ? `Prize pool set manually to ${formatMoney(after.net)} (calculated ${formatMoney(after.netAfterAp)})`
        : `Prize pool back to the calculated ${formatMoney(after.net)}`;
  await insertActivity(tx, {
    tournamentId: tournament.id,
    eventType: "prize_pool_adjusted",
    description: withReason(description, reason),
    eventData: JSON.stringify({ mode: adjustment.mode, amountCents, netCents: after.net, previousNetCents: before.net, reason }),
  });
  await recordAudit(
    req,
    {
      action: "prize_pool.adjust",
      targetType: "tournament",
      targetId: tournament.id,
      data: {
        mode: adjustment.mode,
        amountCents,
        reason,
        previous: {
          manualPrizePool: tournament.manualPrizePool,
          rakeOverride: tournament.rakeOverride,
          reason: tournament.prizePoolAdjustmentReason,
        },
        netCentsBefore: before.net,
        netCentsAfter: after.net,
      },
    },
    tx,
  );
  return updated;
}

/** 400 AP_EXCEEDS_GROSS: a manual AP total can never take more than the entries brought in. */
export function assertApWithinGross(label: string, apCents: number, grossCents: number): void {
  if (apCents > grossCents) {
    throw badRequest(`The ${label} cannot be more than the ${formatMoney(grossCents)} taken in`, "AP_EXCEEDS_GROSS", {
      grossCents,
    });
  }
}

/**
 * 400 AP_EXCEEDS_GROSS when a change that lowers what came in (an entry removed, fewer buy-ins,
 * re-buys or add-ons) would leave a manual AP total above the gross, which would pay every place $0
 * (spec D16, P2REV1-04). Call it in that change's transaction with the registrations after it.
 */
export async function assertApStillWithinGross(
  ex: Executor,
  tournament: Tournament,
  registrations: readonly TournamentRegistration[],
): Promise<void> {
  if (!isAmountSet(tournament.rakeOverride)) return;
  const apCents = toCents(tournament.rakeOverride);
  const { gross } = computePrizePool(tournament, registrations);
  if (apCents <= gross.total) return;
  const label = rakeLabel(await getClub(ex, tournament.clubId));
  throw badRequest(
    `The manual ${label} total (${formatMoney(apCents)}) would be more than the ${formatMoney(gross.total)} taken in: lower the ${label} first`,
    "AP_EXCEEDS_GROSS",
    { grossCents: gross.total },
  );
}

/** PUT /api/tournaments/:id/prize-pool/adjustment */
export async function adjustPrizePool(req: Request, id: string, adjustment: PrizePoolAdjustmentInput): Promise<MoneyResponse> {
  return await db.transaction(async (tx) => {
    const tournament = await lockTournamentForUpdate(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament, "its prize pool");
    const context = await loadPrizePoolContext(tx, tournament);
    const updated = await applyPrizePoolAdjustment(tx, req, { ...context, adjustment });
    return moneyResponse(req, { ...context, tournament: updated });
  });
}

export interface RakeRatesChange {
  /** The rates sent; the others keep their stored value. */
  changes: RakeRates;
  /** Keep the manual AP total although the rates change (PUT …/rates only). */
  keepOverride: boolean;
  /**
   * Whether the manual AP total is cleared when buy-in, re-buy or add-on rates are sent but none
   * changes: PUT …/rates is an explicit "use the rates" request, while PUT /api/tournaments/:id may
   * simply resend the stored rates. The high-hand rake alone never clears it.
   */
  clearOverrideWhenUnchanged: boolean;
  reason: string | null;
}

/** The rates `changes` merged over `stored`, or 400 PERCENT_OVER_100 / AMOUNT_REQUIRED naming the amount field. */
export function mergedRatesOrThrow(stored: RakeRates, changes: RakeRates): MergedRakeRates {
  const merged = mergeRakeRates(stored, changes);
  if (!merged.ok) {
    const message = merged.code === "PERCENT_OVER_100" ? "A percentage cannot be over 100" : "Enter an amount for that rate";
    throw badRequest(message, merged.code, { field: merged.field });
  }
  return merged.rates;
}

/**
 * The one way the AP rates change, for PUT …/prize-pool/rates and PUT /api/tournaments/:id alike,
 * inside the caller's transaction (the tournament row locked): merged over the stored rates and
 * checked (400 PERCENT_OVER_100 / AMOUNT_REQUIRED), logged (rake_rates_changed) and audited
 * (prize_pool.rates). A change to the buy-in, re-buy or add-on rate clears the manual AP total unless
 * keepOverride; the high-hand rake never does, since the high hand is a separate pot the AP override
 * never covers (MONEY-P2REV-01), and its change must still fit the high-hand awards already made. A
 * request that changes nothing writes nothing, even on a closed tournament. Returns the updated row.
 */
export async function applyRakeRates(tx: Executor, req: Request, context: PrizePoolContext, request: RakeRatesChange): Promise<Tournament> {
  const { tournament, registrations, club } = context;
  const rates = mergedRatesOrThrow(tournament, request.changes);
  const changed = RAKE_COMPONENTS.filter(({ type, amount }) => !sameRate(rates[type], rates[amount], tournament[type], tournament[amount]));
  const isAp = ({ type }: (typeof RAKE_COMPONENTS)[number]) => type !== "highHandRakeType";
  const apChanged = changed.some(isAp);
  const apSent = RAKE_COMPONENTS.some((component) => isAp(component) && (request.changes[component.type] !== undefined || request.changes[component.amount] !== undefined));
  const clearOverride =
    !request.keepOverride && tournament.rakeOverride !== null && (apChanged || (request.clearOverrideWhenUnchanged && apSent));
  if (changed.length === 0 && !clearOverride) return tournament;
  assertOpen(tournament, "its rates");

  const updated =
    (await setTournamentColumns(tx, tournament.id, {
      ...rates,
      // The buy-in rake type is NOT NULL; a stored row always has one, so this never replaces a value.
      rakeType: rates.rakeType ?? "none",
      ...(clearOverride ? { rakeOverride: null } : {}),
    })) ?? tournament;
  const label = rakeLabel(club);
  const parts = changed.map(({ type, amount }) => {
    const flat = type === "highHandRakeType";
    const from = rateText(tournament[type], tournament[amount], flat);
    return `${RAKE_COMPONENT_NAMES[type]} ${from} → ${rateText(rates[type], rates[amount], flat)}`;
  });
  if (clearOverride) parts.push(`the manual ${label} total is cleared`);
  assertHighHandAwardsFit({ tournament, registrations }, { tournament: updated, registrations });
  const before = computePrizePool(tournament, registrations);
  const after = computePrizePool(updated, registrations);
  await insertActivity(tx, {
    tournamentId: tournament.id,
    eventType: "rake_rates_changed",
    description: withReason(`${label} rates changed: ${parts.join("; ")}`, request.reason),
    eventData: JSON.stringify({ netCents: after.net, previousNetCents: before.net, clearedOverride: clearOverride }),
  });
  const pick = (row: Tournament | MergedRakeRates) =>
    Object.fromEntries(RAKE_COMPONENTS.flatMap(({ type, amount }) => [[type, row[type]], [amount, row[amount]]]));
  await recordAudit(
    req,
    {
      action: "prize_pool.rates",
      targetType: "tournament",
      targetId: tournament.id,
      data: { before: pick(tournament), after: pick(rates), clearedOverride: clearOverride, reason: request.reason },
    },
    tx,
  );
  return updated;
}

/** PUT /api/tournaments/:id/prize-pool/rates: merged over the stored rates; clears the AP override unless keepOverride. */
export async function changeRakeRates(req: Request, id: string, input: RakeRatesInput): Promise<MoneyResponse> {
  const { keepOverride, reason, ...changes } = input;
  return await db.transaction(async (tx) => {
    const tournament = await lockTournamentForUpdate(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament, "its rates");
    const context = await loadPrizePoolContext(tx, tournament);
    const updated = await applyRakeRates(tx, req, context, {
      changes,
      keepOverride,
      clearOverrideWhenUnchanged: true,
      reason: reason ?? null,
    });
    return moneyResponse(req, { ...context, tournament: updated });
  });
}

/** The body of both AP endpoints (`ApUpdateResponse` once serialised). */
export interface MoneyResponse {
  tournament: TournamentDetail;
  prizePool: PrizePoolDto;
}

async function moneyResponse(req: Request, context: PrizePoolContext): Promise<MoneyResponse> {
  const viewer = await viewerFor(req, context.tournament.clubId);
  return { tournament: toTournamentDetail(context.tournament, viewer), prizePool: toPrizePoolDto(context) };
}
