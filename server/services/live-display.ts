/**
 * The live display (phase4-contracts §3.2 rule 7): what the TV clock, the TD's clock panel and the
 * header's clock chip read, and what every clock write answers with. A public, PII-free projection:
 * the tournament, its club and season, the clock's anchors (each screen derives the time from them
 * and `serverNow`), the field's numbers, the chips in play, the prize money as the clock's display
 * settings allow (never the club's takings, whoever looks: round 6), and where the QR code leads.
 * Reading it never writes: the clock's auto-advance is derived.
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
import { toPublicPrizes, type LiveDisplayDto, type PublicSeasonLeaderboardDto } from "@shared/api/live-display";
import { isBlindPresetKey } from "@shared/domain/blind-structures";
import { CLOCK_LIMITS, computeChipStats, normalizeClock, structureHash, undoAvailable } from "@shared/domain/clock";
import { offersAddons, offersRebuys } from "@shared/domain/player-actions";
import { rakeLabel } from "@shared/domain/prize-pool";
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
 * tournament completed. Never for a cancelled tournament, which pays nothing.
 */
function showsPrizePool(setting: ClockDisplaySettings["showPrizePool"], tournament: Tournament): boolean {
  if (tournament.status === "cancelled" || setting === "never") return false;
  return setting === "always" || tournament.prizePoolLocked === true || tournament.status === "completed";
}

/** The field's numbers on the TV. */
interface FieldStats {
  entrants: number;
  remaining: number;
  buyIns: number;
  rebuys: number;
  addons: number;
  earlyBirds: number;
}

/**
 * The field's numbers: everyone playing, paid or not (round 6: their chips are on the table whether or
 * not the TD has ticked the payment yet, though the prize pool counts only paid players), and never the
 * waiting list (round 5, item 15), which is not playing.
 */
function fieldStats(tournament: Pick<Tournament, "maxPlayers">, registrations: readonly TournamentRegistration[]): FieldStats {
  const stats: FieldStats = { entrants: 0, remaining: 0, buyIns: 0, rebuys: 0, addons: 0, earlyBirds: 0 };
  for (const registration of fieldEntries(registrations, tournament.maxPlayers)) {
    stats.entrants += 1;
    if (registration.isEliminated !== true) stats.remaining += 1;
    stats.buyIns += registration.buyIns ?? 0;
    stats.rebuys += registration.rebuys ?? 0;
    stats.addons += registration.addons ?? 0;
    if (registration.earlyBird) stats.earlyBirds += 1;
  }
  return stats;
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
  // The prize money as the public page has it (server/services/public-prizes: paid players only, as
  // finalize pays). The TV shows places and amounts, never who won them.
  const prizes = toPublicPrizes(tournament, registrations);
  const field = fieldStats(tournament, registrations);
  // Counted for the TV only when it shows them: the chips in play, the average stack, or both, each on its own switch.
  const chips =
    clock && (settings.showAverageStack || settings.showChipsInPlay)
      ? computeChipStats(clockStructureOf(clock), field, field.remaining, null)
      : { totalChips: null, averageStack: null };
  const show = showsPrizePool(settings.showPrizePool, tournament);
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
      prizePoolLocked: prizes.locked,
      rebuyPeriodMinutes: tournament.rebuyPeriodMinutes,
      offersRebuys: offersRebuys(tournament),
      offersAddons: offersAddons(tournament),
    },
    club: { id: club.id, name: club.name, slug: club.slug, imageUrl: club.imageUrl, rakeLabel: rakeLabel(club), theme: readTheme(club.theme) },
    season: season ? { id: season.id, name: season.name } : null,
    clock: clock ? toClockDto(clock, { nowMs, canControl }) : null,
    stats: {
      entrants: field.entrants,
      remaining: field.remaining,
      buyIns: field.buyIns,
      rebuys: field.rebuys,
      addons: field.addons,
      earlyBirds: field.earlyBirds,
      activeTables,
      totalChips: chips.totalChips,
      averageStack: settings.showAverageStack ? chips.averageStack : null,
    },
    money: {
      show,
      estimated: prizes.estimated,
      // Never below zero on the room's screen, whatever the rates stored before AMOUNT_OVER_PRICE was refused.
      netCents: show ? prizes.poolCents : null,
      payouts: show && settings.showPayouts ? prizes.payouts.map(({ position, amountCents }) => ({ position, amountCents })) : null,
      carriedIn: show ? prizes.carriedIn : null,
    },
    qr: qrTargetOf(settings.qrTarget, tournament.id, season ?? null),
    // The TV changes its own settings on the clock key too (PATCH …/clock/display allows the screen's own ones).
    viewer: { canControl, clockKeyIssuedAt: key.issuedAt, clockKeyExpiresAt: key.expiresAt },
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
