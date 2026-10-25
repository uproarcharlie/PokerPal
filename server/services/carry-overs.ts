/**
 * Prize money carried over between tournaments (round 5, item 16). When a TD chooses "Carry it over"
 * for what the prizes leave of the money available, finalize records it here (recordCarryOver, in
 * finalize's transaction): one prize_carry_overs row per tournament, for the next tournament of its
 * season (or of the club, with no season) to add to its pool. A later tournament's staff add it
 * (applyCarryOver) and can take it out again while that tournament is open (removeCarryOver). The
 * tournament's carried_in lists what its pool holds, written in the same transaction as the row's
 * applied_to_tournament_id, so every screen's computePrizePool counts it ("Carried over from …").
 * Both are logged publicly; who did it is on the row (applied_by).
 */
import type { Request } from "express";
import type { CarryOverDto, CarryOversDto } from "@shared/api/prize-pool";
import { formatMoney, type Cents } from "@shared/domain/money";
import { readCarriedIn, type CarriedIn, type PrizeDifference } from "@shared/domain/prize-difference";
import { computePrizePool } from "@shared/domain/prize-pool";
import type { PrizeCarryOver, Tournament } from "@shared/schema";
import { db, type Executor } from "../db";
import { actingUserId } from "../http/authz";
import { conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import {
  availableCarryOvers,
  insertCarryOver,
  lockCarryOver,
  lockCarryOverOfSource,
  setCarryOverAppliedTo,
  updateCarryOver,
  type CarryOverWithSource,
} from "../repositories/carry-overs";
import { getSeason } from "../repositories/seasons";
import { getTournament, lockTournamentForUpdate, setTournamentColumns } from "../repositories/tournaments";
import { loadPrizePoolContext, moneyResponse, type MoneyResponse } from "./prize-pool";
import { assertOpen } from "./tournament-views";

const NOT_AVAILABLE = "That carried-over money is not available to this tournament";

function toCarryOverDto({ carryOver, sourceFinalizedAt, seasonName }: CarryOverWithSource): CarryOverDto {
  return {
    id: carryOver.id,
    fromTournamentId: carryOver.sourceTournamentId,
    fromName: carryOver.sourceName,
    carriedAt: (sourceFinalizedAt ?? carryOver.createdAt).toISOString(),
    amountCents: carryOver.amountCents,
    seasonName,
  };
}

/** GET /api/tournaments/:id/prize-pool/carry-overs: what this tournament may add to its pool, and what it holds. */
export async function listCarryOvers(id: string): Promise<CarryOversDto> {
  const tournament = await getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  const available = await availableCarryOvers(db, { tournamentId: id, clubId: tournament.clubId, seasonId: tournament.seasonId });
  return { available: available.map(toCarryOverDto), carriedIn: readCarriedIn(tournament.carriedIn) };
}

/**
 * Why `row` cannot go into `tournament`'s pool: it is unknown or another club's, it is the
 * tournament's own, it was carried over to another season, or it holds nothing (404); another
 * tournament took it first (409 CONFLICT). Null when it can.
 */
async function refusal(ex: Executor, tournament: Tournament, row: PrizeCarryOver | undefined) {
  if (!row || row.amountCents <= 0 || row.sourceTournamentId === tournament.id) return notFound(NOT_AVAILABLE);
  const source = await getTournament(ex, row.sourceTournamentId);
  if (!source || source.clubId !== tournament.clubId || source.status !== "completed") return notFound(NOT_AVAILABLE);
  if (row.targetSeasonId !== null && row.targetSeasonId !== tournament.seasonId) {
    const season = await getSeason(ex, row.targetSeasonId);
    return notFound(`That money was carried over to ${season?.name ?? "another season"}: only its tournaments can add it`);
  }
  if (row.appliedToTournamentId !== null && row.appliedToTournamentId !== tournament.id) {
    const taker = await getTournament(ex, row.appliedToTournamentId);
    return conflict("CONFLICT", `That money is already in ${taker?.name ?? "another tournament"}'s prize pool`);
  }
  return null;
}

const carriedText = (entry: Pick<CarriedIn, "amountCents" | "fromName">) => `${formatMoney(entry.amountCents)} carried over from ${entry.fromName}`;

/** The carried_in to store: null once nothing is carried in, as on every tournament before round 5. */
const storedCarriedIn = (entries: readonly CarriedIn[]): CarriedIn[] | null => (entries.length > 0 ? [...entries] : null);

/** POST /api/tournaments/:id/prize-pool/carry-overs/:carryOverId: adds that money to this tournament's pool. Adding it again changes nothing. */
export async function applyCarryOver(req: Request, id: string, carryOverId: string): Promise<MoneyResponse> {
  return await db.transaction(async (tx) => {
    const tournament = await lockTournamentForUpdate(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament, "its prize pool");
    const context = await loadPrizePoolContext(tx, tournament);
    const row = await lockCarryOver(tx, carryOverId);
    const refused = await refusal(tx, tournament, row);
    if (refused) throw refused;
    const carryOver = row as PrizeCarryOver;
    const held = readCarriedIn(tournament.carriedIn);
    if (carryOver.appliedToTournamentId === id && held.some((entry) => entry.carryOverId === carryOver.id)) return await moneyResponse(req, context);

    const entry: CarriedIn = {
      carryOverId: carryOver.id,
      fromTournamentId: carryOver.sourceTournamentId,
      fromName: carryOver.sourceName,
      amountCents: carryOver.amountCents,
    };
    await setCarryOverAppliedTo(tx, carryOver.id, id, actingUserId(req));
    const before = computePrizePool(tournament, context.registrations);
    const carriedIn = [...held.filter((other) => other.carryOverId !== carryOver.id), entry];
    const updated = (await setTournamentColumns(tx, id, { carriedIn })) ?? tournament;
    const after = computePrizePool(updated, context.registrations);
    await insertActivity(tx, {
      tournamentId: id,
      eventType: "prize_pool_adjusted",
      description: `${carriedText(entry)} added to the prize pool (now ${formatMoney(after.net)})`,
      eventData: JSON.stringify({ mode: "carry_in", carryOverId: carryOver.id, amountCents: entry.amountCents, netCents: after.net, previousNetCents: before.net }),
    });
    return await moneyResponse(req, { ...context, tournament: updated });
  });
}

/**
 * DELETE /api/tournaments/:id/prize-pool/carry-overs/:carryOverId: takes that money out of this
 * tournament's pool, free again for another tournament. Also once the tournament is cancelled (its
 * pool was never paid), never once it is completed.
 */
export async function removeCarryOver(req: Request, id: string, carryOverId: string): Promise<MoneyResponse> {
  return await db.transaction(async (tx) => {
    const tournament = await lockTournamentForUpdate(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    if (tournament.status !== "cancelled") assertOpen(tournament, "its prize pool");
    const context = await loadPrizePoolContext(tx, tournament);
    const held = readCarriedIn(tournament.carriedIn);
    const entry = held.find((other) => other.carryOverId === carryOverId);
    if (!entry) throw notFound("That money is not in this tournament's prize pool");
    const row = await lockCarryOver(tx, carryOverId);
    if (row?.appliedToTournamentId === id) await setCarryOverAppliedTo(tx, carryOverId, null, null);
    const before = computePrizePool(tournament, context.registrations);
    const updated = (await setTournamentColumns(tx, id, { carriedIn: storedCarriedIn(held.filter((other) => other !== entry)) })) ?? tournament;
    const after = computePrizePool(updated, context.registrations);
    await insertActivity(tx, {
      tournamentId: id,
      eventType: "prize_pool_adjusted",
      description: `${carriedText(entry)} taken out of the prize pool (now ${formatMoney(after.net)})`,
      eventData: JSON.stringify({ mode: "carry_out", carryOverId, amountCents: entry.amountCents, netCents: after.net, previousNetCents: before.net }),
    });
    return await moneyResponse(req, { ...context, tournament: updated });
  });
}

/**
 * Why finalizing with `carriedOverCents` to carry over cannot be written, given what the tournament
 * carried over before (`previous`): that money is already in another tournament's pool, and the
 * amount would change. Null when it can.
 */
export async function carryOverChangeProblem(ex: Executor, previous: PrizeCarryOver | undefined, carriedOverCents: Cents): Promise<string | null> {
  if (!previous?.appliedToTournamentId || previous.amountCents === carriedOverCents) return null;
  const taker = await getTournament(ex, previous.appliedToTournamentId);
  return (
    `${formatMoney(previous.amountCents)} this tournament carried over is already in ${taker?.name ?? "another tournament"}'s prize pool: ` +
    "take it out there before changing what is carried over"
  );
}

/**
 * Inside finalize's transaction (the tournament locked): records what `tournament` carries over, from
 * the plan's difference. A first finalize that carries money over writes the row; a correction updates
 * it while no tournament has taken the money (to $0 when it no longer carries any), and refuses with
 * 409 CONFLICT a change to money already in another pool.
 */
export async function recordCarryOver(
  tx: Executor,
  req: Request,
  tournament: Pick<Tournament, "id" | "name" | "seasonId">,
  difference: Pick<PrizeDifference, "carriedOverCents"> | undefined,
): Promise<void> {
  const amountCents = difference?.carriedOverCents ?? 0;
  const existing = await lockCarryOverOfSource(tx, tournament.id);
  const problem = await carryOverChangeProblem(tx, existing, amountCents);
  if (problem) throw conflict("CONFLICT", problem);
  if (existing) {
    if (existing.appliedToTournamentId) return;
    await updateCarryOver(tx, existing.id, { amountCents, sourceName: tournament.name, targetSeasonId: tournament.seasonId });
  } else if (amountCents > 0) {
    await insertCarryOver(tx, {
      sourceTournamentId: tournament.id,
      sourceName: tournament.name,
      targetSeasonId: tournament.seasonId,
      amountCents,
      createdBy: actingUserId(req),
    });
  }
}
