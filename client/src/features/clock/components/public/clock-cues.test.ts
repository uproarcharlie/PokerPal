import { describe, expect, it } from "vitest";
import { runningClock, shortStructure } from "@test/helpers/clock-dto";
import { deriveClock, type BlindLevel, type DerivedClock } from "@shared/domain/clock";
import { clockStateOf } from "../../hooks";
import { clockCue } from "./clock-cues";

const NOW = Date.parse("2026-10-23T08:00:00.000Z");
const { levels } = shortStructure();

/** The running clock at `levelIndex` of `rows`, with `remainingMs` left of it. */
function runningAt(rows: BlindLevel[], levelIndex: number, remainingMs = 5 * 60_000): DerivedClock {
  const clock = runningClock(NOW, { levelIndex, remainingMs, structure: { ...shortStructure(), levels: rows } });
  const derived = deriveClock(clockStateOf(clock), rows, NOW);
  if (!derived) throw new Error("no levels");
  return derived;
}

describe("clockCue (P4REV1-R2-04)", () => {
  it("chimes for the next level or a break, and for the last minute of the same one", () => {
    expect(clockCue(runningAt(levels, 0), runningAt(levels, 1), levels)).toBe("level");
    expect(clockCue(runningAt(levels, 2), runningAt(levels, 3), levels)).toBe("break");
    expect(clockCue(runningAt(levels, 1, 61_000), runningAt(levels, 1, 59_000), levels)).toBe("minute");
    expect(clockCue(runningAt(levels, 1, 59_000), runningAt(levels, 1, 58_000), levels)).toBeNull();
  });

  it("stays silent when a row inserted above moves the clock's place but not the clock", () => {
    const inserted: BlindLevel[] = [levels[0], { kind: "break", id: "bx", durationMinutes: 5, note: null }, ...levels.slice(1)];
    expect(clockCue(runningAt(levels, 1), runningAt(inserted, 2), inserted)).toBeNull();
  });

  it("still chimes when a row above is deleted just as the level ends", () => {
    const deleted = levels.filter((level) => level.id !== "l1");
    // On l2 (index 1); it ends as l1 goes: now on l3, which is index 1 again.
    expect(clockCue(runningAt(levels, 1), runningAt(deleted, 1), deleted)).toBe("level");
  });

  it("stays silent going back a level, before the clock runs, and on the first draw", () => {
    expect(clockCue(runningAt(levels, 2), runningAt(levels, 1), levels)).toBeNull();
    expect(clockCue(null, runningAt(levels, 1), levels)).toBeNull();
    const paused = { ...runningAt(levels, 1), status: "paused" as const };
    expect(clockCue(runningAt(levels, 0), paused, levels)).toBeNull();
  });
});
