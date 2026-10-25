import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  anteText,
  applyClockAction,
  bigBlindsOf,
  CLOCK_LIMITS,
  computeChipStats,
  deriveClock,
  effectiveAnte,
  formatBlinds,
  formatChips,
  formatClock,
  INITIAL_CLOCK_STATE,
  levelNumberAt,
  levelTitle,
  msUntilClockMinute,
  normalizeClock,
  normalizeStructure,
  rebaseOnStructureChange,
  structureHash,
  structureProblems,
  undoAvailable,
  type BlindLevel,
  type ClockAction,
  type ClockActionResult,
  type ClockState,
  type ClockStructure,
  type ClockUndo,
  type DerivedClock,
  type PlayLevel,
} from "./clock";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 23, 7, 0, 0);

const level = (id: string, smallBlind: number, bigBlind: number, durationMinutes = 20, ante = 0): PlayLevel => ({
  kind: "level",
  id,
  durationMinutes,
  smallBlind,
  bigBlind,
  ante,
});
const pause = (id: string, durationMinutes = 15, note: string | null = null): BlindLevel => ({ kind: "break", id, durationMinutes, note });

/** 20, 20, 20, break 15, 15, 15. */
const LEVELS: BlindLevel[] = [
  level("l1", 200, 400),
  level("l2", 300, 600),
  level("l3", 400, 800),
  pause("b1", 15, "Last re-buys / add-ons"),
  level("l4", 500, 1000, 15, 1000),
  level("l5", 600, 1200, 15, 1200),
];

const structure = (overrides: Partial<ClockStructure> = {}): ClockStructure => ({
  levels: LEVELS,
  anteMode: "bb_ante",
  startingStack: 80_000,
  rebuyStack: 120_000,
  addonStack: 120_000,
  earlyBirdStack: 25_000,
  ...overrides,
});

const running = (index: number, endsAt: number, startedAt = T0): ClockState => ({
  status: "running",
  currentLevelIndex: index,
  periodEndsAt: endsAt,
  pausedRemainingMs: null,
  startedAt,
});
const held = (status: "idle" | "paused", index: number, remaining: number | null, startedAt: number | null = T0): ClockState => ({
  status,
  currentLevelIndex: index,
  periodEndsAt: null,
  pausedRemainingMs: remaining,
  startedAt,
});

const derive = (state: ClockState, now: number) => deriveClock(state, LEVELS, now) as DerivedClock;

/** The result of an action that must change the clock. */
function changed(result: ClockActionResult) {
  if (!result.ok || !result.changed) throw new Error(`expected a change, got ${JSON.stringify(result)}`);
  return result;
}

describe("structureProblems", () => {
  it("accepts a playable structure", () => {
    expect(structureProblems(LEVELS)).toEqual([]);
  });

  it("refuses duplicate ids, a big blind below the small blind, no play level and too many rows", () => {
    expect(structureProblems([level("a", 100, 200), level("a", 200, 400)])).toEqual([{ path: [1, "id"], message: "Duplicate level id" }]);
    expect(structureProblems([level("a", 300, 200)])).toEqual([{ path: [0, "bigBlind"], message: "The big blind must be at least the small blind" }]);
    expect(structureProblems([pause("b")])).toEqual([{ path: [], message: "Add at least one blind level" }]);
    expect(structureProblems([])).toEqual([{ path: [], message: "Add at least one blind level" }]);
    const tooMany = Array.from({ length: CLOCK_LIMITS.maxLevels + 1 }, (_, i) => level(`l${i}`, 100, 200));
    expect(structureProblems(tooMany).map((problem) => problem.message)).toEqual(["A structure can have at most 100 levels and breaks"]);
  });
});

describe("antes", () => {
  it("are in play only on play levels of a structure that has them", () => {
    expect(effectiveAnte(LEVELS[4], "bb_ante")).toBe(1000);
    expect(effectiveAnte(LEVELS[4], "everyone")).toBe(1000);
    expect(effectiveAnte(LEVELS[4], "none")).toBe(0);
    expect(effectiveAnte(LEVELS[3], "bb_ante")).toBe(0);
  });

  it("are named for the mode", () => {
    expect(anteText(LEVELS[4], "bb_ante")).toBe("BB ante 1,000");
    expect(anteText(LEVELS[4], "everyone")).toBe("Ante 1,000");
    expect(anteText(LEVELS[4], "none")).toBeNull();
    expect(anteText(LEVELS[0], "bb_ante")).toBeNull();
  });

  it("are cleared, and blank notes made null, when a structure is stored", () => {
    const stored = normalizeStructure(structure({ anteMode: "none", levels: [level("l1", 100, 200, 20, 200), pause("b1", 10, "   ")] }));
    expect(stored.levels).toEqual([level("l1", 100, 200, 20, 0), pause("b1", 10, null)]);
    const kept = normalizeStructure(structure({ levels: [level("l1", 100, 200, 20, 200), pause("b1", 10, "  Colour up ")] }));
    expect(kept.levels).toEqual([level("l1", 100, 200, 20, 200), pause("b1", 10, "Colour up")]);
  });
});

describe("structureHash", () => {
  it("is 8 hex digits, the same whatever order the keys come back in", () => {
    const hash = structureHash(structure());
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    const reordered = LEVELS.map((row) => Object.fromEntries(Object.entries(row).reverse()) as BlindLevel);
    expect(structureHash(structure({ levels: reordered }))).toBe(hash);
  });

  it("changes with any level, the ante mode or a stack", () => {
    const hash = structureHash(structure());
    expect(structureHash(structure({ levels: [...LEVELS.slice(0, 5), level("l5", 600, 1200, 15, 1100)] }))).not.toBe(hash);
    expect(structureHash(structure({ anteMode: "everyone" }))).not.toBe(hash);
    expect(structureHash(structure({ earlyBirdStack: 20_000 }))).not.toBe(hash);
    expect(structureHash(structure({ rebuyStack: null }))).not.toBe(hash);
  });
});

describe("level helpers", () => {
  it("number play levels, skipping breaks", () => {
    expect(LEVELS.map((_, i) => levelNumberAt(LEVELS, i))).toEqual([1, 2, 3, null, 4, 5]);
    expect(levelNumberAt(LEVELS, 99)).toBeNull();
  });

  it("name a level the way the activity feed does", () => {
    expect(levelTitle(LEVELS, 1)).toBe("Level 2 (300/600)");
    expect(levelTitle(LEVELS, 3)).toBe("Break (15 min)");
    expect(levelTitle(LEVELS, 40)).toBe("the end of the structure");
  });
});

describe("formatting", () => {
  it("groups chips without a locale", () => {
    expect(formatChips(0)).toBe("0");
    expect(formatChips(999)).toBe("999");
    expect(formatChips(1000)).toBe("1,000");
    expect(formatChips(1234567)).toBe("1,234,567");
    expect(formatChips(-25000)).toBe("-25,000");
    expect(formatBlinds(level("x", 25_000, 50_000))).toBe("25,000/50,000");
  });

  it("shows whole seconds rounded up, and hours past one", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5000)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(1)).toBe("0:01");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(245_000)).toBe("4:05");
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});

describe("normalizeClock", () => {
  it("clamps the level into the structure", () => {
    expect(normalizeClock(held("idle", 9, null), LEVELS, T0).currentLevelIndex).toBe(5);
    expect(normalizeClock(held("idle", -2, null), LEVELS, T0).currentLevelIndex).toBe(0);
    expect(normalizeClock(held("idle", 3, null), [], T0).currentLevelIndex).toBe(0);
  });

  it("moves a running clock on through every level and break whose time has passed", () => {
    const state = running(0, T0 + 20 * MIN);
    // 20 + 20 + 20 + 15 (break) = 75 minutes in, plus 5: level 4 (index 4) with 10 minutes left.
    const later = normalizeClock(state, LEVELS, T0 + 80 * MIN);
    expect(later).toEqual({ ...state, currentLevelIndex: 4, periodEndsAt: T0 + 90 * MIN });
  });

  it("holds a running clock at the final level", () => {
    const later = normalizeClock(running(0, T0 + 20 * MIN), LEVELS, T0 + 600 * MIN);
    expect(later.currentLevelIndex).toBe(5);
    expect(later.periodEndsAt).toBe(T0 + 105 * MIN);
  });
});

describe("deriveClock", () => {
  it("is null without levels", () => {
    expect(deriveClock(INITIAL_CLOCK_STATE, [], T0)).toBeNull();
  });

  it("shows a fresh clock at level 1 with the whole level to play", () => {
    const derived = derive(INITIAL_CLOCK_STATE, T0);
    expect(derived).toMatchObject({
      status: "idle",
      levelIndex: 0,
      levelNumber: 1,
      playLevelCount: 5,
      isBreak: false,
      remainingMs: 20 * MIN,
      durationMs: 20 * MIN,
      elapsedInLevelMs: 0,
      elapsedClockMs: 0,
      msUntilNextBreak: 60 * MIN,
      isFinalLevel: false,
      overtime: false,
    });
    expect(derived.currentPlayLevel).toBe(LEVELS[0]);
    expect(derived.next).toBe(LEVELS[1]);
    expect(derived.nextPlayLevel).toBe(LEVELS[1]);
  });

  it("counts a running clock down, through breaks, with the time to the next break", () => {
    const state = running(0, T0 + 20 * MIN);
    expect(derive(state, T0 + 50 * MIN)).toMatchObject({
      levelIndex: 2,
      remainingMs: 10 * MIN,
      elapsedInLevelMs: 10 * MIN,
      elapsedClockMs: 50 * MIN,
      msUntilNextBreak: 10 * MIN,
    });
    const onBreak = derive(state, T0 + 65 * MIN);
    expect(onBreak).toMatchObject({ levelIndex: 3, isBreak: true, levelNumber: null, remainingMs: 10 * MIN, msUntilNextBreak: null, currentPlayLevel: null });
    expect(onBreak.nextPlayLevel).toBe(LEVELS[4]);
  });

  it("has no next break after the last one", () => {
    expect(derive(running(4, T0 + 90 * MIN), T0 + 80 * MIN).msUntilNextBreak).toBeNull();
  });

  it("holds at 0:00 on the final level (overtime)", () => {
    const derived = derive(running(5, T0 + 15 * MIN), T0 + 30 * MIN);
    expect(derived).toMatchObject({ levelIndex: 5, remainingMs: 0, isFinalLevel: true, overtime: true, next: null, nextPlayLevel: null });
  });

  it("keeps a paused clock still however long it waits", () => {
    const state = held("paused", 2, 7 * MIN);
    expect(derive(state, T0).remainingMs).toBe(7 * MIN);
    expect(derive(state, T0 + 600 * MIN).remainingMs).toBe(7 * MIN);
    expect(derive(state, T0).elapsedClockMs).toBe(53 * MIN);
  });

  it("shows a finished clock with no time left", () => {
    expect(derive({ ...held("paused", 1, 5 * MIN), status: "finished" }, T0).remainingMs).toBe(0);
  });

  it("never shows negative time added beyond the level as elapsed", () => {
    expect(derive(held("paused", 0, 25 * MIN), T0).elapsedInLevelMs).toBe(0);
  });
});

describe("msUntilClockMinute", () => {
  it("counts down to a re-buy period, then stays at 0", () => {
    expect(msUntilClockMinute({ elapsedClockMs: 50 * MIN }, 75)).toBe(25 * MIN);
    expect(msUntilClockMinute({ elapsedClockMs: 80 * MIN }, 75)).toBe(0);
    expect(msUntilClockMinute({ elapsedClockMs: 0 }, null)).toBeNull();
    expect(msUntilClockMinute({ elapsedClockMs: 0 }, undefined)).toBeNull();
  });
});

describe("applyClockAction", () => {
  const act = (state: ClockState, action: ClockAction, now = T0, undo: ClockUndo | null = null) => applyClockAction(LEVELS, state, undo, action, now);

  it("refuses everything on a clock with no levels", () => {
    expect(applyClockAction([], INITIAL_CLOCK_STATE, null, { action: "start" }, T0)).toMatchObject({ ok: false, problem: "NO_LEVELS" });
  });

  describe("start, pause, resume and toggle", () => {
    it("starts at level 1, stamps the start, logs it and keeps the old state for undo", () => {
      const result = changed(act(INITIAL_CLOCK_STATE, { action: "start", alsoStartTournament: true }));
      expect(result.state).toEqual(running(0, T0 + 20 * MIN, T0));
      expect(result.undo).toEqual({
        state: INITIAL_CLOCK_STATE,
        change: { action: "start", description: "Clock started at Level 1 (200/400)" },
        redo: false,
        at: T0,
        levelIndex: 0,
        // Stamped by the server, which alone knows whether the tournament really started.
        startedTournamentFrom: null,
      });
      expect(result.startTournament).toBe(true);
      expect(result.restoreTournamentStatus).toBeNull();
      expect(result.log).toEqual({
        eventType: "clock_started",
        description: "Clock started at Level 1 (200/400)",
        data: { action: "start", fromLevelIndex: 0, toLevelIndex: 0, remainingMs: 20 * MIN },
      });
      expect(changed(act(INITIAL_CLOCK_STATE, { action: "start" })).startTournament).toBe(false);
    });

    it("is idempotent: start or resume while running, pause while not running", () => {
      const state = running(0, T0 + 20 * MIN);
      expect(act(state, { action: "start" })).toEqual({ ok: true, changed: false });
      expect(act(state, { action: "resume" })).toEqual({ ok: true, changed: false });
      expect(act(held("paused", 0, MIN), { action: "pause" })).toEqual({ ok: true, changed: false });
      expect(act(INITIAL_CLOCK_STATE, { action: "pause" })).toEqual({ ok: true, changed: false });
    });

    it("pauses with the time left, and resumes from it without losing the start", () => {
      const paused = changed(act(running(1, T0 + 12 * MIN, T0 - 30 * MIN), { action: "pause" }));
      expect(paused.state).toEqual(held("paused", 1, 12 * MIN, T0 - 30 * MIN));
      expect(paused.log.description).toBe("Clock paused at 12:00 in Level 2 (300/600)");
      const resumed = changed(act(paused.state, { action: "resume" }, T0 + 60 * MIN));
      expect(resumed.state).toEqual(running(1, T0 + 72 * MIN, T0 - 30 * MIN));
      expect(resumed.log).toMatchObject({ eventType: "clock_resumed", description: "Clock resumed at Level 2 (300/600), 12:00 left" });
    });

    it("toggles by what the device saw, ignoring a stale tap", () => {
      const state = running(0, T0 + 20 * MIN);
      expect(act(state, { action: "toggle", expectedStatus: "paused" })).toEqual({ ok: true, changed: false });
      expect(changed(act(state, { action: "toggle", expectedStatus: "running" })).state.status).toBe("paused");
      expect(changed(act(state, { action: "toggle" })).state.status).toBe("paused");
      const started = changed(act(INITIAL_CLOCK_STATE, { action: "toggle", expectedStatus: "idle", alsoStartTournament: true }));
      expect(started.state.status).toBe("running");
      expect(started.startTournament).toBe(true);
      expect(changed(act(held("paused", 2, MIN), { action: "toggle", expectedStatus: "paused" })).log.eventType).toBe("clock_resumed");
    });
  });

  describe("next, prev and jump", () => {
    it("move a running clock to the whole of the next level", () => {
      const result = changed(act(running(0, T0 + 5 * MIN), { action: "next", expectedLevelIndex: 0 }));
      expect(result.state).toEqual(running(1, T0 + 20 * MIN));
      expect(result.log).toEqual({
        eventType: "clock_level_changed",
        description: "Moved to Level 2 (300/600)",
        data: { action: "next", fromLevelIndex: 0, toLevelIndex: 1, remainingMs: 20 * MIN },
      });
    });

    it("keep a paused clock paused, and an idle one idle with the whole level", () => {
      expect(changed(act(held("paused", 2, MIN), { action: "next" })).state).toEqual(held("paused", 3, 15 * MIN));
      expect(changed(act(held("idle", 1, 4 * MIN, null), { action: "prev" })).state).toEqual(held("idle", 0, null, null));
      expect(changed(act(held("paused", 2, MIN), { action: "next" })).log.description).toBe("Moved to Break (15 min)");
    });

    it("refuse a level the clock has already left (a double tap never skips a level)", () => {
      const state = running(0, T0 + 20 * MIN);
      const first = changed(act(state, { action: "next", expectedLevelIndex: 0 }));
      expect(act(first.state, { action: "next", expectedLevelIndex: 0 })).toMatchObject({ ok: false, problem: "LEVEL_CHANGED" });
      // Auto-advance counts: 25 minutes in, the clock is on level 2 even though the stored index says 1.
      expect(act(state, { action: "next", expectedLevelIndex: 0 }, T0 + 25 * MIN)).toMatchObject({ ok: false, problem: "LEVEL_CHANGED" });
      expect(changed(act(state, { action: "next", expectedLevelIndex: 1 }, T0 + 25 * MIN)).state.currentLevelIndex).toBe(2);
    });

    it("say why they cannot go past either end, rather than silently doing nothing (TDN3-NEXT-FINAL-SILENT)", () => {
      expect(act(INITIAL_CLOCK_STATE, { action: "prev" })).toEqual({
        ok: false,
        problem: "NO_PREVIOUS_LEVEL",
        message: "This is the first level: there is no level before it",
      });
      expect(act(held("paused", 5, MIN), { action: "next" })).toEqual({
        ok: false,
        problem: "NO_NEXT_LEVEL",
        message: "This is the final level: add levels to the structure to go on",
      });
      // The structure ran out: a running clock holds the final level at 0:00, and Next says so.
      expect(act(running(5, T0 + MIN), { action: "next", expectedLevelIndex: 5 }, T0 + 60 * MIN)).toMatchObject({ ok: false, problem: "NO_NEXT_LEVEL" });
      // A double tap is still judged against the level it saw first.
      expect(act(held("paused", 5, MIN), { action: "next", expectedLevelIndex: 4 })).toMatchObject({ ok: false, problem: "LEVEL_CHANGED" });
    });

    it("jump to a level, refusing one past the end", () => {
      expect(changed(act(running(0, T0 + MIN), { action: "jump", levelIndex: 4 })).state).toEqual(running(4, T0 + 15 * MIN));
      expect(act(running(0, T0 + MIN), { action: "jump", levelIndex: 0 })).toEqual({ ok: true, changed: false });
      expect(act(running(0, T0 + MIN), { action: "jump", levelIndex: 6 })).toMatchObject({ ok: false, problem: "LEVEL_OUT_OF_RANGE" });
      expect(act(running(0, T0 + MIN), { action: "jump", levelIndex: 2, expectedLevelIndex: 1 })).toMatchObject({ ok: false, problem: "LEVEL_CHANGED" });
    });
  });

  describe("adjust and set_remaining", () => {
    it("add and take time, within 0 and the 4-hour limit", () => {
      const state = running(0, T0 + 10 * MIN);
      const added = changed(act(state, { action: "adjust", deltaSeconds: 60, expectedLevelIndex: 0 }));
      expect(added.state).toEqual(running(0, T0 + 11 * MIN));
      expect(added.log).toMatchObject({ eventType: "clock_time_adjusted", description: "Added 1:00 to Level 1 (200/400)" });
      const taken = changed(act(state, { action: "adjust", deltaSeconds: -90 }));
      expect(taken.state.periodEndsAt).toBe(T0 + 8.5 * MIN);
      expect(taken.log.description).toBe("Took 1:30 off Level 1 (200/400)");
      expect(changed(act(state, { action: "adjust", deltaSeconds: -3600 })).state.periodEndsAt).toBe(T0);
      const long = changed(act(held("paused", 0, CLOCK_LIMITS.maxRemainingMs - MIN), { action: "adjust", deltaSeconds: 3600 }));
      expect(long.state.pausedRemainingMs).toBe(CLOCK_LIMITS.maxRemainingMs);
    });

    it("let a running clock taken to 0:00 move straight on", () => {
      const result = changed(act(running(0, T0 + 30_000), { action: "adjust", deltaSeconds: -60 }));
      expect(derive(result.state, T0).levelIndex).toBe(1);
    });

    it("keep a paused or idle clock as it is", () => {
      expect(changed(act(held("paused", 2, 5 * MIN), { action: "adjust", deltaSeconds: 120 })).state).toEqual(held("paused", 2, 7 * MIN));
      expect(changed(act(INITIAL_CLOCK_STATE, { action: "adjust", deltaSeconds: -300 })).state).toEqual(held("idle", 0, 15 * MIN, null));
    });

    it("set the time left", () => {
      const result = changed(act(running(1, T0 + 3 * MIN), { action: "set_remaining", remainingSeconds: 720, expectedLevelIndex: 1 }));
      expect(result.state).toEqual(running(1, T0 + 12 * MIN));
      expect(result.log.description).toBe("Clock set to 12:00 in Level 2 (300/600)");
      expect(act(running(1, T0 + 3 * MIN), { action: "set_remaining", remainingSeconds: 60, expectedLevelIndex: 0 })).toMatchObject({
        ok: false,
        problem: "LEVEL_CHANGED",
      });
      expect(act(running(1, T0 + 3 * MIN), { action: "adjust", deltaSeconds: 60, expectedLevelIndex: 0 })).toMatchObject({ ok: false, problem: "LEVEL_CHANGED" });
    });
  });

  it("resets to an unstarted level 1", () => {
    const result = changed(act(running(4, T0 + MIN), { action: "reset" }));
    expect(result.state).toEqual(INITIAL_CLOCK_STATE);
    expect(result.log).toMatchObject({ eventType: "clock_reset", description: "Clock reset to Level 1 (200/400)" });
    expect(changed(act(result.state, { action: "start" })).log.eventType).toBe("clock_started");
  });

  it("changes nothing when reset again, so the undo back to the old position survives (P4REV1-CC-04)", () => {
    const reset = changed(act(running(4, T0 + MIN, T0 - 90 * MIN), { action: "reset" }));
    expect(act(reset.state, { action: "reset" }, T0 + 1_000, reset.undo)).toEqual({ ok: true, changed: false });
    expect(act(INITIAL_CLOCK_STATE, { action: "reset" })).toEqual({ ok: true, changed: false });
    // Not the initial state: idle on another level, or with time taken off level 1.
    expect(changed(act(held("idle", 2, null, null), { action: "reset" })).state).toEqual(INITIAL_CLOCK_STATE);
    expect(changed(act(held("idle", 0, 5 * MIN, null), { action: "reset" })).state).toEqual(INITIAL_CLOCK_STATE);
  });

  it("refuses every action, undo included, once the tournament is finished", () => {
    const finished: ClockState = { ...held("paused", 2, 0), status: "finished" };
    const undo: ClockUndo = {
      state: running(2, T0 + MIN),
      change: { action: "pause", description: "Clock paused" },
      redo: false,
      at: T0,
      levelIndex: 2,
      startedTournamentFrom: null,
    };
    for (const action of [
      { action: "start" },
      { action: "pause" },
      { action: "toggle" },
      { action: "next" },
      { action: "adjust", deltaSeconds: 60 },
      { action: "reset" },
      { action: "undo" },
    ] as ClockAction[]) {
      expect(act(finished, action, T0, undo)).toMatchObject({ ok: false, problem: "CLOCK_FINISHED" });
    }
  });

  describe("undo", () => {
    it("takes the last change back, and a second undo redoes it", () => {
      const before = running(1, T0 + 9 * MIN);
      const moved = changed(act(before, { action: "next", expectedLevelIndex: 1 }));
      const undone = changed(act(moved.state, { action: "undo" }, T0 + 5_000, moved.undo));
      expect(undone.state).toEqual(before);
      expect(undone.startTournament).toBe(false);
      expect(undone.log).toEqual({
        eventType: "clock_undone",
        description: "Undid: Moved to Level 3 (400/800)",
        data: { action: "undo", fromLevelIndex: 2, toLevelIndex: 1, remainingMs: null },
      });
      expect(undone.undo).toEqual({
        state: { ...moved.state, periodEndsAt: T0 + 20 * MIN },
        change: { action: "next", description: "Moved to Level 3 (400/800)" },
        redo: true,
        at: T0 + 5_000,
        levelIndex: 1,
        startedTournamentFrom: null,
      });

      const redone = changed(act(undone.state, { action: "undo" }, T0 + 9_000, undone.undo));
      expect(redone.state).toEqual(moved.state);
      expect(redone.log.description).toBe("Redid: Moved to Level 3 (400/800)");
      expect(redone.undo).toMatchObject({ redo: false, at: T0 + 9_000, levelIndex: 2 });
      expect(changed(act(redone.state, { action: "undo" }, T0 + 10_000, redone.undo)).state).toEqual(before);
    });

    it("takes the undo the device showed: a second tap or another device never redoes it (P4REV1-CC-01)", () => {
      const before = running(1, T0 + 9 * MIN);
      const paused = changed(act(before, { action: "pause" }));
      const seen = { at: paused.undo.at, redo: paused.undo.redo };
      const undone = changed(act(paused.state, { action: "undo", expectedUndo: seen }, T0 + 2_000, paused.undo));
      expect(undone.state).toEqual(running(1, T0 + 2_000 + 9 * MIN));
      // The second tap still names the pause's undo; the stored one is now the redo.
      expect(act(undone.state, { action: "undo", expectedUndo: seen }, T0 + 2_500, undone.undo)).toEqual({ ok: true, changed: false });
      // Even when the undo came in the same millisecond as the change.
      const sameMs = changed(act(paused.state, { action: "undo", expectedUndo: seen }, T0, paused.undo));
      expect(act(sameMs.state, { action: "undo", expectedUndo: seen }, T0, sameMs.undo)).toEqual({ ok: true, changed: false });
      // A device that saw the redo may redo.
      const redo = { at: undone.undo.at, redo: true };
      expect(changed(act(undone.state, { action: "undo", expectedUndo: redo }, T0 + 3_000, undone.undo)).state.status).toBe("paused");
      // A newer change replaced the one the device showed.
      const moved = changed(act(paused.state, { action: "next", expectedLevelIndex: 1 }, T0 + 1_000, paused.undo));
      expect(act(moved.state, { action: "undo", expectedUndo: seen }, T0 + 2_000, moved.undo)).toEqual({ ok: true, changed: false });
      // Nothing stored at all is still a refusal.
      expect(act(before, { action: "undo", expectedUndo: seen })).toMatchObject({ ok: false, problem: "NOTHING_TO_UNDO" });
    });

    it("puts the tournament back when it takes back a start that started it, and starts it again on redo (TDN2-UNDO-START-STATUS)", () => {
      const started = changed(act(INITIAL_CLOCK_STATE, { action: "start", alsoStartTournament: true }));
      // As the server stores it once the start moved the tournament on from registration.
      const stored: ClockUndo = { ...started.undo, startedTournamentFrom: "registration" };
      const undone = changed(act(started.state, { action: "undo" }, T0 + 10_000, stored));
      expect(undone.state).toEqual(INITIAL_CLOCK_STATE);
      expect(undone.restoreTournamentStatus).toBe("registration");
      expect(undone.startTournament).toBe(false);
      expect(undone.undo).toMatchObject({ redo: true, startedTournamentFrom: "registration" });

      const redone = changed(act(undone.state, { action: "undo" }, T0 + 20_000, undone.undo));
      expect(redone.state.status).toBe("running");
      expect(redone.startTournament).toBe(true);
      expect(redone.restoreTournamentStatus).toBeNull();

      // A start that did not start the tournament (already under way) leaves its status alone.
      const plain = changed(act(started.state, { action: "undo" }, T0 + 10_000, started.undo));
      expect(plain).toMatchObject({ startTournament: false, restoreTournamentStatus: null });
    });

    it("refuses with nothing stored", () => {
      expect(act(running(1, T0 + MIN), { action: "undo" })).toEqual({ ok: false, problem: "NOTHING_TO_UNDO", message: "There is no clock change to undo" });
    });

    it("lapses two minutes after the change", () => {
      const paused = changed(act(running(1, T0 + 12 * MIN), { action: "pause" }));
      expect(act(paused.state, { action: "undo" }, T0 + CLOCK_LIMITS.undoWindowMs, paused.undo)).toMatchObject({ ok: true, changed: true });
      expect(act(paused.state, { action: "undo" }, T0 + CLOCK_LIMITS.undoWindowMs + 1, paused.undo)).toEqual({
        ok: false,
        problem: "NOTHING_TO_UNDO",
        message: "Too late to undo: a clock change can be undone for 2 minutes, and only until the clock moves to the next level by itself",
      });
    });

    it("lapses once the clock moves to the next level by itself (the room would go back to blinds it has played)", () => {
      // Set to 0:02, then Level 2 starts by itself: an undo would put Level 1 back with 19:56 left.
      const set = changed(act(running(0, T0 + 4 * MIN), { action: "set_remaining", remainingSeconds: 2, expectedLevelIndex: 0 }));
      expect(act(set.state, { action: "undo" }, T0 + 1_000, set.undo)).toMatchObject({ ok: true, changed: true });
      expect(act(set.state, { action: "undo" }, T0 + 3_000, set.undo)).toMatchObject({ ok: false, problem: "NOTHING_TO_UNDO" });
    });

    it("counts a running clock set to 0:00 as already on the next level", () => {
      const set = changed(act(running(0, T0 + 4 * MIN), { action: "set_remaining", remainingSeconds: 0, expectedLevelIndex: 0 }));
      expect(set.undo.levelIndex).toBe(1);
      expect(changed(act(set.state, { action: "undo" }, T0 + 30_000, set.undo)).state).toEqual(running(0, T0 + 4 * MIN));
    });

    it("after a pause, runs on from the time left at the pause: time stood still is not played (P4REV1-02)", () => {
      const paused = changed(act(running(1, T0 + 12 * MIN), { action: "pause" }));
      const undone = changed(act(paused.state, { action: "undo" }, T0 + 90_000, paused.undo));
      expect(undone.state).toEqual(running(1, T0 + 90_000 + 12 * MIN));
      expect(derive(undone.state, T0 + 90_000)).toMatchObject({ levelIndex: 1, remainingMs: 12 * MIN });
    });

    it("after a reset, puts the clock back where it was, running on from the time it had left", () => {
      const before = running(1, T0 + 7 * MIN, T0 - 33 * MIN);
      const reset = changed(act(before, { action: "reset" }));
      const undone = changed(act(reset.state, { action: "undo" }, T0 + 60_000, reset.undo));
      expect(undone.state).toEqual(running(1, T0 + 60_000 + 7 * MIN, T0 - 33 * MIN));
    });

    it("keeps the snapshot's own end when the clock ran on through the change (+1 min, next)", () => {
      const before = running(1, T0 + 9 * MIN);
      const added = changed(act(before, { action: "adjust", deltaSeconds: 60, expectedLevelIndex: 1 }));
      expect(changed(act(added.state, { action: "undo" }, T0 + 30_000, added.undo)).state).toEqual(before);
    });

    it("puts a paused or idle clock back as it was, whatever the time since", () => {
      const pausedAt = held("paused", 1, 9 * MIN);
      const resumed = changed(act(pausedAt, { action: "resume" }));
      expect(changed(act(resumed.state, { action: "undo" }, T0 + 100_000, resumed.undo)).state).toEqual(pausedAt);
    });
  });

  it("says whether an undo is still usable on a level at a time", () => {
    const undo = { at: T0, levelIndex: 2 };
    expect(undoAvailable(undo, 2, T0 + CLOCK_LIMITS.undoWindowMs)).toBe(true);
    expect(undoAvailable(undo, 2, T0 + CLOCK_LIMITS.undoWindowMs + 1)).toBe(false);
    expect(undoAvailable(undo, 3, T0)).toBe(false);
    expect(undoAvailable(null, 2, T0)).toBe(false);
  });

  describe("properties", () => {
    const actionArb: fc.Arbitrary<ClockAction> = fc.oneof(
      fc.constant<ClockAction>({ action: "start" }),
      fc.constant<ClockAction>({ action: "pause" }),
      fc.constant<ClockAction>({ action: "resume" }),
      fc.record({ action: fc.constant("toggle" as const), expectedStatus: fc.constantFrom("idle" as const, "running" as const, "paused" as const) }),
      fc.record({ action: fc.constantFrom("next" as const, "prev" as const), expectedLevelIndex: fc.integer({ min: 0, max: 6 }) }),
      fc.record({ action: fc.constant("jump" as const), levelIndex: fc.integer({ min: 0, max: 7 }) }),
      fc.record({ action: fc.constant("adjust" as const), deltaSeconds: fc.integer({ min: -3600, max: 3600 }).filter((n) => n !== 0) }),
      fc.record({ action: fc.constant("set_remaining" as const), remainingSeconds: fc.integer({ min: 0, max: 14_400 }) }),
      fc.constant<ClockAction>({ action: "reset" }),
      fc.constant<ClockAction>({ action: "undo" }),
    );

    it("always leave stored anchors the database accepts, and a clock every screen can show", () => {
      fc.assert(
        fc.property(fc.array(fc.tuple(actionArb, fc.integer({ min: 0, max: 40 * MIN })), { maxLength: 40 }), (steps) => {
          let state: ClockState = { ...INITIAL_CLOCK_STATE };
          let undo: ClockUndo | null = null;
          let now = T0;
          for (const [action, wait] of steps) {
            now += wait;
            const result = applyClockAction(LEVELS, state, undo, action, now);
            if (result.ok && result.changed) {
              state = result.state;
              undo = result.undo;
            }
            // The CHECK constraints of tournament_clocks.
            expect((state.status === "running") === (state.periodEndsAt !== null)).toBe(true);
            expect(state.currentLevelIndex).toBeGreaterThanOrEqual(0);
            expect(state.pausedRemainingMs === null || state.pausedRemainingMs >= 0).toBe(true);
            const derived = derive(state, now);
            expect(derived.levelIndex).toBeLessThan(LEVELS.length);
            expect(derived.remainingMs).toBeGreaterThanOrEqual(0);
            expect(derived.remainingMs).toBeLessThanOrEqual(CLOCK_LIMITS.maxRemainingMs);
          }
        }),
      );
    });

    it("never let the same Undo tap change the clock twice", () => {
      fc.assert(
        fc.property(actionArb.filter((action) => action.action !== "undo"), fc.integer({ min: 0, max: 30 * MIN }), fc.integer({ min: 0, max: 60_000 }), (action, wait, gap) => {
          const first = applyClockAction(LEVELS, running(1, T0 + 9 * MIN), null, action, T0 + wait);
          if (!first.ok || !first.changed) return;
          const tap = { action: "undo" as const, expectedUndo: { at: first.undo.at, redo: first.undo.redo } };
          const undone = applyClockAction(LEVELS, first.state, first.undo, tap, T0 + wait + gap);
          if (!undone.ok || !undone.changed) return;
          expect(applyClockAction(LEVELS, undone.state, undone.undo, tap, T0 + wait + gap + 300)).toEqual({ ok: true, changed: false });
        }),
      );
    });

    it("never let the same tap move the clock twice", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), fc.constantFrom("next" as const, "prev" as const), fc.integer({ min: 0, max: 200 * MIN }), (index, action, wait) => {
          const state = running(index, T0 + levelsMs(index));
          const now = T0 + wait;
          const seen = derive(state, now).levelIndex;
          const first = applyClockAction(LEVELS, state, null, { action, expectedLevelIndex: seen }, now);
          if (!first.ok || !first.changed) return;
          const second = applyClockAction(LEVELS, first.state, first.undo, { action, expectedLevelIndex: seen }, now);
          expect(second).toMatchObject({ ok: false, problem: "LEVEL_CHANGED" });
        }),
      );
    });
  });
});

function levelsMs(index: number): number {
  return (LEVELS[index]?.durationMinutes ?? 0) * MIN;
}

describe("rebaseOnStructureChange", () => {
  it("stays on the same level when rows are inserted before it, keeping its time", () => {
    const state = running(1, T0 + 8 * MIN);
    const inserted = [level("l0", 100, 200), ...LEVELS];
    expect(rebaseOnStructureChange(LEVELS, inserted, state, T0)).toEqual({ ok: true, state: running(2, T0 + 8 * MIN) });
  });

  it("keeps the time played when the current level gets longer or shorter", () => {
    const longer = LEVELS.map((row) => (row.id === "l2" ? { ...row, durationMinutes: 30 } : row));
    // 12 of 20 minutes played, 8 left: at 30 minutes, 18 left.
    expect(rebaseOnStructureChange(LEVELS, longer, running(1, T0 + 8 * MIN), T0)).toEqual({ ok: true, state: running(1, T0 + 18 * MIN) });
    const shorter = LEVELS.map((row) => (row.id === "l2" ? { ...row, durationMinutes: 10 } : row));
    expect(rebaseOnStructureChange(LEVELS, shorter, held("paused", 1, 8 * MIN), T0)).toEqual({ ok: true, state: held("paused", 1, 0) });
  });

  it("keeps an untouched idle clock on its whole level", () => {
    const changedFirst = [{ ...LEVELS[0], durationMinutes: 25 }, ...LEVELS.slice(1)];
    expect(rebaseOnStructureChange(LEVELS, changedFirst, INITIAL_CLOCK_STATE, T0)).toEqual({ ok: true, state: INITIAL_CLOCK_STATE });
    expect(rebaseOnStructureChange(LEVELS, changedFirst, held("idle", 0, 5 * MIN, null), T0)).toEqual({ ok: true, state: held("idle", 0, 10 * MIN, null) });
  });

  it("refuses to delete the level a running or paused clock is on", () => {
    const without = LEVELS.filter((row) => row.id !== "l2");
    expect(rebaseOnStructureChange(LEVELS, without, running(1, T0 + MIN), T0)).toEqual({ ok: false, problem: "CURRENT_LEVEL_REMOVED" });
    expect(rebaseOnStructureChange(LEVELS, without, held("paused", 1, MIN), T0)).toEqual({ ok: false, problem: "CURRENT_LEVEL_REMOVED" });
    expect(rebaseOnStructureChange(LEVELS, [], held("idle", 1, MIN), T0)).toEqual({ ok: false, problem: "CURRENT_LEVEL_REMOVED" });
  });

  it("lets an idle clock's level go, staying at the same position from its start", () => {
    const without = LEVELS.filter((row) => row.id !== "l5");
    expect(rebaseOnStructureChange(LEVELS, without, held("idle", 5, MIN, null), T0)).toEqual({ ok: true, state: held("idle", 4, null, null) });
    expect(rebaseOnStructureChange([], LEVELS, INITIAL_CLOCK_STATE, T0)).toEqual({ ok: true, state: INITIAL_CLOCK_STATE });
  });

  it("finds the level the running clock has really reached", () => {
    // Stored on level 1 but 25 minutes in: it is on level 2 (l2) with 15 minutes left.
    const inserted = [level("l0", 100, 200), ...LEVELS];
    expect(rebaseOnStructureChange(LEVELS, inserted, running(0, T0 + 20 * MIN), T0 + 25 * MIN)).toEqual({
      ok: true,
      state: running(2, T0 + 40 * MIN),
    });
  });
});

describe("chip figures", () => {
  const stacks = { startingStack: 80_000, rebuyStack: 120_000, addonStack: 120_000, earlyBirdStack: 25_000 };

  it("count every stack sold or earned, Central Stars' way", () => {
    // 30 × 80,000 + 10 × 120,000 + 5 × 120,000 + 20 × 25,000 = 4,700,000; 25 left: 188,000 = 94 big blinds of 2,000.
    expect(computeChipStats(stacks, { buyIns: 30, rebuys: 10, addons: 5, earlyBirds: 20 }, 25, 2_000)).toEqual({
      totalChips: 4_700_000,
      averageStack: 188_000,
      averageBigBlinds: 94,
    });
  });

  it("count a re-buy as a starting stack when its stack is not set", () => {
    expect(computeChipStats({ ...stacks, rebuyStack: null }, { buyIns: 2, rebuys: 1, addons: 0, earlyBirds: 0 }, 3, null).totalChips).toBe(240_000);
  });

  it("are unknown when a stack someone has is not set", () => {
    const unknown = { totalChips: null, averageStack: null, averageBigBlinds: null };
    expect(computeChipStats({ ...stacks, startingStack: null }, { buyIns: 2, rebuys: 0, addons: 0, earlyBirds: 0 }, 2, 400)).toEqual(unknown);
    expect(computeChipStats({ ...stacks, addonStack: null }, { buyIns: 2, rebuys: 0, addons: 1, earlyBirds: 0 }, 2, 400)).toEqual(unknown);
    expect(computeChipStats({ ...stacks, earlyBirdStack: null }, { buyIns: 2, rebuys: 0, addons: 0, earlyBirds: 1 }, 2, 400)).toEqual(unknown);
    // Not needed: nobody took one.
    expect(computeChipStats({ ...stacks, addonStack: null, earlyBirdStack: null }, { buyIns: 2, rebuys: 0, addons: 0, earlyBirds: 0 }, 2, 400).totalChips).toBe(160_000);
  });

  it("have no average with nobody left", () => {
    expect(computeChipStats(stacks, { buyIns: 2, rebuys: 0, addons: 0, earlyBirds: 0 }, 0, 400)).toEqual({ totalChips: 160_000, averageStack: null, averageBigBlinds: null });
  });

  it("give big blinds to one decimal", () => {
    expect(bigBlindsOf(100_000, 3_000)).toBe(33.3);
    expect(bigBlindsOf(null, 3_000)).toBeNull();
    expect(bigBlindsOf(100_000, 0)).toBeNull();
    expect(bigBlindsOf(100_000, undefined)).toBeNull();
  });
});
