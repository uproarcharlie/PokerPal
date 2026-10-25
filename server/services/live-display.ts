/**
 * The live display (phase4-contracts §3.2 rule 7): what the TV clock, the TD's clock panel and the
 * header's clock chip read, and what every clock write answers with. A public, PII-free projection:
 * the tournament, its club and season, the clock's anchors (each screen derives the time from them
 * and `serverNow`), the field's numbers, the chips in play, the money as the clock's display settings
 * allow, and where the QR code leads. Reading it never writes: the clock's auto-advance is derived.
 *
 * Also the public season leaderboard the QR code opens (rule 10).
 */
import type { Request } from "express";
import {
  DEFAULT_DISPLAY_SETTINGS,
  resolveDisplaySettings,
  type ClockDisplaySettings,
  type ClockDto,
  type ClockUndoDto,
} from "@shared/api/clock";
import type { LiveDisplayDto, PublicSeasonLeaderboardDto } from "@shared/api/live-display";
import { isBlindPresetKey } from "@shared/domain/blind-structures";
import { CLOCK_LIMITS, computeChipStats, normalizeClock, structureHash, undoAvailable } from "@shared/domain/clock";
import type { Cents } from "@shared/domain/money";
import { offersAddons, offersRebuys } from "@shared/domain/player-actions";
import { carryTargetName, differenceLines, type DifferenceLine } from "@shared/domain/prize-difference";
import { rakeLabel, type PrizePoolBreakdown } from "@shared/domain/prize-pool";
import { readTheme } from "@shared/domain/theme";
import { publicPaths } from "@shared/domain/urls";
import { fieldEntries } from "@shared/domain/waiting-list";
import type { Season, Tournament, TournamentClock, TournamentRegistration } from "@shared/schema";
import { db } from "../db";
import { viewerFor } from "../http/authz";
import { notFound } from "../http/errors";
import { clockStateOf, clockStructureOf, clockUndoOf, countActiveTables, getClock, seasonTournamentCounts } from "../repositories/clock";
import { getClub } from "../repositories/clubs";
import { seasonLeaderboard } from "../repositories/leaderboard";
import { registrationsOf } from "../repositories/registrations";
import { getSeason } from "../repositories/seasons";
import { getTournament } from "../repositories/tournaments";
import { carriesClockKey, clockKeyExpiry, clockKeyInForce } from "./clock-key";
import { toPrizePoolDto } from "./prize-pool";
import { isClosed, tournamentStatusOf } from "./tournament-views";

/** What Undo would do at `nowMs`, or null when nothing can be undone (none stored, or it lapsed). */
function undoDtoOf(row: TournamentClock, nowMs: number): ClockUndoDto | null {
  const undo = clockUndoOf(row);
  const levelIndex = normalizeClock(clockStateOf(row), row.levels, nowMs).currentLevelIndex;
  if (!undo || !undoAvailable(undo, levelIndex, nowMs)) return null;
  const { change, redo, at, startedTournamentFrom } = undo;
  return {
    action: change.action,
    description: change.description,
    redo,
    at,
    expiresAt: at + CLOCK_LIMITS.undoWindowMs,
    levelIndex: undo.levelIndex,
    startedTournamentFrom,
  };
}

/**
 * The clock as every screen reads it: the stored anchors (epoch ms), the structure and the resolved
 * settings. What Undo would do is told only to a viewer who may run the clock (`canControl`).
 */
export function toClockDto(row: TournamentClock, { nowMs, canControl }: { nowMs: number; canControl: boolean }): ClockDto {
  const structure = clockStructureOf(row);
  const undo = canControl ? undoDtoOf(row, nowMs) : null;
  return {
    version: row.version,
    ...clockStateOf(row),
    structure,
    structureHash: structureHash(structure),
    presetKey: isBlindPresetKey(row.presetKey) ? row.presetKey : null,
    displaySettings: resolveDisplaySettings(row.displaySettings),
    undo,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Where the QR code leads: the season leaderboard (else the tournament page), the tournament, the seat finder, or nowhere. */
export function qrTargetOf(
  target: ClockDisplaySettings["qrTarget"],
  tournamentId: string,
  season: Pick<Season, "id"> | null,
): LiveDisplayDto["qr"] {
  switch (target) {
    case "none":
      return null;
    case "season":
      if (season) return { target: "season", path: publicPaths.season(season.id) };
      return { target: "tournament", path: publicPaths.tournament(tournamentId) };
    case "tournament":
      return { target: "tournament", path: publicPaths.tournament(tournamentId) };
    case "seats":
      return { target: "seats", path: publicPaths.seats(tournamentId) };
  }
}

/**
 * Whether the TV shows the prize pool: per the setting, "when_locked" once the pool is locked or the
 * tournament completed. Never for a cancelled tournament, which pays nothing (nor its AP).
 */
function showsPrizePool(setting: ClockDisplaySettings["showPrizePool"], tournament: Tournament): boolean {
  if (tournament.status === "cancelled" || setting === "never") return false;
  return setting === "always" || tournament.prizePoolLocked === true || tournament.status === "completed";
}

/**
 * The pool's honest breakdown beside it on the TV (round 5, item 16: the same lines as the TD's and the
 * public pages), with the AP alone that goes with it: as finalize froze them once paid (a snapshot
 * from before round 5 records no difference, nor does a tournament whose results were typed in), else
 * live.
 */
function poolBreakdown(tournament: Tournament, breakdown: PrizePoolBreakdown, carryTarget: string): { lines: DifferenceLine[]; apCents: Cents } {
  if (tournament.status === "completed") {
    const pool = tournament.prizePoolSnapshot?.pool;
    if (!pool) return { lines: [], apCents: 0 };
    return { lines: differenceLines(pool, pool.difference?.carryTarget ?? carryTarget), apCents: pool.rakeOverrideCents ?? pool.rakeCalculatedCents };
  }
  return { lines: differenceLines(breakdown, carryTarget), apCents: breakdown.rake.applied };
}

/**
 * Who is still in and who earned the early-bird bonus (the entry counts come with the prize pool),
 * of the field: the waiting list (round 5, item 15) is not playing, so it counts toward neither.
 */
function fieldStats(tournament: Pick<Tournament, "maxPlayers">, registrations: readonly TournamentRegistration[]): { remaining: number; earlyBirds: number } {
  const field = fieldEntries(registrations, tournament.maxPlayers);
  return {
    remaining: field.filter((registration) => registration.isEliminated !== true).length,
    earlyBirds: field.filter((registration) => registration.earlyBird).length,
  };
}

/**
 * The TV clock key as the display tells of it: whether the request carries the key in force, and, for
 * a manager of the club, when that key was issued and expires. The key's issuer is looked up only when
 * someone it concerns asks: a manager, or a screen carrying it.
 */
async function clockKeyView(
  req: Request,
  clock: TournamentClock | undefined,
  clubId: string,
  canManage: boolean,
  nowMs: number,
): Promise<{ carried: boolean; issuedAt: string | null; expiresAt: string | null }> {
  const none = { carried: false, issuedAt: null, expiresAt: null };
  if (!clock?.controlKeyIssuedAt) return none;
  const carried = carriesClockKey(req, clock.controlKeyHash);
  if (!(carried || canManage) || !(await clockKeyInForce(clock, clubId, nowMs))) return none;
  return canManage
    ? { carried, issuedAt: clock.controlKeyIssuedAt.toISOString(), expiresAt: clockKeyExpiry(clock.controlKeyIssuedAt).toISOString() }
    : { carried, issuedAt: null, expiresAt: null };
}

/**
 * The live display of tournament `id`. `viewer.canControl` is the request's: while the tournament is
 * open, signed in as a manager of the club, or holding the TV's clock key in force. 404 for an unknown
 * tournament. Writes build it after their transaction commits.
 */
export async function liveDisplay(req: Request, id: string): Promise<LiveDisplayDto> {
  const tournament = await getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  const [registrations, club, clock, season, activeTables, viewer] = await Promise.all([
    registrationsOf(db, id),
    getClub(db, tournament.clubId),
    getClock(db, id),
    tournament.seasonId ? getSeason(db, tournament.seasonId) : undefined,
    countActiveTables(db, id),
    viewerFor(req, tournament.clubId),
  ]);
  if (!club) throw notFound("Tournament not found");

  const settings = clock ? resolveDisplaySettings(clock.displaySettings) : DEFAULT_DISPLAY_SETTINGS;
  // The prize pool's own figures (shared/domain/prize-pool, as finalize pays). The TV shows places
  // and amounts, never who won them, so no player names are loaded.
  const prizePool = toPrizePoolDto({ tournament, registrations, club, playerNames: new Map() });
  const { breakdown, display } = prizePool;
  const { counts } = breakdown;
  const field = fieldStats(tournament, registrations);
  // Counted for the TV only when it shows them: the chips in play, the average stack, or both.
  const chips =
    clock && (settings.showAverageStack || settings.showChipsInPlay)
      ? computeChipStats(clockStructureOf(clock), { buyIns: counts.buyIns, rebuys: counts.rebuys, addons: counts.addons, earlyBirds: field.earlyBirds }, field.remaining, null)
      : { totalChips: null, averageStack: null };
  const completed = tournament.status === "completed";
  const show = showsPrizePool(settings.showPrizePool, tournament);
  const showAp = settings.showAp && tournament.status !== "cancelled";
  // A pool fixed above what was taken in (a guarantee) makes the implied AP negative: the club adds money.
  const ap = breakdown.impliedRake;
  const pool = show ? poolBreakdown(tournament, breakdown, carryTargetName(season?.name)) : null;
  // While the lines beside the pool say what the club kept, carried over or added, the AP is the AP alone.
  const itemised = pool !== null && pool.lines.length > 0;
  const nowMs = Date.now();
  const key = await clockKeyView(req, clock, tournament.clubId, viewer.canManage, nowMs);
  const canControl = (viewer.canManage || key.carried) && !isClosed(tournament);

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      status: tournamentStatusOf(tournament),
      startDateTime: tournament.startDateTime.toISOString(),
      seasonId: tournament.seasonId,
      prizePoolLocked: tournament.prizePoolLocked === true,
      rebuyPeriodMinutes: tournament.rebuyPeriodMinutes,
      offersRebuys: offersRebuys(tournament),
      offersAddons: offersAddons(tournament),
    },
    club: { id: club.id, name: club.name, slug: club.slug, imageUrl: club.imageUrl, rakeLabel: rakeLabel(club), theme: readTheme(club.theme) },
    season: season ? { id: season.id, name: season.name } : null,
    clock: clock ? toClockDto(clock, { nowMs, canControl }) : null,
    stats: {
      entrants: counts.registrations,
      remaining: field.remaining,
      buyIns: counts.buyIns,
      rebuys: counts.rebuys,
      addons: counts.addons,
      earlyBirds: field.earlyBirds,
      activeTables,
      totalChips: chips.totalChips,
      averageStack: settings.showAverageStack ? chips.averageStack : null,
    },
    money: {
      show,
      estimated: prizePool.estimated,
      rakeLabel: prizePool.rakeLabel,
      // Never below zero on the room's screen, whatever the rates stored before AMOUNT_OVER_PRICE was refused.
      netCents: show ? (completed ? display.totalCents : Math.max(0, breakdown.net)) : null,
      netSource: show ? breakdown.netSource : null,
      apCents: showAp ? (itemised ? pool.apCents : Math.max(0, ap)) : null,
      clubAddedCents: showAp && !itemised && ap < 0 ? -ap : null,
      payouts: show && settings.showPayouts ? display.rows.map(({ position, amountCents }) => ({ position, amountCents })) : null,
      lines: pool?.lines ?? null,
    },
    qr: qrTargetOf(settings.qrTarget, tournament.id, season ?? null),
    viewer: { canControl, canChangeDisplay: viewer.canManage && !isClosed(tournament), clockKeyIssuedAt: key.issuedAt, clockKeyExpiresAt: key.expiresAt },
    // Last, after every read: each screen ticks from this.
    serverNow: Date.now(),
  };
}

/** GET /api/public/seasons/:id/leaderboard: the season page the TV's QR code opens. 404 for an unknown season. */
export async function publicSeasonLeaderboard(seasonId: string): Promise<PublicSeasonLeaderboardDto> {
  const season = await getSeason(db, seasonId);
  if (!season) throw notFound("Season not found");
  const [club, entries, tournaments] = await Promise.all([
    getClub(db, season.clubId),
    seasonLeaderboard(db, seasonId),
    seasonTournamentCounts(db, seasonId),
  ]);
  if (!club) throw notFound("Season not found");
  return {
    season: {
      id: season.id,
      name: season.name,
      startDate: season.startDate.toISOString(),
      endDate: season.endDate?.toISOString() ?? null,
      isActive: season.isActive === true,
    },
    club: { id: club.id, name: club.name, slug: club.slug, imageUrl: club.imageUrl, theme: readTheme(club.theme) },
    entries,
    tournaments,
    generatedAt: new Date().toISOString(),
  };
}
