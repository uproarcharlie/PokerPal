/**
 * Tournament config: listing, reading, creating, updating and deleting. Updates run in one transaction
 * that locks the tournament row first; the manual prize pool and the AP rates go through ./prize-pool
 * (applyPrizePoolAdjustment, applyRakeRates), so every way of setting them follows the same rules and
 * leaves the same trail.
 */
import type { Request } from "express";
import {
  MAX_UPCOMING_TOURNAMENTS_PER_CLUB,
  type CreateTournamentInput,
  type TournamentsQuery,
  type TournamentStatus,
  type UpdateTournamentInput,
} from "@shared/api/tournaments";
import { isAmountSet, toCents } from "@shared/domain/money";
import { computePrizePool, rakeLabel } from "@shared/domain/prize-pool";
import { RAKE_RATE_KEYS, type RakeAmountKey, type RakeRates, type RakeTypeKey } from "@shared/domain/rake-rates";
import type { Tournament } from "@shared/schema";
import type { AppEnv } from "../config/env";
import { db, type Executor } from "../db";
import { clubScope, viewerFor } from "../http/authz";
import { badRequest, conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import * as pointsRepo from "../repositories/points";
import * as seasonsRepo from "../repositories/seasons";
import * as tournamentsRepo from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { assertOwnedImage, noteDeletedImages, noteReplacedImage } from "./images/upload";
import { applyPrizePoolAdjustment, applyRakeRates, assertApWithinGross, loadPrizePoolContext, mergedRatesOrThrow } from "./prize-pool";
import {
  assertHighHandAwardsFit,
  closedMessage,
  isClosed,
  toPublicTournament,
  toTournamentDetail,
  type TournamentDetail,
} from "./tournament-views";

const INVALID_MESSAGE = "Invalid tournament data";

/** The tournament, or 404. */
export async function requireTournament(id: string): Promise<Tournament> {
  const tournament = await tournamentsRepo.getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  return tournament;
}

/** GET /api/tournaments. Who has paid is counted only for the viewer's own clubs (P2REV0-SEC-04). */
export async function listTournaments(req: Request, query: TournamentsQuery) {
  const [rows, scope] = await Promise.all([
    tournamentsRepo.listTournamentsWithCounts(db, query),
    req.user ? clubScope(req.user) : null,
  ]);
  const runs = (clubId: string) => scope !== null && (scope.all || scope.clubIds.includes(clubId));
  return rows.map(({ tournament, registeredCount, confirmedPlayerCount }) => ({
    ...toPublicTournament(tournament),
    confirmedPlayerCount: runs(tournament.clubId) ? confirmedPlayerCount : null,
    registeredCount,
  }));
}

export async function getTournamentDetail(req: Request, id: string): Promise<TournamentDetail> {
  const row = await tournamentsRepo.getTournament(db, id);
  if (!row) throw notFound("Tournament not found");
  return toTournamentDetail(row, await viewerFor(req, row.clubId));
}

/** seasonId must be one of the club's seasons, and pointsSystemId one of that season's systems. */
async function assertSeasonAndPoints(
  ex: Executor,
  clubId: string,
  seasonId: string | null | undefined,
  pointsSystemId: string | null | undefined,
): Promise<void> {
  if (seasonId && (await seasonsRepo.getSeason(ex, seasonId))?.clubId !== clubId) {
    throw badRequest("That season does not belong to this tournament's club", "SEASON_NOT_IN_CLUB");
  }
  if (pointsSystemId && (!seasonId || (await pointsRepo.getPointsSystem(ex, pointsSystemId))?.seasonId !== seasonId)) {
    throw badRequest("That points system does not belong to the tournament's season", "POINTS_SYSTEM_NOT_IN_SEASON");
  }
}

/** The rates a tournament has before any are set: the columns' defaults (no AP on anything). */
const NO_RATES: RakeRates = {
  rakeType: "none",
  rakeAmount: "0.00",
  rebuyRakeType: "none",
  rebuyRakeAmount: "0.00",
  addonRakeType: "none",
  addonRakeAmount: "0.00",
  highHandRakeType: "none",
  highHandRakeAmount: "0.00",
};

/**
 * POST /api/tournaments: the caller manages `input.clubId` (checked by the route's guard). Its AP
 * rates are merged over the columns' defaults and checked by the same mergeRakeRates every later
 * change goes through (400 PERCENT_OVER_100 / AMOUNT_REQUIRED), so the API never accepts a rate at
 * creation that it would refuse to change afterwards (P2REV4-CQ-01). A club has at most
 * MAX_UPCOMING_TOURNAMENTS_PER_CLUB upcoming tournaments (409 TOURNAMENT_LIMIT_REACHED): any account
 * can open a club, and upcoming tournaments are listed on the public home page (SEC-P2REV-04). One
 * club's creates take turns, so two at once cannot both pass the count.
 */
export async function createTournament(env: AppEnv, req: Request, input: CreateTournamentInput): Promise<TournamentDetail> {
  assertOwnedImage(env, input.imageUrl, undefined, INVALID_MESSAGE);
  const { rates, others } = splitRates(input);
  const merged = mergedRatesOrThrow(NO_RATES, rates);
  const row = await db.transaction(async (tx) => {
    await assertSeasonAndPoints(tx, input.clubId, input.seasonId, input.pointsSystemId);
    await tournamentsRepo.lockClubTournamentCreates(tx, input.clubId);
    if ((await tournamentsRepo.countUpcomingTournaments(tx, input.clubId)) >= MAX_UPCOMING_TOURNAMENTS_PER_CLUB) {
      throw conflict(
        "TOURNAMENT_LIMIT_REACHED",
        `A club can have at most ${MAX_UPCOMING_TOURNAMENTS_PER_CLUB} upcoming tournaments: finish, cancel or delete some first`,
      );
    }
    return tournamentsRepo.createTournament(tx, { ...others, ...merged, rakeType: merged.rakeType ?? "none" });
  });
  return toTournamentDetail(row, await viewerFor(req, row.clubId));
}

const STATUS_LABELS: Readonly<Record<TournamentStatus, string>> = {
  scheduled: "Scheduled",
  registration: "Registration Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Only finalize completes a tournament, and a completed one keeps its status. A cancelled one can be
 * reopened as scheduled or open for registration, not straight back into play.
 */
function assertStatusChange(from: string, to: TournamentStatus): void {
  if (from === to) return;
  let problem: string | undefined;
  if (to === "completed") problem = "End the tournament with finalize to complete it";
  else if (from === "completed") problem = "A finished tournament's status cannot change";
  else if (from === "cancelled" && to === "in_progress") problem = "Reopen a cancelled tournament before starting it";
  if (problem) throw badRequest(problem, "INVALID_STATUS_TRANSITION");
}

/** The settings the prize pool and the season points are worked out from: frozen once the tournament is completed or cancelled. */
const POOL_FIELDS = [
  "buyInAmount",
  "rebuyAmount",
  "addonAmount",
  "rakeType",
  "rakeAmount",
  "rebuyRakeType",
  "rebuyRakeAmount",
  "addonRakeType",
  "addonRakeAmount",
  "payoutStructure",
  "customPayouts",
  "enableHighHand",
  "highHandAmount",
  "highHandRakeType",
  "highHandRakeAmount",
  "highHandPayouts",
  "manualPrizePool",
  "prizePoolLocked",
  // Season points are worked out at finalize too, and a correction must score with what was used (P2REV1-01).
  "trackPoints",
  "pointsSystemId",
] as const satisfies readonly (keyof UpdateTournamentInput & keyof Tournament)[];

const DECIMAL = /^\d+(\.\d+)?$/;

/** Whether a sent value is what is stored; amounts compare by value ("50" is "50.00"). */
function sameValue(next: unknown, stored: unknown): boolean {
  if (next === stored) return true;
  return (
    typeof next === "string" && typeof stored === "string" && DECIMAL.test(next) && DECIMAL.test(stored) && toCents(next) === toCents(stored)
  );
}

type RateKey = RakeTypeKey | RakeAmountKey;

/** Splits an update into its AP rate fields (rakeType/rakeAmount and the re-buy, add-on and high-hand pairs) and the rest. */
function splitRates<T extends object>(config: T): { rates: RakeRates; others: Omit<T, RateKey> } {
  const rates: Record<string, unknown> = {};
  const others: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  for (const key of RAKE_RATE_KEYS) {
    if (others[key] !== undefined) rates[key] = others[key];
    delete others[key];
  }
  return { rates: rates as RakeRates, others: others as Omit<T, RateKey> };
}

const ENTRY_AMOUNTS = ["buyInAmount", "rebuyAmount", "addonAmount"] as const;

/** The settings the high-hand pot and its number of prizes are worked out from. */
const HIGH_HAND_FIELDS = ["enableHighHand", "highHandAmount", "highHandRakeType", "highHandRakeAmount", "highHandPayouts"] as const;

/**
 * 409 HIGH_HAND_ENTRIES while any entry is in the high hand: the desk charges those entries and the
 * pot counts them whether or not the high hand is on, so turning it off would leave money collected
 * that nobody could award or see (P2REV1-MONEY-05).
 */
function assertNoHighHandEntrants(registrations: readonly { enteringHighHands: boolean | null }[]): void {
  const entrants = registrations.filter((registration) => registration.enteringHighHands === true).length;
  if (entrants === 0) return;
  const who = entrants === 1 ? "1 player has" : `${entrants} players have`;
  throw conflict("HIGH_HAND_ENTRIES", `${who} entered the high hand: take them out of it before turning it off`, { entrants });
}

/**
 * PUT /api/tournaments/:id. clubId may be resent but never changed; seasonId and pointsSystemId must
 * stay within the club; the status follows `assertStatusChange`; the pool settings are frozen once
 * the tournament is completed or cancelled. Locking the pool stamps prizePoolLockedAt; a manual
 * prize pool goes through the adjustment service and AP rates through the rates service, exactly as
 * their own endpoints do; new entry prices may not leave a manual AP total above the gross. A new
 * image must be one we stored. Status changes and locks are logged as before.
 */
export async function updateTournament(env: AppEnv, req: Request, id: string, input: UpdateTournamentInput): Promise<TournamentDetail> {
  let previousImageUrl: string | null = null;
  const row = await db.transaction(async (tx) => {
    const current = await tournamentsRepo.lockTournamentForUpdate(tx, id);
    if (!current) throw notFound("Tournament not found");
    previousImageUrl = current.imageUrl;
    const { clubId, status, prizePoolLocked, manualPrizePool, ...allConfig } = input;
    const { rates, others: config } = splitRates(allConfig);

    if (clubId !== undefined && clubId !== current.clubId) {
      throw badRequest("A tournament cannot move to another club", "CANNOT_MOVE");
    }
    if (status !== undefined) assertStatusChange(current.status, status);
    if (isClosed(current)) {
      const fields = POOL_FIELDS.filter((key) => input[key] !== undefined && !sameValue(input[key], current[key]));
      if (fields.length > 0) {
        throw conflict("TOURNAMENT_CLOSED", closedMessage(current, "its prize pool and points settings"), { fields });
      }
    }
    assertOwnedImage(env, input.imageUrl, current.imageUrl, INVALID_MESSAGE);
    if (config.seasonId !== undefined || config.pointsSystemId !== undefined) {
      await assertSeasonAndPoints(
        tx,
        current.clubId,
        config.seasonId !== undefined ? config.seasonId : current.seasonId,
        config.pointsSystemId !== undefined ? config.pointsSystemId : current.pointsSystemId,
      );
    }

    const locking = prizePoolLocked === true && !current.prizePoolLocked;
    const unlocking = prizePoolLocked === false && current.prizePoolLocked === true;
    const changes: tournamentsRepo.TournamentColumns = {
      ...config,
      ...(status !== undefined ? { status } : {}),
      ...(prizePoolLocked !== undefined ? { prizePoolLocked } : {}),
      ...(locking ? { prizePoolLockedAt: new Date() } : unlocking ? { prizePoolLockedAt: null } : {}),
    };
    let updated = current;
    if (Object.values(changes).some((value) => value !== undefined)) {
      updated = (await tournamentsRepo.setTournamentColumns(tx, id, changes)) ?? current;
    }

    if (status !== undefined && status !== current.status) {
      await insertActivity(tx, {
        tournamentId: id,
        eventType: "status_change",
        description: `Tournament status changed to ${STATUS_LABELS[status]}`,
      });
    }
    if (locking) {
      await insertActivity(tx, {
        tournamentId: id,
        eventType: "prize_pool_locked",
        description: "Prize pool has been locked - no further registrations, rebuys, or addons allowed",
      });
    }

    const ratesSent = Object.keys(rates).length > 0;
    const pricesSent = ENTRY_AMOUNTS.some((key) => config[key] !== undefined);
    const highHandSent = HIGH_HAND_FIELDS.some((key) => input[key] !== undefined);
    if (ratesSent || highHandSent || manualPrizePool !== undefined || (pricesSent && isAmountSet(current.rakeOverride))) {
      const context = await loadPrizePoolContext(tx, updated);
      if (input.enableHighHand === false && current.enableHighHand === true) {
        assertNoHighHandEntrants(context.registrations);
      }
      if (ratesSent) {
        const change = { changes: rates, keepOverride: false, clearOverrideWhenUnchanged: false, reason: null };
        updated = await applyRakeRates(tx, req, { ...context, tournament: updated }, change);
      }
      // Clearing a manual pool that is not set is not a change, and must not clear an AP override.
      if (manualPrizePool !== undefined && !(manualPrizePool === null && current.manualPrizePool === null)) {
        updated = await applyPrizePoolAdjustment(tx, req, {
          ...context,
          tournament: updated,
          adjustment: manualPrizePool === null ? { mode: "calculated" } : { mode: "manual_pool", amount: manualPrizePool },
        });
      }
      // A manual AP total is a fixed amount: new entry prices must not leave it above what is taken in.
      if (isAmountSet(updated.rakeOverride) && ENTRY_AMOUNTS.some((key) => !sameValue(updated[key], current[key]))) {
        const { gross } = computePrizePool(updated, context.registrations);
        assertApWithinGross(rakeLabel(context.club), toCents(updated.rakeOverride), gross.total);
      }
      // The high-hand awards already made must still fit a changed high-hand pot (MONEY-P2REV-05).
      assertHighHandAwardsFit({ tournament: current, registrations: context.registrations }, { tournament: updated, registrations: context.registrations });
    }
    return updated;
  });
  // After the commit: an image is an orphan only once the change that replaced it is stored.
  noteReplacedImage(previousImageUrl, row.imageUrl, `tournament ${id}`);
  return toTournamentDetail(row, await viewerFor(req, row.clubId));
}

/**
 * DELETE /api/tournaments/:id (owner or admin): a hard delete, as before, cascading to its
 * registrations and activity. Its banner is kept in storage and logged as an orphan once the delete
 * is stored, and named in the audit row (P2-PRODDATA-03).
 */
export async function deleteTournament(req: Request, id: string): Promise<void> {
  const deleted = await db.transaction(async (tx) => {
    const current = await tournamentsRepo.lockTournamentForUpdate(tx, id);
    if (!current) throw notFound("Tournament not found");
    await tournamentsRepo.deleteTournament(tx, id);
    await recordAudit(
      req,
      {
        action: "tournament.delete",
        targetType: "tournament",
        targetId: id,
        data: { name: current.name, clubId: current.clubId, status: current.status, imageUrl: current.imageUrl },
      },
      tx,
    );
    return current;
  });
  noteDeletedImages([deleted.imageUrl], `tournament ${id}`);
}
