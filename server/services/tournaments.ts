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
  type TournamentCountsDto,
  type TournamentsQuery,
  type TournamentStatus,
  type UpdateTournamentInput,
} from "@shared/api/tournaments";
import { formatMoney, isAmountSet, toCents } from "@shared/domain/money";
import { computePrizePool, rakeLabel, recordedEntryCounts } from "@shared/domain/prize-pool";
import type { HighHandRepricing } from "@shared/domain/high-hands";
import { isActiveStatus } from "@shared/domain/tournaments";
import { waitingListCount } from "@shared/domain/waiting-list";
import { RAKE_RATE_KEYS, type RakeAmountKey, type RakeRates, type RakeTypeKey } from "@shared/domain/rake-rates";
import { seatingSettingsProblem, type SeatingSettingsInput } from "@shared/domain/table-advisor";
import type { Tournament } from "@shared/schema";
import type { AppEnv } from "../config/env";
import { db, type Executor } from "../db";
import { actingUserId, clubScope, viewerFor } from "../http/authz";
import { badRequest, conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { getClub } from "../repositories/clubs";
import * as highHandsRepo from "../repositories/high-hands";
import * as pointsRepo from "../repositories/points";
import * as seasonsRepo from "../repositories/seasons";
import * as tournamentsRepo from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { stopClockForCancel } from "./clock";
import { assertCanShowBankTransfer } from "./club-payments";
import { applyHighHandsChange, describeHighHandRepricing } from "./high-hand-config";
import { highHandRowsByTournament, loadHighHandStore, withHighHands } from "./high-hands";
import { assertOwnedImage, noteDeletedImages, noteReplacedImage } from "./images/upload";
import {
  applyPrizePoolAdjustment,
  applyRakeRates,
  assertApWithinGross,
  assertRatesWithinPrices,
  highHandListed,
  loadPrizePoolContext,
  mergedRatesOrThrow,
  withTournament,
} from "./prize-pool";
import {
  assertHighHandAwardsFit,
  closedMessage,
  entriesRepricedConflict,
  isClosed,
  statusChangeDescription,
  toPublicTournament,
  toTournamentDetail,
  type TournamentDetail,
} from "./tournament-views";

const INVALID_MESSAGE = "Invalid tournament data";

/**
 * Round 5: the seating settings a create or edit would leave, checked with the club's defaults they
 * fall back on: an open-table threshold above the seats per table is refused on its field (400
 * VALIDATION). Nothing to check while no threshold is set (it then means "when full").
 */
async function assertSeatingSettings(ex: Executor, clubId: string, tournament: SeatingSettingsInput["tournament"]): Promise<void> {
  if (typeof tournament.openTableAt !== "number") return;
  const problem = seatingSettingsProblem({ tournament, club: await getClub(ex, clubId) });
  if (problem) throw badRequest(problem.message, "VALIDATION", [{ path: [problem.field], message: problem.message }]);
}

/** The tournament, or 404. */
export async function requireTournament(id: string): Promise<Tournament> {
  const tournament = await tournamentsRepo.getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  return tournament;
}

/**
 * GET /api/tournaments/counts: every club's tournaments (all, and the active ones) and every season's,
 * in one GROUP BY. Public, as the list it counts is (P3REV3-CQ-12).
 */
export async function tournamentCounts(): Promise<TournamentCountsDto> {
  const counts: TournamentCountsDto = { clubs: {}, seasons: {} };
  for (const { clubId, seasonId, status, count } of await tournamentsRepo.countTournamentsByClubSeasonAndStatus(db)) {
    const club = (counts.clubs[clubId] ??= { total: 0, active: 0 });
    club.total += count;
    if (isActiveStatus(status)) club.active += count;
    if (seasonId) counts.seasons[seasonId] = (counts.seasons[seasonId] ?? 0) + count;
  }
  return counts;
}

/**
 * GET /api/tournaments. Who has paid, and the club's takings (round 6), only for the viewer's own clubs
 * (P2REV0-SEC-04).
 */
export async function listTournaments(req: Request, query: TournamentsQuery) {
  const [rows, scope] = await Promise.all([
    tournamentsRepo.listTournamentsWithCounts(db, query),
    req.user ? clubScope(req.user) : null,
  ]);
  const runs = (clubId: string) => scope !== null && (scope.all || scope.clubIds.includes(clubId));
  // Every tournament's listed high hands in one query (perf-19).
  const highHands = highHandRowsByTournament(await highHandsRepo.highHandRowsOfTournaments(db, rows.map(({ tournament }) => tournament.id)));
  return rows.map(({ tournament, registeredCount, confirmedPlayerCount, inFieldByRightCount }) => ({
    ...toPublicTournament(withHighHands(tournament, { rows: highHands.get(tournament.id) ?? [] }), runs(tournament.clubId)),
    confirmedPlayerCount: runs(tournament.clubId) ? confirmedPlayerCount : null,
    registeredCount,
    waitingListCount: waitingListCount(registeredCount, inFieldByRightCount, tournament.maxPlayers),
  }));
}

export async function getTournamentDetail(req: Request, id: string): Promise<TournamentDetail> {
  const row = await tournamentsRepo.getTournament(db, id);
  if (!row) throw notFound("Tournament not found");
  return detailFor(req, row);
}

/** The tournament as the caller may see it, with its high hands as stored now (read after the write that changed them committed). */
async function detailFor(req: Request, row: Tournament): Promise<TournamentDetail> {
  const [store, viewer] = await Promise.all([loadHighHandStore(db, row.id), viewerFor(req, row.clubId)]);
  return toTournamentDetail(withHighHands(row, store), viewer);
}

/** The season and points settings: a tournament with no season is a one-off game (round 7). */
type PointsSettings = Pick<Tournament, "seasonId" | "pointsSystemId" | "trackPoints">;
type PointsChanges = Partial<Pick<UpdateTournamentInput, keyof PointsSettings>>;

const POINTS_FIELDS = ["seasonId", "pointsSystemId", "trackPoints"] as const satisfies readonly (keyof PointsSettings)[];

/** What a create stores when it says nothing: no season, no points system, the column's trackPoints default. */
const NO_POINTS: PointsSettings = { seasonId: null, pointsSystemId: null, trackPoints: true };

/** Whether the settings score points at finalize: tracked, with a points system to score with (shared/domain/points). */
const scoresPoints = (settings: PointsSettings) => settings.trackPoints === true && settings.pointsSystemId !== null;

/**
 * The season, points system and points switch `changes` leave over `stored` (round 7). Leaving the
 * season (a one-off game) takes the points system with it, as a points system belongs to one season;
 * moving to another season keeps it, for assertSeasonAndPoints to refuse. Points are tracked only
 * with a points system, so trackPoints is stored false without one, and every screen then says "no
 * points" as finalize scores none.
 */
function pointsSettings(stored: PointsSettings, changes: PointsChanges): PointsSettings {
  const seasonId = changes.seasonId !== undefined ? changes.seasonId : stored.seasonId;
  const pointsSystemId = changes.pointsSystemId !== undefined ? changes.pointsSystemId : seasonId === null ? null : stored.pointsSystemId;
  const trackPoints = (changes.trackPoints ?? stored.trackPoints === true) && pointsSystemId !== null;
  return { seasonId, pointsSystemId, trackPoints };
}

/**
 * The points fields `changes` sends that would change what a closed tournament scored with: its
 * season, its points system, or whether it scores at all (trackPoints without a points system is
 * the same as no points, so resending either way is no change).
 */
function changedPointsFields(stored: PointsSettings, changes: PointsChanges): (keyof PointsSettings)[] {
  const next = pointsSettings(stored, changes);
  const changed: Record<keyof PointsSettings, boolean> = {
    seasonId: next.seasonId !== stored.seasonId,
    pointsSystemId: next.pointsSystemId !== stored.pointsSystemId,
    trackPoints: scoresPoints(next) !== scoresPoints(stored),
  };
  return POINTS_FIELDS.filter((key) => changes[key] !== undefined && changed[key]);
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
 * club's creates take turns, so two at once cannot both pass the count. Showing bank transfer details
 * after sign-up (round 8) needs the club's bank details (400 VALIDATION on showBankTransfer).
 */
export async function createTournament(env: AppEnv, req: Request, input: CreateTournamentInput): Promise<TournamentDetail> {
  assertOwnedImage(env, input.imageUrl, undefined, INVALID_MESSAGE);
  assertNotBothHighHandForms(input);
  const { highHands, ...columns } = input;
  const { rates, others } = splitRates(columns);
  const merged = mergedRatesOrThrow(NO_RATES, rates);
  assertRatesWithinPrices({ ...input, ...merged });
  const points = pointsSettings(NO_POINTS, input);
  const row = await db.transaction(async (tx) => {
    await assertSeasonAndPoints(tx, input.clubId, points.seasonId, points.pointsSystemId);
    await assertSeatingSettings(tx, input.clubId, input);
    if (input.showBankTransfer === true) await assertCanShowBankTransfer(tx, input.clubId);
    await tournamentsRepo.lockClubTournamentCreates(tx, input.clubId);
    if ((await tournamentsRepo.countUpcomingTournaments(tx, input.clubId)) >= MAX_UPCOMING_TOURNAMENTS_PER_CLUB) {
      throw conflict(
        "TOURNAMENT_LIMIT_REACHED",
        `A club can have at most ${MAX_UPCOMING_TOURNAMENTS_PER_CLUB} upcoming tournaments: finish, cancel or delete some first`,
      );
    }
    const created = await tournamentsRepo.createTournament(tx, { ...others, ...points, ...merged, rakeType: merged.rakeType ?? "none" });
    // Round 10: listed from the start; a new tournament has no entries to re-price.
    if (!highHands || highHands.length === 0) return created;
    return (await applyHighHandsChange(tx, req, created, { highHands, reason: null })).tournament;
  });
  return detailFor(req, row);
}

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

/**
 * The settings the prize pool is worked out from: frozen once the tournament is completed or
 * cancelled. So are the season and points settings (POINTS_FIELDS, changedPointsFields): season
 * points are worked out at finalize too, and a correction must score with what was used (P2REV1-01).
 */
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
  // Round 11: not in the pool, but what each buy-in owed and the knockouts it paid out were worked out with it.
  "bountyAmount",
  "manualPrizePool",
  "prizePoolLocked",
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
 * 400 VALIDATION on the first legacy high-hand field sent with `highHands` (round 10): the list says it
 * all, and the legacy columns are then its summary.
 */
function assertNotBothHighHandForms(input: Pick<UpdateTournamentInput, "highHands" | (typeof HIGH_HAND_FIELDS)[number]>): void {
  if (input.highHands === undefined) return;
  const field = HIGH_HAND_FIELDS.find((key) => input[key] !== undefined);
  if (!field) return;
  const message = "Set the high hands as a list (highHands) or with the older fields, not both";
  throw badRequest(message, "VALIDATION", [{ code: "custom", path: [field], message }]);
}

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

/** Each entry price, the entries the pool counts at it, and the refusal for removing it while any are recorded. */
const PRICED_PARTS = [
  { price: "buyInAmount", count: "buyIns", one: "buy-in", many: "buy-ins", removed: null },
  { price: "rebuyAmount", count: "rebuys", one: "re-buy", many: "re-buys", removed: "REBUYS_RECORDED" },
  { price: "addonAmount", count: "addons", one: "add-on", many: "add-ons", removed: "ADDONS_RECORDED" },
  { price: "highHandAmount", count: "highHandEntrants", one: "high-hand entry", many: "high-hand entries", removed: "HIGH_HAND_ENTRIES" },
  // Round 11: each buy-in owes the bounty (shared/domain/bounty); never in the pool, and removable (no entry becomes $0).
  { price: "bountyAmount", count: "buyIns", one: "bounty", many: "bounties", removed: null },
] as const;

type PricedPart = (typeof PRICED_PARTS)[number];
type Repricing = { field: PricedPart["price"]; count: number; fromCents: number; toCents: number };
const entriesOf = (part: PricedPart, count: number) => `${count} ${count === 1 ? part.one : part.many}`;

/**
 * The pool counts every recorded entry at the tournament's current prices, so a new price re-prices
 * the entries already taken: every screen, what the desk asks for and finalize's payouts move with it
 * (P3REV0-PARITY-EDIT-REPRICE). Removing a price (null or $0) while its entries are recorded is
 * refused here, confirmed or not (REBUYS_RECORDED, ADDONS_RECORDED, HIGH_HAND_ENTRIES: those entries
 * would silently become $0). Returns every other change to a price with recorded entries: each needs
 * the TD's confirmation (assertRepricingConfirmed). For a tournament that lists its high hands (round
 * 10: `listsHighHands`), highHandAmount is their summary, and each high hand's fee is re-priced with
 * the list (./high-hand-config).
 */
function repricedEntries(
  before: Tournament,
  after: Tournament,
  counts: Readonly<Record<PricedPart["count"], number>>,
  { listsHighHands }: { listsHighHands: boolean },
): Repricing[] {
  const changes: Repricing[] = [];
  for (const part of PRICED_PARTS) {
    if (listsHighHands && part.price === "highHandAmount") continue;
    const count = counts[part.count];
    const from = toCents(before[part.price]);
    const to = toCents(after[part.price]);
    if (count === 0 || from === to) continue;
    if (to === 0 && part.removed !== null) {
      const recorded = `${entriesOf(part, count)} ${count === 1 ? "is" : "are"} recorded`;
      throw conflict(
        part.removed,
        `${recorded}: take them off the players before removing the ${part.one} price. To stop taking more, lock the prize pool.`,
        { field: part.price, count },
      );
    }
    changes.push({ field: part.price, count, fromCents: from, toCents: to });
  }
  return changes;
}

/**
 * 409 ENTRIES_REPRICED (details.changes) for a re-pricing the TD has not yet confirmed with
 * `repriceEntries: true`, saying what it re-prices: the form's prices and (round 10) the high hands'
 * fees, in one 409. Asked only once every refusal has passed, so the TD is never asked to confirm a
 * change that would then be refused anyway (HIGH_HAND_AWARDED, AP_EXCEEDS_GROSS, …).
 */
function assertRepricingConfirmed(changes: readonly Repricing[], highHands: readonly HighHandRepricing[], confirmed: boolean): void {
  if ((changes.length === 0 && highHands.length === 0) || confirmed) return;
  const list = changes.map((change) => {
    const part = PRICED_PARTS.find((candidate) => candidate.price === change.field) as PricedPart;
    return `${entriesOf(part, change.count)} from ${formatMoney(change.fromCents)} to ${formatMoney(change.toCents)}`;
  });
  // Round 11: a bounty is owed by each buy-in but never in the pool, so re-pricing only bounties leaves the pool as it is.
  const poolChanges = highHands.length > 0 || changes.some((change) => change.field !== "bountyAmount");
  throw entriesRepricedConflict([...list, ...highHands.map(describeHighHandRepricing)], [...changes, ...highHands], { poolChanges });
}

/**
 * PUT /api/tournaments/:id. clubId may be resent but never changed; seasonId and pointsSystemId must
 * stay within the club, and leaving the season (a one-off game) takes the points system with it
 * (pointsSettings); the status follows `assertStatusChange`; the pool, season and points settings
 * are frozen once the tournament is completed or cancelled. Locking the pool stamps
 * prizePoolLockedAt; a manual prize pool goes through the adjustment service and AP rates through
 * the rates service, exactly as their own endpoints do; a price with entries recorded at it is never
 * removed (repricedEntries) and changes only with `repriceEntries`, asked last
 * (assertRepricingConfirmed); new entry prices may not leave a manual AP total above the gross. A
 * new image must be one we stored; showing bank transfer details after sign-up is turned on only while
 * the club has them (round 8). Status changes and locks are logged as before.
 */
export async function updateTournament(env: AppEnv, req: Request, id: string, input: UpdateTournamentInput): Promise<TournamentDetail> {
  assertNotBothHighHandForms(input);
  let previousImageUrl: string | null = null;
  const row = await db.transaction(async (tx) => {
    const current = await tournamentsRepo.lockTournamentForUpdate(tx, id);
    if (!current) throw notFound("Tournament not found");
    previousImageUrl = current.imageUrl;
    const { clubId, status, prizePoolLocked, manualPrizePool, repriceEntries = false, keepRakeOverride = false, highHands, ...allConfig } = input;
    const { rates, others: config } = splitRates(allConfig);
    // Round 10: a tournament that lists its high hands keeps its legacy high-hand columns as their summary (a page loaded before resends them unchanged).
    const listedBefore = (await highHandsRepo.highHandRowsOf(tx, id)).length > 0;
    const storedHighHand = (key: (typeof HIGH_HAND_FIELDS)[number]) => (key === "highHandRakeType" ? (current[key] ?? "none") : current[key]);
    if (listedBefore && HIGH_HAND_FIELDS.some((key) => input[key] !== undefined && !sameValue(input[key], storedHighHand(key)))) throw highHandListed();

    if (clubId !== undefined && clubId !== current.clubId) {
      throw badRequest("A tournament cannot move to another club", "CANNOT_MOVE");
    }
    if (status !== undefined) assertStatusChange(current.status, status);
    const closed = isClosed(current);
    if (closed) {
      const fields = [
        ...POOL_FIELDS.filter((key) => input[key] !== undefined && !sameValue(input[key], current[key])),
        ...changedPointsFields(current, config),
      ];
      if (fields.length > 0) {
        throw conflict("TOURNAMENT_CLOSED", closedMessage(current, "its prize pool, season and points settings"), { fields });
      }
    }
    assertOwnedImage(env, input.imageUrl, current.imageUrl, INVALID_MESSAGE);
    const pointsSent = POINTS_FIELDS.some((key) => config[key] !== undefined);
    // A closed tournament keeps what it scored with: what was resent was the same (changedPointsFields).
    const points = pointsSent && !closed ? pointsSettings(current, config) : null;
    if (points && (config.seasonId !== undefined || config.pointsSystemId !== undefined)) {
      await assertSeasonAndPoints(tx, current.clubId, points.seasonId, points.pointsSystemId);
    }

    // Round 8: turned on only while the club has bank details to show; resent unchanged, it stays.
    if (config.showBankTransfer === true && current.showBankTransfer !== true) await assertCanShowBankTransfer(tx, current.clubId);
    if (config.openTableAt !== undefined || config.seatsPerTable !== undefined) {
      await assertSeatingSettings(tx, current.clubId, {
        ...current,
        ...(config.openTableAt !== undefined ? { openTableAt: config.openTableAt } : {}),
        ...(config.seatsPerTable !== undefined ? { seatsPerTable: config.seatsPerTable } : {}),
      });
    }

    const locking = prizePoolLocked === true && !current.prizePoolLocked;
    const unlocking = prizePoolLocked === false && current.prizePoolLocked === true;
    const { seasonId: _season, pointsSystemId: _points, trackPoints: _track, ...details } = config;
    const changes: tournamentsRepo.TournamentColumns = {
      ...details,
      ...points,
      ...(status !== undefined ? { status } : {}),
      ...(prizePoolLocked !== undefined ? { prizePoolLocked } : {}),
      ...(locking ? { prizePoolLockedAt: new Date() } : unlocking ? { prizePoolLockedAt: null } : {}),
    };
    let updated = current;
    if (Object.values(changes).some((value) => value !== undefined)) {
      updated = (await tournamentsRepo.setTournamentColumns(tx, id, changes)) ?? current;
    }
    // Round 10: the list of high hands, by PUT …/high-hands's rules; its re-pricing is confirmed with the form's, last.
    const highHandChange = highHands !== undefined ? await applyHighHandsChange(tx, req, updated, { highHands, reason: null }) : undefined;
    if (highHandChange) updated = highHandChange.tournament;
    const highHandRepricings = highHandChange?.repricings ?? [];

    if (status !== undefined && status !== current.status) {
      await insertActivity(tx, {
        tournamentId: id,
        eventType: "status_change",
        description: statusChangeDescription(status),
      });
      // Its clock would run on out of reach: every clock write is refused once it is cancelled.
      if (status === "cancelled") await stopClockForCancel(tx, id, actingUserId(req));
    }
    if (locking) {
      await insertActivity(tx, {
        tournamentId: id,
        eventType: "prize_pool_locked",
        description: "Prize pool has been locked - no further registrations, rebuys, or addons allowed",
      });
    }

    const ratesSent = Object.keys(rates).length > 0;
    const pricesSent = ENTRY_AMOUNTS.some((key) => config[key] !== undefined) || config.bountyAmount !== undefined;
    const highHandSent = HIGH_HAND_FIELDS.some((key) => input[key] !== undefined);
    if (ratesSent || highHandSent || manualPrizePool !== undefined || pricesSent) {
      const context = await loadPrizePoolContext(tx, updated);
      if (input.enableHighHand === false && current.enableHighHand === true) {
        assertNoHighHandEntrants(context.registrations);
      }
      // Every recorded entry, paid or not: a new price re-prices what the desk will ask each player for.
      const repriced = repricedEntries(current, updated, recordedEntryCounts(current, context.registrations), {
        listsHighHands: context.tournament.highHands !== null,
      });
      if (ratesSent) {
        const change = { changes: rates, keepOverride: keepRakeOverride, clearOverrideWhenUnchanged: false, reason: null };
        updated = await applyRakeRates(tx, req, withTournament(context, updated), change);
      }
      // Clearing a manual pool that is not set is not a change, and must not clear an AP override.
      if (manualPrizePool !== undefined && !(manualPrizePool === null && current.manualPrizePool === null)) {
        updated = await applyPrizePoolAdjustment(tx, req, {
          ...withTournament(context, updated),
          adjustment: manualPrizePool === null ? { mode: "calculated" } : { mode: "manual_pool", amount: manualPrizePool },
        });
      }
      // A fixed rate per entry must not take more than the entry: a new price is checked against it too.
      assertRatesWithinPrices(updated, current);
      // A manual AP total is a fixed amount: new entry prices must not leave it above what is taken in.
      if (isAmountSet(updated.rakeOverride) && ENTRY_AMOUNTS.some((key) => !sameValue(updated[key], current[key]))) {
        const { gross } = computePrizePool(updated, context.registrations);
        assertApWithinGross(rakeLabel(context.club), toCents(updated.rakeOverride), gross.total);
      }
      // The high-hand awards already made must still fit a changed high-hand pot (MONEY-P2REV-05); a new list was checked as it was set.
      if (!highHandChange) {
        const { tournament: before } = withTournament(context, current);
        assertHighHandAwardsFit({ tournament: before, registrations: context.registrations }, { tournament: withTournament(context, updated).tournament, registrations: context.registrations });
      }
      assertRepricingConfirmed(repriced, highHandRepricings, repriceEntries);
    } else {
      assertRepricingConfirmed([], highHandRepricings, repriceEntries);
    }
    return updated;
  });
  // After the commit: an image is an orphan only once the change that replaced it is stored.
  noteReplacedImage(previousImageUrl, row.imageUrl, `tournament ${id}`);
  return detailFor(req, row);
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
