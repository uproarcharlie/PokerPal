/**
 * Tournament clocks for the clock tests (import by path: the factories' index is frozen). The row is
 * written as the server stores it: the structure normalized, times as timestamptz, the anchors of a
 * ClockState given in epoch ms.
 */
import { INITIAL_CLOCK_STATE, normalizeStructure, type BlindLevel, type ClockState, type ClockStructure, type ClockUndo } from "@shared/domain/clock";
import type { ClockDisplaySettings } from "@shared/api/clock";
import { tournamentClocks, type TournamentClock } from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { clockStateColumns, clockStructureColumns } from "../../server/repositories/clock";

export const MINUTE_MS = 60_000;

/**
 * A short structure: two 20-minute levels, a 15-minute break, two 15-minute levels with a big-blind
 * ante. Indexes: 0 = Level 1 (100/200), 1 = Level 2 (200/400), 2 = the break, 3 = Level 3 (300/600),
 * 4 = Level 4 (400/800).
 */
export const TEST_LEVELS: readonly BlindLevel[] = [
  { kind: "level", id: "l1", durationMinutes: 20, smallBlind: 100, bigBlind: 200, ante: 0 },
  { kind: "level", id: "l2", durationMinutes: 20, smallBlind: 200, bigBlind: 400, ante: 0 },
  { kind: "break", id: "b1", durationMinutes: 15, note: "Colour up" },
  { kind: "level", id: "l3", durationMinutes: 15, smallBlind: 300, bigBlind: 600, ante: 600 },
  { kind: "level", id: "l4", durationMinutes: 15, smallBlind: 400, bigBlind: 800, ante: 800 },
];

/** The test structure (normalized), with any field replaced. */
export function testStructure(overrides: Partial<ClockStructure> = {}): ClockStructure {
  return normalizeStructure({
    levels: TEST_LEVELS.map((level) => ({ ...level })),
    anteMode: "bb_ante",
    startingStack: 10_000,
    rebuyStack: null,
    addonStack: 15_000,
    earlyBirdStack: 5_000,
    ...overrides,
  });
}

export interface NewClock {
  tournamentId: string;
  structure?: ClockStructure;
  /** Anchors over INITIAL_CLOCK_STATE (idle at Level 1). */
  state?: Partial<ClockState>;
  undoState?: ClockUndo | null;
  displaySettings?: Partial<ClockDisplaySettings>;
  presetKey?: string | null;
  version?: number;
}

export async function createClock(clock: NewClock, db: Database = getDb()): Promise<TournamentClock> {
  const [row] = await db
    .insert(tournamentClocks)
    .values({
      tournamentId: clock.tournamentId,
      ...clockStructureColumns(clock.structure ?? testStructure()),
      ...clockStateColumns({ ...INITIAL_CLOCK_STATE, ...clock.state }),
      undoState: clock.undoState ?? null,
      displaySettings: clock.displaySettings ?? {},
      presetKey: clock.presetKey ?? null,
      version: clock.version ?? 0,
    })
    .returning();
  return row;
}

/** A clock running in `level` since `startedAt`, its period ending `remainingMs` after `nowMs`. */
export function runningState(nowMs: number, level: number, remainingMs: number, startedAt = nowMs): Partial<ClockState> {
  return { status: "running", currentLevelIndex: level, periodEndsAt: nowMs + remainingMs, pausedRemainingMs: null, startedAt };
}

/** The undo snapshot a manual change at `at` (default now) would store over `state`: by default a pause that left the clock on the same level. */
export function undoSnapshot(state: ClockState, overrides: Partial<Omit<ClockUndo, "state">> = {}): ClockUndo {
  return {
    state,
    change: { action: "pause", description: "Clock paused" },
    redo: false,
    at: Date.now(),
    levelIndex: state.currentLevelIndex,
    startedTournamentFrom: null,
    ...overrides,
  };
}
