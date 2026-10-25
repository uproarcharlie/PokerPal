/**
 * When the TV chimes: a level change while running (never on the first draw), one minute left, a
 * break starting. Worked out between two snapshots of the clock by the row each is on (its id), never
 * by its position: a structure edit that inserts a row above the current level moves the clock's index
 * but not the clock, and a row deleted above just as a level ends does not hide the change
 * (P4REV1-R2-04).
 */
import { useEffect, useRef } from "react";
import type { BlindLevel, DerivedClock } from "@shared/domain/clock";
import type { ClockCue, ClockSound } from "./use-clock-sound";

/** The cue the minute warning plays at. */
const MINUTE_WARNING_MS = 60_000;

/**
 * The chime for the clock going from `before` to `derived` (both on the server's time), or null. A
 * level or break chime when the running clock is on another row than before, further on in `levels`
 * (the structure `derived` was worked out from): Previous or a jump back is silent, as before. The
 * minute warning when the same row crosses its last minute.
 */
export function clockCue(before: DerivedClock | null, derived: DerivedClock | null, levels: readonly BlindLevel[]): ClockCue | null {
  if (!before || !derived || derived.status !== "running") return null;
  if (derived.level.id === before.level.id) {
    return before.remainingMs > MINUTE_WARNING_MS && derived.remainingMs <= MINUTE_WARNING_MS ? "minute" : null;
  }
  // The row the clock was on, where it now sits; gone only once the clock had left it.
  const was = levels.findIndex((level) => level.id === before.level.id);
  if (was !== -1 && was >= derived.levelIndex) return null;
  return derived.isBreak ? "break" : "level";
}

/** Plays clockCue's chime each time the clock on screen changes. */
export function useClockCues(derived: DerivedClock | null, levels: readonly BlindLevel[], play: ClockSound["play"]): void {
  const previous = useRef<DerivedClock | null>(null);
  useEffect(() => {
    const cue = clockCue(previous.current, derived, levels);
    previous.current = derived;
    if (cue) play(cue);
  }, [derived, levels, play]);
}
