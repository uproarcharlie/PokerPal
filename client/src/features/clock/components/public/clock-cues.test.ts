import { describe, expect, it } from "vitest";
import { runningClock, shortStructure } from "@test/helpers/clock-dto";
import { deriveClock, type BlindLevel, type DerivedClock } from "@shared/domain/clock";
import { clockStateOf } from "../../hooks";
import { clockCue } from "./clock-cues";

const cueOf = (...args: Parameters<typeof clockCue>) => clockCue(...args)?.cue ?? null;

const NOW = Date.parse("2026-10-23T08:00:00.000Z");
const { levels } = shortStructure();

/** The running clock at `levelIndex` of `rows`, with `remainingMs` left of it. */
function runningAt(rows: BlindLevel[], levelIndex: number, remainingMs = 5 * 60_000): DerivedClock {
  const clock = runningClock(NOW, { levelIndex, remainingMs, structure: { ...shortStructure(), levels: rows } });
  const derived = deriveClock(clockStateOf(clock), rows, NOW);
  if (!derived) throw new Error("no levels");
  return derived;
}

describe("clockCue (P4REV1-R2-04, round 5 item 20)", () => {
  it("sounds blinds up for the next level, its own chimes for a break starting and ending, and the alarm at a minute left", () => {
    expect(clockCue(runningAt(levels, 0), runningAt(levels, 1), levels)).toEqual({ cue: "level", key: "l2:start" });
    expect(clockCue(runningAt(levels, 2), runningAt(levels, 3), levels)).toEqual({ cue: "break_start", key: "b1:start" });
    expect(clockCue(runningAt(levels, 3), runningAt(levels, 4), levels)).toEqual({ cue: "break_end", key: "l4:start" });
    expect(clockCue(runningAt(levels, 1, 61_000), runningAt(levels, 1, 59_000), levels)).toEqual({ cue: "minute", key: "l2:minute" });
    expect(clockCue(runningAt(levels, 1, 59_000), runningAt(levels, 1, 58_000), levels)).toBeNull();
    // A break has no minute alarm.
    expect(clockCue(runningAt(levels, 3, 61_000), runningAt(levels, 3, 59_000), levels)).toBeNull();
  });

  it("beeps each of the last ten seconds, the last three the urgent beep, a level's and a break's alike", () => {
    expect(clockCue(runningAt(levels, 1, 11_000), runningAt(levels, 1, 10_000), levels)).toEqual({ cue: "count", key: "l2:count:10" });
    expect(clockCue(runningAt(levels, 1, 5_000), runningAt(levels, 1, 4_000), levels)).toEqual({ cue: "count", key: "l2:count:4" });
    expect(clockCue(runningAt(levels, 1, 3_400), runningAt(levels, 1, 2_900), levels)).toEqual({ cue: "final_count", key: "l2:count:3" });
    expect(clockCue(runningAt(levels, 3, 1_500), runningAt(levels, 3, 900), levels)).toEqual({ cue: "final_count", key: "b1:count:1" });
    // Several seconds passed at once (a slow screen, a minute taken off): the latest only.
    expect(clockCue(runningAt(levels, 1, 70_000), runningAt(levels, 1, 6_500), levels)).toEqual({ cue: "count", key: "l2:count:7" });
    // Time added back (0:05 → 1:05) crosses nothing.
    expect(cueOf(runningAt(levels, 1, 5_000), runningAt(levels, 1, 65_000), levels)).toBeNull();
  });

  it("stays silent when a row inserted above moves the clock's place but not the clock", () => {
    const inserted: BlindLevel[] = [levels[0], { kind: "break", id: "bx", durationMinutes: 5, note: null }, ...levels.slice(1)];
    expect(cueOf(runningAt(levels, 1), runningAt(inserted, 2), inserted)).toBeNull();
  });

  it("still chimes when a row above is deleted just as the level ends", () => {
    const deleted = levels.filter((level) => level.id !== "l1");
    // On l2 (index 1); it ends as l1 goes: now on l3, which is index 1 again.
    expect(cueOf(runningAt(levels, 1), runningAt(deleted, 1), deleted)).toBe("level");
  });

  it("stays silent going back a level, while paused, on a resume, and on the first draw", () => {
    expect(cueOf(runningAt(levels, 2), runningAt(levels, 1), levels)).toBeNull();
    expect(cueOf(null, runningAt(levels, 1), levels)).toBeNull();
    const paused = (derived: DerivedClock) => ({ ...derived, status: "paused" as const });
    expect(cueOf(runningAt(levels, 0), paused(runningAt(levels, 1)), levels)).toBeNull();
    expect(cueOf(paused(runningAt(levels, 1, 61_000)), runningAt(levels, 1, 59_000), levels)).toBeNull();
    expect(cueOf(paused(runningAt(levels, 0)), runningAt(levels, 1), levels)).toBeNull();
  });
});
