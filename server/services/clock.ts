/**
 * The tournament clock (phase4-contracts §3.2, spec D6-D8). The server stores anchors only and every
 * screen derives the time from them, so the clock needs no timer job and survives restarts. Manual
 * actions run shared/domain/clock's applyClockAction, the same rules the client shows:
 *
 * - start, pause and resume are idempotent and toggle carries the status the device showed, so a
 *   repeated tap changes nothing; next, prev, jump, adjust and set_remaining carry the level the
 *   device showed, so a double tap or two devices never skip a level (409 LEVEL_CHANGED);
 * - every write is a compare-and-set on `version`, retried from a fresh read up to three times
 *   (409 VERSION_CONFLICT after that), so concurrent writes apply one after the other;
 * - structure edits carry the hash of the structure they started from (409 STRUCTURE_CHANGED when
 *   someone else saved since) and keep the clock on its level (rebaseOnStructureChange);
 * - a start can also start the tournament (spec D8); undoing that start puts the tournament back to
 *   the status it had, so the public page offers registration again (TDN2-UNDO-START-STATUS).
 *
 * Each write commits in one transaction that first takes the tournament's row lock (the lock every
 * registration write and finalize take), so a write never lands on a tournament that closed under
 * it, and its activity entry commits with it. Every write answers with the fresh live display, and
 * every 409 carries it as `details.display`, so a device that lost a race shows the clock as it is.
 *
 * The TD can also issue the venue TV a clock key (server/services/clock-key.ts), which lets that
 * screen run the clock's actions without anyone signing in on it. Cancelling the tournament stops the
 * clock where it is and ends the key (stopClockForCancel); finalizing finishes it (finishClock).
 */
import type { Request } from "express";
import {
  resolveDisplaySettings,
  type BlindStructureSourceDto,
  type ClockActionInput,
  type ClockConfigInput,
  type ClockDisplaySettings,
  type ClockDisplaySettingsPatch,
  type ClockKeyDto,
} from "@shared/api/clock";
import type { ErrorCode } from "@shared/api/errors";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { BLIND_PRESETS, isBlindPresetKey } from "@shared/domain/blind-structures";
import {
  applyClockAction,
  INITIAL_CLOCK_STATE,
  normalizeClock,
  normalizeStructure,
  rebaseOnStructureChange,
  structureHash,
  type ClockStructure,
  type ClockUndo,
} from "@shared/domain/clock";
import { isUpcomingStatus, type TournamentStatus, type UpcomingStatus } from "@shared/domain/tournaments";
import { clockKeyLink } from "@shared/domain/urls";
import type { Tournament, TournamentClock } from "@shared/schema";
import { db, type Executor, type Transaction } from "../db";
import { actingUserId } from "../http/authz";
import { conflict, HttpError, notFound } from "../http/errors";
import { insertActivity, type NewActivity } from "../repositories/activity";
import {
  clockStateColumns,
  clockStateOf,
  clockStructureColumns,
  clockStructureOf,
  clockUndoOf,
  clubClocks,
  compareAndSetClock,
  deleteClock,
  getClock,
  insertClockIfAbsent,
  markClockFinished,
  moveTournamentStatusForClock,
  NO_CLOCK_KEY,
  setClockKey,
  type ClockColumns,
} from "../repositories/clock";
import { lockTournamentForRegistrationWrite } from "../repositories/registrations";
import { getTournament } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { clockKeyExpiry, hashClockKey, newClockKey } from "./clock-key";
import { liveDisplay } from "./live-display";
import { closedMessage, isClosed, statusChangeDescription, tournamentStatusOf } from "./tournament-views";

/** Reads and compare-and-sets per write before giving up with VERSION_CONFLICT. */
export const CLOCK_WRITE_ATTEMPTS = 3;

/** "Copy from a previous game": the club's newest clocks scanned, and the distinct structures listed. */
const STRUCTURE_SOURCES_SCANNED = 30;
const STRUCTURE_SOURCES_LISTED = 10;

const MESSAGES = {
  closed: (tournament: Tournament) => closedMessage(tournament, "its clock"),
  noClock: "This tournament has no clock yet: set one up first",
  exists: "This tournament already has a clock: reload it to edit its structure",
  finished: "The tournament is finished, so its clock can no longer change",
  structureChanged: "Someone else changed the blind structure since you opened it: check it and save again",
  levelRemoved: "The clock is on a level this structure removes: move the clock to another level first",
  versionConflict: "The clock kept changing while saving: check it and try again",
  inUse: "The clock is under way: reset it first, then remove it",
} as const;

/** 409 `code` with the clock as it now is (`details.display`). */
async function clockConflict(req: Request, id: string, code: ErrorCode, message: string): Promise<HttpError> {
  return conflict(code, message, { display: await liveDisplay(req, id) });
}

const noClock = () => new HttpError(404, "NO_CLOCK", MESSAGES.noClock);

/** 404 for a missing tournament, 409 TOURNAMENT_CLOSED (with the display) once it is completed or cancelled. */
async function assertTournamentOpen(req: Request, id: string): Promise<void> {
  const tournament = await getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  if (isClosed(tournament)) throw await clockConflict(req, id, "TOURNAMENT_CLOSED", MESSAGES.closed(tournament));
}

/**
 * Runs `write` in one transaction that first locks the tournament row and checks it is still open
 * (409 TOURNAMENT_CLOSED otherwise); `write` gets the locked row. The conflict's display is read after
 * the rollback: nothing inside the transaction may wait for another pooled connection.
 */
async function inClockTransaction<T>(req: Request, id: string, write: (tx: Transaction, tournament: Tournament) => Promise<T>): Promise<T> {
  const outcome = await db.transaction(async (tx): Promise<{ closed: Tournament } | { closed: null; value: T }> => {
    const tournament = await lockTournamentForRegistrationWrite(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    if (isClosed(tournament)) return { closed: tournament };
    return { closed: null, value: await write(tx, tournament) };
  });
  if (outcome.closed) throw await clockConflict(req, id, "TOURNAMENT_CLOSED", MESSAGES.closed(outcome.closed));
  return outcome.value;
}

/** A write worked out from the clock as it was read. */
interface ClockChange {
  columns: ClockColumns;
  activity: NewActivity[];
  /**
   * What the change does to the tournament's status: "start" moves a scheduled or registration one to
   * in progress (spec D8); `restore` puts an in-progress one back to the status an undone start moved
   * it on from.
   */
  tournamentStatus?: "start" | { restore: UpcomingStatus };
  /** The undo record to store with it; the write stamps on it whether the change really started the tournament. */
  undo?: ClockUndo;
}

/**
 * The status move a clock change makes on a tournament now at `status`, or null when it makes none (a
 * start of a tournament already under way; an undone start of one no longer in progress). `upcoming`
 * is the not-started status involved: what the undo record keeps as startedTournamentFrom.
 */
function statusMoveOf(
  status: TournamentStatus,
  wanted: ClockChange["tournamentStatus"],
): { from: TournamentStatus; to: TournamentStatus; upcoming: UpcomingStatus } | null {
  if (wanted === undefined) return null;
  if (wanted === "start") return isUpcomingStatus(status) ? { from: status, to: "in_progress", upcoming: status } : null;
  return status === "in_progress" ? { from: status, to: wanted.restore, upcoming: wanted.restore } : null;
}

/**
 * Reads the clock (404 NO_CLOCK), asks `plan` for the change at this moment (null: nothing to do; a
 * refusal is thrown) and compare-and-sets it. A lost race reads again and plans again, so every
 * check is made against the clock as it now is.
 */
async function changeClock(
  req: Request,
  id: string,
  plan: (row: TournamentClock, nowMs: number) => Promise<ClockChange | null>,
): Promise<void> {
  for (let attempt = 1; attempt <= CLOCK_WRITE_ATTEMPTS; attempt++) {
    const row = await getClock(db, id);
    if (!row) throw noClock();
    const change = await plan(row, Date.now());
    if (!change) return;
    const written = await inClockTransaction(req, id, async (tx, tournament) => {
      // Decided on the locked row, so the undo record says exactly what this write did to the status.
      const move = statusMoveOf(tournamentStatusOf(tournament), change.tournamentStatus);
      const undo = change.undo ? { undoState: { ...change.undo, startedTournamentFrom: move?.upcoming ?? null } } : {};
      const updated = await compareAndSetClock(tx, id, row.version, { ...change.columns, ...undo, updatedBy: actingUserId(req) });
      if (!updated) return false;
      if (move && (await moveTournamentStatusForClock(tx, id, move.from, move.to))) {
        await insertActivity(tx, { tournamentId: id, eventType: "status_change", description: statusChangeDescription(move.to) });
      }
      for (const entry of change.activity) await insertActivity(tx, entry);
      return true;
    });
    if (written) return;
  }
  throw await clockConflict(req, id, "VERSION_CONFLICT", MESSAGES.versionConflict);
}

const levelsText = (structure: ClockStructure) => {
  const count = structure.levels.filter((level) => level.kind === "level").length;
  return `${count} level${count === 1 ? "" : "s"}`;
};

function structureActivity(id: string, description: string, structure: ClockStructure, presetKey: string | null): NewActivity {
  return {
    tournamentId: id,
    eventType: "clock_structure_updated",
    description,
    eventData: JSON.stringify({ presetKey, levelCount: structure.levels.length, structureHash: structureHash(structure) }),
  };
}

/** POST /api/tournaments/:id/clock/actions: one manual action (start, pause, next, +1 min, undo, ...). */
export async function runClockAction(req: Request, id: string, action: ClockActionInput): Promise<LiveDisplayDto> {
  await assertTournamentOpen(req, id);
  await changeClock(req, id, async (row, nowMs) => {
    const result = applyClockAction(row.levels, clockStateOf(row), clockUndoOf(row), action, nowMs);
    if (!result.ok) throw await clockConflict(req, id, result.problem, result.message);
    if (!result.changed) return null;
    const restore = result.restoreTournamentStatus;
    return {
      columns: clockStateColumns(result.state),
      undo: result.undo,
      tournamentStatus: result.startTournament ? "start" : restore ? { restore } : undefined,
      activity: [
        { tournamentId: id, eventType: result.log.eventType, description: result.log.description, eventData: JSON.stringify(result.log.data) },
      ],
    };
  });
  return liveDisplay(req, id);
}

/**
 * PUT /api/tournaments/:id/clock: sets the clock up (baseHash null) or replaces its structure. The
 * structure is stored normalized. A save that changes nothing writes nothing.
 */
export async function configureClock(req: Request, id: string, input: ClockConfigInput): Promise<{ created: boolean; display: LiveDisplayDto }> {
  await assertTournamentOpen(req, id);
  const structure = normalizeStructure(input.structure);
  const baseHash = input.baseHash;
  if (baseHash === null) {
    await createClock(req, id, structure, input);
    return { created: true, display: await liveDisplay(req, id) };
  }

  await changeClock(req, id, async (row, nowMs) => {
    if (row.status === "finished") throw await clockConflict(req, id, "CLOCK_FINISHED", MESSAGES.finished);
    if (structureHash(clockStructureOf(row)) !== baseHash) throw await clockConflict(req, id, "STRUCTURE_CHANGED", MESSAGES.structureChanged);
    const presetKey = input.presetKey === undefined ? row.presetKey : input.presetKey;
    if (structureHash(structure) === baseHash && presetKey === row.presetKey) return null;
    const rebased = rebaseOnStructureChange(row.levels, structure.levels, clockStateOf(row), nowMs);
    if (!rebased.ok) throw await clockConflict(req, id, "CURRENT_LEVEL_REMOVED", MESSAGES.levelRemoved);
    return {
      // The undo snapshot belongs to the old structure.
      columns: { ...clockStructureColumns(structure), ...clockStateColumns(rebased.state), undoState: null, presetKey },
      activity: [structureActivity(id, `Blind structure updated (${levelsText(structure)})`, structure, presetKey)],
    };
  });
  return { created: false, display: await liveDisplay(req, id) };
}

async function createClock(req: Request, id: string, structure: ClockStructure, input: ClockConfigInput): Promise<void> {
  const presetKey = input.presetKey ?? null;
  const preset = BLIND_PRESETS.find((candidate) => candidate.key === presetKey);
  const created = await inClockTransaction(req, id, async (tx) => {
    const row = await insertClockIfAbsent(tx, id, {
      ...clockStructureColumns(structure),
      ...clockStateColumns(INITIAL_CLOCK_STATE),
      presetKey,
      displaySettings: input.displaySettings ?? {},
      updatedBy: actingUserId(req),
    });
    if (!row) return false;
    const description = preset ? `Clock set up: ${preset.name} (${levelsText(structure)})` : `Clock set up (${levelsText(structure)})`;
    await insertActivity(tx, structureActivity(id, description, structure, presetKey));
    return true;
  });
  if (!created) throw await clockConflict(req, id, "CLOCK_EXISTS", MESSAGES.exists);
}

const sameSettings = (a: ClockDisplaySettings, b: ClockDisplaySettings) =>
  (Object.keys(a) as Array<keyof ClockDisplaySettings>).every((key) => a[key] === b[key]);

/** PATCH /api/tournaments/:id/clock/display: what the TV shows. Not logged; a patch that changes nothing writes nothing. */
export async function changeDisplaySettings(req: Request, id: string, patch: ClockDisplaySettingsPatch): Promise<LiveDisplayDto> {
  await assertTournamentOpen(req, id);
  await changeClock(req, id, async (row) => {
    const current = resolveDisplaySettings(row.displaySettings);
    const next: ClockDisplaySettings = { ...current, ...patch };
    return sameSettings(current, next) ? null : { columns: { displaySettings: next }, activity: [] };
  });
  return liveDisplay(req, id);
}

/**
 * DELETE /api/tournaments/:id/clock: removes the clock (idempotent), answering the display without one.
 * Only while it is idle (not started, or reset): removing a running or paused clock would take its
 * place in the structure and the TV's settings with it, which no Undo brings back, so that is 409
 * CLOCK_IN_USE (TDN2-REMOVE-CLOCK-MIDGAME). Reset it first: a reset can still be undone.
 */
export async function removeClock(req: Request, id: string): Promise<LiveDisplayDto> {
  await assertTournamentOpen(req, id);
  const inUse = await inClockTransaction(req, id, async (tx) => {
    const row = await getClock(tx, id);
    if (row?.status === "running" || row?.status === "paused") return true;
    if (await deleteClock(tx, id)) await insertActivity(tx, { tournamentId: id, eventType: "clock_reset", description: "Clock removed" });
    return false;
  });
  if (inUse) throw await clockConflict(req, id, "CLOCK_IN_USE", MESSAGES.inUse);
  return liveDisplay(req, id);
}

/**
 * Finalizing the tournament stops its clock for good, inside finalize's transaction (which holds the
 * tournament's lock), on the level it has reached: a running clock moves on by itself, so the stored
 * level is only where the last manual action left it (P4REV1-01). A tournament with no clock is left
 * alone; finalizing again repeats it harmlessly.
 */
export async function finishClock(ex: Executor, tournamentId: string): Promise<void> {
  const row = await getClock(ex, tournamentId);
  if (!row) return;
  await markClockFinished(ex, tournamentId, normalizeClock(clockStateOf(row), row.levels, Date.now()).currentLevelIndex);
}

/**
 * Cancelling the tournament stops its clock where it is, inside the status change's transaction (which
 * holds the tournament's lock, so no clock write can come in between): every clock write is refused
 * while it is cancelled, so a running clock would run on out of reach, and a reopened tournament would
 * find it hours ahead (P4REV1-CC-05). A running clock is paused with the time it had left, logged like
 * a pause; the undo snapshot and the TV's clock key end with it. `updatedBy`: who cancelled.
 */
export async function stopClockForCancel(ex: Executor, tournamentId: string, updatedBy: string | null): Promise<void> {
  const row = await getClock(ex, tournamentId);
  if (!row) return;
  const paused = applyClockAction(row.levels, clockStateOf(row), null, { action: "pause" }, Date.now());
  const pause = paused.ok && paused.changed ? paused : null;
  if (!pause && row.undoState === null && row.controlKeyHash === null) return;
  const columns: ClockColumns = { ...(pause ? clockStateColumns(pause.state) : {}), undoState: null, ...NO_CLOCK_KEY, updatedBy };
  if (!(await compareAndSetClock(ex, tournamentId, row.version, columns)) || !pause) return;
  await insertActivity(ex, {
    tournamentId,
    eventType: pause.log.eventType,
    description: `${pause.log.description}: the tournament was cancelled`,
    eventData: JSON.stringify(pause.log.data),
  });
}

/**
 * POST /api/tournaments/:id/clock/key: a new clock key for the venue TV, replacing any other (that
 * screen loses its controls). The key is answered once, with the TV link that carries it; only its
 * hash is kept, with who issued it: it works until it expires, and only while they may still manage
 * the club. 404 NO_CLOCK without a clock. Audited (who issued it), not in the activity feed.
 */
export async function issueClockKey(req: Request, id: string): Promise<ClockKeyDto> {
  await assertTournamentOpen(req, id);
  const key = newClockKey();
  const issued = await inClockTransaction(req, id, async (tx) => {
    const row = await setClockKey(tx, id, { hash: hashClockKey(key), issuedBy: actingUserId(req) });
    if (row?.issuedAt) await recordAudit(req, { action: "clock.key_issued", targetType: "tournament", targetId: id }, tx);
    return row?.issuedAt ?? null;
  });
  if (!issued) throw noClock();
  return { key, issuedAt: issued.toISOString(), expiresAt: clockKeyExpiry(issued).toISOString(), path: clockKeyLink(id, key) };
}

/**
 * DELETE /api/tournaments/:id/clock/key: ends the TV's clock key (idempotent), answering the display.
 * Allowed once the tournament is closed too: taking a key back is never refused.
 */
export async function revokeClockKey(req: Request, id: string): Promise<LiveDisplayDto> {
  await db.transaction(async (tx) => {
    const tournament = await lockTournamentForRegistrationWrite(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    const row = await getClock(tx, id);
    if (row?.controlKeyHash) {
      await setClockKey(tx, id, null);
      await recordAudit(req, { action: "clock.key_revoked", targetType: "tournament", targetId: id }, tx);
    }
  });
  return liveDisplay(req, id);
}

/**
 * GET /api/clubs/:id/blind-structures: the structures of the club's latest clocks (latest start
 * first), each once, for "copy from a previous game".
 */
export async function clubBlindStructures(clubId: string): Promise<BlindStructureSourceDto[]> {
  const sources: BlindStructureSourceDto[] = [];
  const seen = new Set<string>();
  for (const { tournamentId, tournamentName, startDateTime, clock } of await clubClocks(db, clubId, STRUCTURE_SOURCES_SCANNED)) {
    const structure = clockStructureOf(clock);
    const hash = structureHash(structure);
    if (seen.has(hash)) continue;
    seen.add(hash);
    const presetKey = isBlindPresetKey(clock.presetKey) ? clock.presetKey : null;
    sources.push({ tournamentId, tournamentName, startDateTime: startDateTime.toISOString(), presetKey, structure, structureHash: hash });
    if (sources.length === STRUCTURE_SOURCES_LISTED) break;
  }
  return sources;
}
