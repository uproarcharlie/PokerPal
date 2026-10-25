/**
 * The tournament clock: blind structures, the server-authoritative clock state, the clock's actions,
 * and the chip figures the display shows. PURE: no runtime imports but ./hash, no I/O, no Date: every
 * function that needs the time takes `nowMs` (epoch milliseconds), so the server and every screen
 * compute the same clock from the same stored anchors (spec D6).
 *
 * The server stores anchors only (ClockState): the status, the level the clock last stood at, when
 * the running period ends, or how much of it is left while idle or paused. `normalizeClock` and
 * `deriveClock` advance through levels and breaks on the fly, so the clock needs no background job
 * and survives restarts. `applyClockAction` is the one place a manual action changes the anchors,
 * with the double-tap guards of spec §4.3: start, pause and resume are idempotent; toggle takes the
 * status the device saw; next, prev, jump, adjust and set_remaining take the level the device saw
 * and refuse (LEVEL_CHANGED) when the clock has moved on. Each change can be undone, and the undo
 * redone, for a short while (ClockUndo); undo names the undo the device saw, so a second tap never
 * redoes it.
 *
 * Zod schemas for these shapes live in shared/api/clock.ts; this file stays zod-free so the public
 * TV display does not load zod.
 */
import { fnv1aHex } from "./hash";
import type { UpcomingStatus } from "./tournaments";

export const ANTE_MODES = ["none", "bb_ante", "everyone"] as const;
/**
 * How the structure's antes are paid: none; a big-blind ante (the player in the big blind pays the
 * ante for the table, usually equal to the big blind); or the classic ante every player pays.
 */
export type AnteMode = (typeof ANTE_MODES)[number];

export const ANTE_MODE_LABELS: Readonly<Record<AnteMode, string>> = {
  none: "No ante",
  bb_ante: "Big blind ante",
  everyone: "Ante (every player)",
};

export const CLOCK_STATUSES = ["idle", "running", "paused", "finished"] as const;
/** idle: not started (or reset); running; paused; finished: the tournament was finalized. */
export type ClockStatus = (typeof CLOCK_STATUSES)[number];

export const CLOCK_LIMITS = {
  maxLevels: 100,
  minMinutes: 1,
  maxMinutes: 240,
  maxChips: 100_000_000,
  maxNoteLength: 80,
  /** The most time one level can be given (adjust and set_remaining clamp to it). */
  maxRemainingMs: 4 * 60 * 60 * 1000,
  /** How long a manual change can be undone (and an undo redone): a slip is noticed at once, not an hour later. */
  undoWindowMs: 2 * 60 * 1000,
  /** How long a venue TV's clock key works after it was issued: one night's game, not a standing pass. */
  keyLifetimeMs: 24 * 60 * 60 * 1000,
} as const;

/** Level ids: stable across edits, so the clock keeps its place when rows are inserted or removed. */
export const LEVEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export interface PlayLevel {
  kind: "level";
  id: string;
  durationMinutes: number;
  smallBlind: number;
  bigBlind: number;
  /** In chips; what it means is the structure's AnteMode (ignored when it is "none"). */
  ante: number;
}

export interface BreakLevel {
  kind: "break";
  id: string;
  durationMinutes: number;
  /** Shown on the clock during the break, e.g. "Last re-buys / add-ons" or "Colour up". */
  note: string | null;
}

export type BlindLevel = PlayLevel | BreakLevel;

/** The structure a clock plays: its levels, how antes work, and the stacks the chip figures use. */
export interface ClockStructure {
  levels: BlindLevel[];
  anteMode: AnteMode;
  startingStack: number | null;
  /** Chips per re-buy; null means the starting stack. */
  rebuyStack: number | null;
  /** Chips per add-on; null means unknown (the chip figures are then hidden once anyone takes one). */
  addonStack: number | null;
  /** The early-bird bonus; null means unknown (hidden once anyone earns it). */
  earlyBirdStack: number | null;
}

/** The stored anchors (epoch ms). */
export interface ClockState {
  status: ClockStatus;
  currentLevelIndex: number;
  /** When the current period ends; set exactly while running. */
  periodEndsAt: number | null;
  /** What is left of the current period while idle or paused; null while idle means the whole level. */
  pausedRemainingMs: number | null;
  /** When the clock first started; null until then (and after a reset). */
  startedAt: number | null;
}

export const INITIAL_CLOCK_STATE: Readonly<ClockState> = Object.freeze({
  status: "idle",
  currentLevelIndex: 0,
  periodEndsAt: null,
  pausedRemainingMs: null,
  startedAt: null,
});

export const levelDurationMs = (level: BlindLevel): number => level.durationMinutes * 60_000;

/** Not started: idle at the first level with all of it to play. */
const isInitialState = (state: ClockState): boolean =>
  state.status === "idle" && state.currentLevelIndex === 0 && state.pausedRemainingMs === null && state.startedAt === null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// ---------------------------------------------------------------------------------------------------
// Structures

/** What is wrong with a structure beyond each field's own range (zod checks those): `path` locates it. */
export interface StructureProblem {
  path: Array<string | number>;
  message: string;
}

/**
 * Cross-row rules for a list of levels: at least one play level, at most CLOCK_LIMITS.maxLevels rows,
 * unique ids, and a big blind no smaller than the small blind. Empty when the levels can be played.
 */
export function structureProblems(levels: readonly BlindLevel[]): StructureProblem[] {
  const problems: StructureProblem[] = [];
  if (levels.length > CLOCK_LIMITS.maxLevels) {
    problems.push({ path: [], message: `A structure can have at most ${CLOCK_LIMITS.maxLevels} levels and breaks` });
  }
  if (!levels.some((level) => level.kind === "level")) problems.push({ path: [], message: "Add at least one blind level" });
  const seen = new Set<string>();
  levels.forEach((level, index) => {
    if (seen.has(level.id)) problems.push({ path: [index, "id"], message: "Duplicate level id" });
    seen.add(level.id);
    if (level.kind === "level" && level.bigBlind < level.smallBlind) {
      problems.push({ path: [index, "bigBlind"], message: "The big blind must be at least the small blind" });
    }
  });
  return problems;
}

/** The ante actually in play at a level: 0 on a break or when the structure has no antes. */
export function effectiveAnte(level: BlindLevel, anteMode: AnteMode): number {
  return level.kind === "level" && anteMode !== "none" ? level.ante : 0;
}

/**
 * The structure as the server stores it: antes cleared when the mode is "none" (so a level never
 * carries an ante nobody pays), and blank break notes as null.
 */
export function normalizeStructure(structure: ClockStructure): ClockStructure {
  return {
    ...structure,
    levels: structure.levels.map((level) => {
      if (level.kind === "break") {
        const note = level.note?.trim() ?? "";
        return { ...level, note: note === "" ? null : note };
      }
      return structure.anteMode === "none" ? { ...level, ante: 0 } : { ...level };
    }),
  };
}

function canonicalLevel(level: BlindLevel): unknown[] {
  return level.kind === "level"
    ? ["level", level.id, level.durationMinutes, level.smallBlind, level.bigBlind, level.ante]
    : ["break", level.id, level.durationMinutes, level.note ?? null];
}

/**
 * A fingerprint of a structure (levels, ante mode and stacks), 8 hex digits. Structure edits send the
 * hash they started from and are refused (STRUCTURE_CHANGED) if someone else saved in between. Key
 * order does not matter: Postgres jsonb hands objects back with their keys reordered.
 */
export function structureHash(structure: ClockStructure): string {
  return fnv1aHex(
    JSON.stringify([
      structure.levels.map(canonicalLevel),
      structure.anteMode,
      structure.startingStack ?? null,
      structure.rebuyStack ?? null,
      structure.addonStack ?? null,
      structure.earlyBirdStack ?? null,
    ]),
  );
}

/** How many play levels come up to and including `index` (1-based), or null when `index` is a break. */
export function levelNumberAt(levels: readonly BlindLevel[], index: number): number | null {
  if (levels[index]?.kind !== "level") return null;
  let number = 0;
  for (let i = 0; i <= index; i++) if (levels[i].kind === "level") number++;
  return number;
}

// ---------------------------------------------------------------------------------------------------
// Formatting

/** 1234567 → "1,234,567"; no locale, so every screen and the activity feed agree. */
export function formatChips(chips: number): string {
  const sign = chips < 0 ? "-" : "";
  return sign + String(Math.round(Math.abs(chips))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "200/400" */
export const formatBlinds = (level: PlayLevel): string => `${formatChips(level.smallBlind)}/${formatChips(level.bigBlind)}`;

/** The ante line of a level, e.g. "BB ante 400" or "Ante 50"; null when there is none in play. */
export function anteText(level: BlindLevel, anteMode: AnteMode): string | null {
  const ante = effectiveAnte(level, anteMode);
  if (ante <= 0) return null;
  return `${anteMode === "bb_ante" ? "BB ante" : "Ante"} ${formatChips(ante)}`;
}

/** "Level 3 (400/800)" or "Break (15 min)", as the activity feed names a level. */
export function levelTitle(levels: readonly BlindLevel[], index: number): string {
  const level = levels[index];
  if (!level) return "the end of the structure";
  if (level.kind === "break") return `Break (${level.durationMinutes} min)`;
  return `Level ${levelNumberAt(levels, index)} (${formatBlinds(level)})`;
}

/** Whole seconds, rounded up: "0:00", "4:05", "1:00:00". Negative time shows as 0:00. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

// ---------------------------------------------------------------------------------------------------
// Deriving the live clock

/**
 * The anchors brought up to `nowMs`: a running clock whose period ended moves on through the levels
 * (and breaks) whose time has passed, holding at the last one. The index is clamped into the levels.
 */
export function normalizeClock(state: ClockState, levels: readonly BlindLevel[], nowMs: number): ClockState {
  if (levels.length === 0) return { ...state, currentLevelIndex: 0 };
  const last = levels.length - 1;
  let index = clamp(state.currentLevelIndex, 0, last);
  if (state.status !== "running" || state.periodEndsAt === null) return { ...state, currentLevelIndex: index };
  let end = state.periodEndsAt;
  while (nowMs >= end && index < last) {
    index += 1;
    end += levelDurationMs(levels[index]);
  }
  return { ...state, currentLevelIndex: index, periodEndsAt: end };
}

export interface DerivedClock {
  status: ClockStatus;
  levelIndex: number;
  level: BlindLevel;
  isBreak: boolean;
  /** 1-based among the play levels; null on a break. */
  levelNumber: number | null;
  playLevelCount: number;
  /** The level being played, or null on a break. */
  currentPlayLevel: PlayLevel | null;
  remainingMs: number;
  durationMs: number;
  elapsedInLevelMs: number;
  next: BlindLevel | null;
  /** The next play level after this one: on a break, the blinds play resumes at. */
  nextPlayLevel: PlayLevel | null;
  /** Until the next break starts; null on a break or with no break ahead. */
  msUntilNextBreak: number | null;
  /** Since level 1 began, breaks included (what a re-buy period is measured against). */
  elapsedClockMs: number;
  isFinalLevel: boolean;
  /** Running on the final level with no time left: the clock holds at 0:00. */
  overtime: boolean;
}

/** The clock as every screen shows it at `nowMs`; null when there are no levels. */
export function deriveClock(state: ClockState, levels: readonly BlindLevel[], nowMs: number): DerivedClock | null {
  if (levels.length === 0) return null;
  const normalized = normalizeClock(state, levels, nowMs);
  const index = normalized.currentLevelIndex;
  const level = levels[index];
  const durationMs = levelDurationMs(level);
  let remainingMs: number;
  if (normalized.status === "finished") remainingMs = 0;
  else if (normalized.status === "running" && normalized.periodEndsAt !== null) remainingMs = Math.max(0, normalized.periodEndsAt - nowMs);
  else remainingMs = Math.max(0, normalized.pausedRemainingMs ?? durationMs);
  const elapsedInLevelMs = Math.max(0, durationMs - remainingMs);

  let elapsedBefore = 0;
  for (let i = 0; i < index; i++) elapsedBefore += levelDurationMs(levels[i]);

  let msUntilNextBreak: number | null = null;
  if (level.kind === "level") {
    let between = 0;
    for (let i = index + 1; i < levels.length; i++) {
      if (levels[i].kind === "break") {
        msUntilNextBreak = remainingMs + between;
        break;
      }
      between += levelDurationMs(levels[i]);
    }
  }

  const isFinalLevel = index === levels.length - 1;
  const nextPlayLevel = levels.slice(index + 1).find((candidate): candidate is PlayLevel => candidate.kind === "level") ?? null;
  return {
    status: normalized.status,
    levelIndex: index,
    level,
    isBreak: level.kind === "break",
    levelNumber: levelNumberAt(levels, index),
    playLevelCount: levels.filter((candidate) => candidate.kind === "level").length,
    currentPlayLevel: level.kind === "level" ? level : null,
    remainingMs,
    durationMs,
    elapsedInLevelMs,
    next: levels[index + 1] ?? null,
    nextPlayLevel,
    msUntilNextBreak,
    elapsedClockMs: elapsedBefore + elapsedInLevelMs,
    isFinalLevel,
    overtime: normalized.status === "running" && isFinalLevel && remainingMs === 0,
  };
}

/**
 * Time left before `minutes` of clock time have passed (e.g. a re-buy period), breaks included;
 * 0 once they have, null when there is no such limit.
 */
export function msUntilClockMinute(derived: Pick<DerivedClock, "elapsedClockMs">, minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined) return null;
  return Math.max(0, minutes * 60_000 - derived.elapsedClockMs);
}

// ---------------------------------------------------------------------------------------------------
// Actions

export const CLOCK_ACTIONS = ["start", "pause", "resume", "toggle", "next", "prev", "jump", "adjust", "set_remaining", "reset", "undo"] as const;
export type ClockActionName = (typeof CLOCK_ACTIONS)[number];

/**
 * A manual clock action, as POST /api/tournaments/:id/clock/actions takes it (validated by
 * shared/api/clock clockActionSchema). The device always sends the level it showed
 * (expectedLevelIndex) for next, prev, jump, adjust and set_remaining, the status it showed
 * (expectedStatus) for toggle, and the undo it showed (expectedUndo: its ClockUndo `at` and `redo`) for undo.
 */
export type ClockAction =
  | { action: "start"; alsoStartTournament?: boolean }
  | { action: "pause" }
  | { action: "resume"; alsoStartTournament?: boolean }
  | { action: "toggle"; expectedStatus?: "idle" | "running" | "paused"; alsoStartTournament?: boolean }
  | { action: "next"; expectedLevelIndex?: number }
  | { action: "prev"; expectedLevelIndex?: number }
  | { action: "jump"; levelIndex: number; expectedLevelIndex?: number }
  | { action: "adjust"; deltaSeconds: number; expectedLevelIndex?: number }
  | { action: "set_remaining"; remainingSeconds: number; expectedLevelIndex?: number }
  | { action: "reset" }
  | { action: "undo"; expectedUndo?: ExpectedUndo };

/**
 * The request header a venue TV sends its clock key in (POST /api/tournaments/:id/clock/key issues one):
 * with it the TV may run that tournament's clock, and nothing else, without a staff sign-in.
 */
export const CLOCK_KEY_HEADER = "X-Clock-Key";

/** The activity_log event types the clock writes (auto-advance writes none). */
export const CLOCK_EVENT_TYPES = [
  "clock_started",
  "clock_paused",
  "clock_resumed",
  "clock_level_changed",
  "clock_time_adjusted",
  "clock_reset",
  "clock_undone",
  "clock_structure_updated",
] as const;
export type ClockEventType = (typeof CLOCK_EVENT_TYPES)[number];

export interface ClockLogEntry {
  eventType: ClockEventType;
  description: string;
  /** Public (the activity feed): the action and the levels and time involved, never who did it. */
  data: { action: ClockActionName; fromLevelIndex: number; toLevelIndex: number; remainingMs: number | null };
}

/**
 * The clock's one-level undo, stored with it (tournament_clocks.undo_state): the anchors to go back to
 * and the change that going back reverts. Every manual change replaces it, an undo included: an undo
 * stores the clock as it was just before the undo, so pressing Undo again redoes the change. It lapses
 * CLOCK_LIMITS.undoWindowMs after it was made, and as soon as the clock moves to another level by
 * itself (undoAvailable): going back past an automatic level change would put the room back on blinds
 * it has already played (P4REV0-UNDO-BLIND).
 */
export interface ClockUndo {
  /** The anchors just before the change, as they were at `at`. */
  state: ClockState;
  /** The change in question: what Undo takes back or, when `redo`, puts back. */
  change: { action: Exclude<ClockActionName, "undo">; description: string };
  /** An undo took `change` back, so Undo now re-applies it. */
  redo: boolean;
  /** When the change (or the undo) was made, epoch ms. */
  at: number;
  /** The level the change (or the undo) left the clock on. */
  levelIndex: number;
  /**
   * `change` also started the tournament, which was this before: undoing it puts the tournament back
   * to it, and redoing it starts the tournament again. The server stamps it, since only the write
   * knows whether the tournament really started (it may have been under way already).
   */
  startedTournamentFrom: UpcomingStatus | null;
}

/** The undo a device showed: enough to tell it from the one that replaces it, even within one millisecond. */
export type ExpectedUndo = Pick<ClockUndo, "at" | "redo">;

/**
 * Whether an undo snapshot can still be used, with the clock now on `levelIndex` (as derived at
 * `nowMs`): within CLOCK_LIMITS.undoWindowMs of the change, and the clock still on the level the change
 * left it on. Screens use it to grey Undo out between polls; applyClockAction refuses a lapsed one.
 */
export function undoAvailable(undo: Pick<ClockUndo, "at" | "levelIndex"> | null, levelIndex: number, nowMs: number): boolean {
  return undo !== null && nowMs - undo.at <= CLOCK_LIMITS.undoWindowMs && levelIndex === undo.levelIndex;
}

export type ClockActionProblem =
  | "LEVEL_CHANGED"
  | "NOTHING_TO_UNDO"
  | "NO_LEVELS"
  | "CLOCK_FINISHED"
  | "LEVEL_OUT_OF_RANGE"
  | "NO_NEXT_LEVEL"
  | "NO_PREVIOUS_LEVEL";

export type ClockActionResult =
  /** Nothing to do (a repeated start or pause, a stale toggle, a move to where the clock already is): answer 200 with the current state. */
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      state: ClockState;
      /** The undo snapshot to store with the new state. */
      undo: ClockUndo;
      /** Also move a scheduled or registration tournament to in_progress, in the same transaction (spec D8). */
      startTournament: boolean;
      /** Undoing a start that also started the tournament: put it back to this status while it is still in progress, in the same transaction. */
      restoreTournamentStatus: UpcomingStatus | null;
      log: ClockLogEntry;
    }
  | { ok: false; problem: ClockActionProblem; message: string };

const ACTION_MESSAGES: Readonly<Record<ClockActionProblem, string>> = {
  LEVEL_CHANGED: "The clock has moved on since you looked: check the level and try again",
  NOTHING_TO_UNDO: "There is no clock change to undo",
  NO_LEVELS: "The clock has no levels: set up the structure first",
  CLOCK_FINISHED: "The tournament is finished, so its clock is stopped",
  LEVEL_OUT_OF_RANGE: "There is no such level in the structure",
  NO_NEXT_LEVEL: "This is the final level: add levels to the structure to go on",
  NO_PREVIOUS_LEVEL: "This is the first level: there is no level before it",
};

const UNDO_LAPSED_MESSAGE = `Too late to undo: a clock change can be undone for ${CLOCK_LIMITS.undoWindowMs / 60_000} minutes, and only until the clock moves to the next level by itself`;

const refuse = (problem: ClockActionProblem, message = ACTION_MESSAGES[problem]): ClockActionResult => ({ ok: false, problem, message });

function timeText(ms: number): string {
  return formatClock(Math.abs(ms));
}

/**
 * Undo (or redo) at `nowMs`, `before` being the stored state brought up to now. The snapshot comes back
 * as it was, except that a running clock which the change stopped (a pause or a reset) runs on from the
 * time it had left at the change: the time it then stood still is not counted as played
 * (P4REV1-02). When both run, the snapshot's own end stands, as if the change had never been made.
 * A start that also started the tournament takes the tournament's status back with it (and a redo
 * starts it again).
 *
 * `expected` is the undo the device showed: when the stored one is another (the first of two taps, or
 * another device, already undid it, or a newer change replaced it), nothing changes, as for a stale
 * toggle, so a second tap never redoes what the first undid (P4REV1-CC-01).
 */
function undoLastChange(
  levels: readonly BlindLevel[],
  before: ClockState,
  undo: ClockUndo | null,
  expected: ExpectedUndo | undefined,
  nowMs: number,
): ClockActionResult {
  if (!undo) return refuse("NOTHING_TO_UNDO");
  if (expected && (expected.at !== undo.at || expected.redo !== undo.redo)) return { ok: true, changed: false };
  if (!undoAvailable(undo, before.currentLevelIndex, nowMs)) return refuse("NOTHING_TO_UNDO", UNDO_LAPSED_MESSAGE);
  const snapshot = undo.state;
  const state: ClockState =
    snapshot.status === "running" && snapshot.periodEndsAt !== null && before.status !== "running"
      ? { ...snapshot, periodEndsAt: nowMs + Math.max(0, snapshot.periodEndsAt - undo.at) }
      : { ...snapshot };
  const levelIndex = normalizeClock(state, levels, nowMs).currentLevelIndex;
  return {
    ok: true,
    changed: true,
    state,
    undo: { state: { ...before }, change: undo.change, redo: !undo.redo, at: nowMs, levelIndex, startedTournamentFrom: undo.startedTournamentFrom },
    startTournament: undo.redo && undo.startedTournamentFrom !== null,
    restoreTournamentStatus: undo.redo ? null : undo.startedTournamentFrom,
    log: {
      eventType: "clock_undone",
      description: `${undo.redo ? "Redid" : "Undid"}: ${undo.change.description}`,
      data: { action: "undo", fromLevelIndex: before.currentLevelIndex, toLevelIndex: levelIndex, remainingMs: null },
    },
  };
}

/**
 * Applies one manual action to the stored state at `nowMs` (spec §4.3). The stored state is first
 * brought up to now (normalizeClock), so the guards compare against what every screen shows. Every
 * change returns the undo snapshot to store with it (ClockUndo); `undo` is the stored one.
 */
export function applyClockAction(
  levels: readonly BlindLevel[],
  stored: ClockState,
  undo: ClockUndo | null,
  action: ClockAction,
  nowMs: number,
): ClockActionResult {
  if (levels.length === 0) return refuse("NO_LEVELS");
  const before = normalizeClock(stored, levels, nowMs);
  if (before.status === "finished") return refuse("CLOCK_FINISHED");
  if (action.action === "undo") return undoLastChange(levels, before, undo, action.expectedUndo, nowMs);
  const name = action.action;
  const derived = deriveClock(before, levels, nowMs) as DerivedClock;
  const last = levels.length - 1;
  const at = derived.levelIndex;

  const run = (index: number, remainingMs: number): ClockState => ({
    status: "running",
    currentLevelIndex: index,
    periodEndsAt: nowMs + remainingMs,
    pausedRemainingMs: null,
    startedAt: before.startedAt ?? nowMs,
  });
  const hold = (status: "idle" | "paused", index: number, remainingMs: number | null): ClockState => ({
    status,
    currentLevelIndex: index,
    periodEndsAt: null,
    pausedRemainingMs: remainingMs,
    startedAt: before.startedAt,
  });
  const changed = (
    state: ClockState,
    eventType: ClockEventType,
    description: string,
    remainingMs: number | null,
    startTournament = false,
  ): ClockActionResult => ({
    ok: true,
    changed: true,
    state,
    undo: {
      state: { ...before },
      change: { action: name, description },
      redo: false,
      at: nowMs,
      // A running clock set to 0:00 is already on the next level.
      levelIndex: normalizeClock(state, levels, nowMs).currentLevelIndex,
      startedTournamentFrom: null,
    },
    startTournament,
    restoreTournamentStatus: null,
    log: { eventType, description, data: { action: name, fromLevelIndex: at, toLevelIndex: state.currentLevelIndex, remainingMs } },
  });

  const start = (alsoStartTournament: boolean | undefined): ClockActionResult => {
    if (before.status === "running") return { ok: true, changed: false };
    const firstStart = before.startedAt === null;
    const description = firstStart
      ? `Clock started at ${levelTitle(levels, at)}`
      : `Clock resumed at ${levelTitle(levels, at)}, ${timeText(derived.remainingMs)} left`;
    return changed(run(at, derived.remainingMs), firstStart ? "clock_started" : "clock_resumed", description, derived.remainingMs, alsoStartTournament === true);
  };
  const pause = (): ClockActionResult => {
    if (before.status !== "running") return { ok: true, changed: false };
    return changed(
      hold("paused", at, derived.remainingMs),
      "clock_paused",
      `Clock paused at ${timeText(derived.remainingMs)} in ${levelTitle(levels, at)}`,
      derived.remainingMs,
    );
  };
  const guardLevel = (expected: number | undefined): ClockActionResult | null =>
    expected !== undefined && expected !== at ? refuse("LEVEL_CHANGED") : null;
  // Next past the final level (the structure ran out) or Previous before the first is said, not
  // silently ignored, so the TD knows why nothing moved (TDN3-NEXT-FINAL-SILENT).
  const moveTo = (index: number): ClockActionResult => {
    if (index > last) return refuse("NO_NEXT_LEVEL");
    if (index < 0) return refuse("NO_PREVIOUS_LEVEL");
    if (index === at) return { ok: true, changed: false };
    const duration = levelDurationMs(levels[index]);
    const state =
      before.status === "running" ? run(index, duration) : before.status === "paused" ? hold("paused", index, duration) : hold("idle", index, null);
    return changed(state, "clock_level_changed", `Moved to ${levelTitle(levels, index)}`, duration);
  };
  const setRemaining = (remainingMs: number, description: string): ClockActionResult => {
    const remaining = clamp(Math.round(remainingMs), 0, CLOCK_LIMITS.maxRemainingMs);
    const state = before.status === "running" ? run(at, remaining) : hold(before.status === "paused" ? "paused" : "idle", at, remaining);
    return changed(state, "clock_time_adjusted", description, remaining);
  };

  switch (action.action) {
    case "start":
    case "resume":
      return start(action.alsoStartTournament);
    case "pause":
      return pause();
    case "toggle":
      if (action.expectedStatus !== undefined && action.expectedStatus !== before.status) return { ok: true, changed: false };
      return before.status === "running" ? pause() : start(action.alsoStartTournament);
    case "next":
      return guardLevel(action.expectedLevelIndex) ?? moveTo(at + 1);
    case "prev":
      return guardLevel(action.expectedLevelIndex) ?? moveTo(at - 1);
    case "jump":
      if (action.levelIndex > last) return refuse("LEVEL_OUT_OF_RANGE");
      return guardLevel(action.expectedLevelIndex) ?? moveTo(action.levelIndex);
    case "adjust": {
      const refused = guardLevel(action.expectedLevelIndex);
      if (refused) return refused;
      const verb = action.deltaSeconds >= 0 ? "Added" : "Took";
      const preposition = action.deltaSeconds >= 0 ? "to" : "off";
      return setRemaining(
        derived.remainingMs + action.deltaSeconds * 1000,
        `${verb} ${timeText(action.deltaSeconds * 1000)} ${preposition} ${levelTitle(levels, at)}`,
      );
    }
    case "set_remaining": {
      const refused = guardLevel(action.expectedLevelIndex);
      if (refused) return refused;
      return setRemaining(action.remainingSeconds * 1000, `Clock set to ${timeText(action.remainingSeconds * 1000)} in ${levelTitle(levels, at)}`);
    }
    case "reset":
      // Already reset: a second Reset must not replace the undo that brings the clock back (P4REV1-CC-04).
      if (isInitialState(before)) return { ok: true, changed: false };
      return changed({ ...INITIAL_CLOCK_STATE }, "clock_reset", `Clock reset to ${levelTitle(levels, 0)}`, null);
  }
}

/**
 * The clock after its structure changes from `oldLevels` to `newLevels` (spec §4.3): it stays on the
 * same level (found by id), keeping the time already played in it and any time added, so inserting
 * or deleting other rows never moves the clock. Removing the level the clock is on is refused
 * (CURRENT_LEVEL_REMOVED) unless the clock is idle, which then stays at the same position from the
 * level's start. Never called for a finished clock (the server refuses CLOCK_FINISHED first).
 */
export function rebaseOnStructureChange(
  oldLevels: readonly BlindLevel[],
  newLevels: readonly BlindLevel[],
  state: ClockState,
  nowMs: number,
): { ok: true; state: ClockState } | { ok: false; problem: "CURRENT_LEVEL_REMOVED" } {
  if (newLevels.length === 0) return { ok: false, problem: "CURRENT_LEVEL_REMOVED" };
  const normalized = normalizeClock(state, oldLevels, nowMs);
  const current = oldLevels[normalized.currentLevelIndex] as BlindLevel | undefined;
  const newIndex = current ? newLevels.findIndex((level) => level.id === current.id) : -1;
  if (!current || newIndex === -1) {
    if (normalized.status !== "idle") return { ok: false, problem: "CURRENT_LEVEL_REMOVED" };
    return { ok: true, state: { ...normalized, currentLevelIndex: Math.min(normalized.currentLevelIndex, newLevels.length - 1), pausedRemainingMs: null } };
  }
  // A running clock's time left is not clamped at 0:00: a final level that has held there for 10
  // minutes has been played for 10 minutes more than its length, and lengthening it must count them
  // (P4REV1-R2-02). Paused and idle clocks keep what they hold.
  const remainingMs =
    normalized.status === "running" && normalized.periodEndsAt !== null
      ? normalized.periodEndsAt - nowMs
      : (deriveClock(normalized, oldLevels, nowMs) as DerivedClock).remainingMs;
  const rebased = clamp(remainingMs + levelDurationMs(newLevels[newIndex]) - levelDurationMs(current), 0, CLOCK_LIMITS.maxRemainingMs);
  if (normalized.status === "running") {
    return { ok: true, state: { ...normalized, currentLevelIndex: newIndex, periodEndsAt: nowMs + rebased, pausedRemainingMs: null } };
  }
  const keepsWholeLevel = normalized.status === "idle" && normalized.pausedRemainingMs === null;
  return { ok: true, state: { ...normalized, currentLevelIndex: newIndex, pausedRemainingMs: keepsWholeLevel ? null : rebased } };
}

// ---------------------------------------------------------------------------------------------------
// Chips

export type ChipStacks = Pick<ClockStructure, "startingStack" | "rebuyStack" | "addonStack" | "earlyBirdStack">;

export interface ChipCounts {
  buyIns: number;
  rebuys: number;
  addons: number;
  earlyBirds: number;
}

export interface ChipStats {
  /** buyIns × starting + rebuys × re-buy stack + addons × add-on stack + earlyBirds × early-bird stack. */
  totalChips: number | null;
  /** totalChips / remainingPlayers, rounded to a whole chip. */
  averageStack: number | null;
  /** averageStack in big blinds of `bigBlind`, to one decimal. */
  averageBigBlinds: number | null;
}

/** An average stack in big blinds, to one decimal; null when either is unknown. */
export function bigBlindsOf(stack: number | null, bigBlind: number | null | undefined): number | null {
  if (stack === null || !bigBlind || bigBlind <= 0) return null;
  return Math.round((stack / bigBlind) * 10) / 10;
}

/**
 * The chips in play and the average stack. Unknown (null) when the starting stack is not set, or
 * when anyone took an add-on (or the early-bird bonus) whose stack is not set; a re-buy stack that is
 * not set counts as the starting stack. No average with nobody left.
 */
export function computeChipStats(stacks: ChipStacks, counts: ChipCounts, remainingPlayers: number, bigBlind: number | null): ChipStats {
  const unknown =
    stacks.startingStack === null ||
    (counts.addons > 0 && stacks.addonStack === null) ||
    (counts.earlyBirds > 0 && stacks.earlyBirdStack === null);
  if (unknown || stacks.startingStack === null) return { totalChips: null, averageStack: null, averageBigBlinds: null };
  const totalChips =
    counts.buyIns * stacks.startingStack +
    counts.rebuys * (stacks.rebuyStack ?? stacks.startingStack) +
    counts.addons * (stacks.addonStack ?? 0) +
    counts.earlyBirds * (stacks.earlyBirdStack ?? 0);
  const averageStack = remainingPlayers > 0 ? Math.round(totalChips / remainingPlayers) : null;
  return { totalChips, averageStack, averageBigBlinds: bigBlindsOf(averageStack, bigBlind) };
}
