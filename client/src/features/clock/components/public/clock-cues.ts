/**
 * When the TV sounds (round 5, item 20): a minute left in a level, each of the last ten seconds of a
 * level or a break, a level starting ("blinds up"), a break starting, and play resuming after one.
 * Worked out between two snapshots of the running clock by the row each is on (its id), never by its
 * position: a structure edit that inserts a row above the current level moves the clock's index but
 * not the clock (P4REV1-R2-04).
 *
 * Each sound plays once per threshold of a level: the screen remembers what it played (for this tab,
 * so a refresh does not play it again), so time the TD adds back past a threshold that has sounded
 * stays silent when the clock reaches it again. Nothing sounds while the clock is paused or stopped,
 * on the first draw, or for Previous (going back to a level lets its sounds play again).
 */
import { useEffect, useRef } from "react";
import type { BlindLevel, DerivedClock } from "@shared/domain/clock";
import type { ClockCue, ClockSound } from "./use-clock-sound";

/** The cue the minute warning plays at. */
const MINUTE_WARNING_MS = 60_000;

/** The countdown beeps for the last this-many seconds. */
export const COUNTDOWN_SECONDS = 10;

/** The last seconds whose beep is the urgent one. */
const FINAL_SECONDS = 3;

/** The sounds the TD can switch off one by one (round 5: per tournament, in its TV display settings). */
export interface CueSettings {
  /** One minute left in a level. */
  minute: boolean;
  /** The last ten seconds. */
  countdown: boolean;
  /** A level starting: blinds up. */
  level: boolean;
  /** A break starting and play resuming. */
  break: boolean;
}

export const ALL_CUES_ON: Readonly<CueSettings> = Object.freeze({ minute: true, countdown: true, level: true, break: true });

/** Which switch each sound is under. */
const SWITCH_OF: Readonly<Record<ClockCue, keyof CueSettings>> = {
  minute: "minute",
  count: "countdown",
  final_count: "countdown",
  level: "level",
  break_start: "break",
  break_end: "break",
};

/** A sound to play, and what marks it played (the row it is for and its threshold). */
export interface CueEvent {
  cue: ClockCue;
  key: string;
}

/**
 * The sound for the running clock going from `before` to `derived` (both on the server's time), or
 * null. On the same row: the minute warning as it crosses its last minute (levels only), or a beep as
 * it crosses each of its last ten seconds (only the latest when several pass at once). On a row further
 * on in `levels` (the structure `derived` was worked out from): "break_start" onto a break,
 * "break_end" off one, "level" otherwise. Previous or a jump back is silent.
 */
export function clockCue(before: DerivedClock | null, derived: DerivedClock | null, levels: readonly BlindLevel[]): CueEvent | null {
  if (!before || !derived || derived.status !== "running" || before.status !== "running") return null;
  const row = derived.level.id;
  if (row === before.level.id) {
    for (let second = 1; second <= COUNTDOWN_SECONDS; second++) {
      const at = second * 1000;
      if (before.remainingMs > at && derived.remainingMs <= at && derived.remainingMs > 0) {
        return { cue: second <= FINAL_SECONDS ? "final_count" : "count", key: `${row}:count:${String(second)}` };
      }
    }
    if (!derived.isBreak && before.remainingMs > MINUTE_WARNING_MS && derived.remainingMs <= MINUTE_WARNING_MS) return { cue: "minute", key: `${row}:minute` };
    return null;
  }
  // The row the clock was on, where it now sits; gone only once the clock had left it.
  const was = levels.findIndex((level) => level.id === before.level.id);
  if (was !== -1 && was >= derived.levelIndex) return null;
  const cue: ClockCue = derived.isBreak ? "break_start" : before.isBreak ? "break_end" : "level";
  return { cue, key: `${row}:start` };
}

/** How many played sounds a screen remembers (a long night's worth). */
const REMEMBERED = 200;

const storageKey = (tournamentId: string) => `pokerpal.clock.cues.${tournamentId}`;

function readPlayed(tournamentId: string): string[] {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(storageKey(tournamentId)) ?? "[]");
    return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writePlayed(tournamentId: string, played: readonly string[]): void {
  try {
    window.sessionStorage.setItem(storageKey(tournamentId), JSON.stringify(played.slice(-REMEMBERED)));
  } catch {
    // Not remembered (a private window): the sounds still play once each while the page is open.
  }
}

/**
 * Plays clockCue's sound each time the clock on screen changes, once per threshold, if its switch is
 * on (a switched-off sound still counts as played: switching it back on never plays one late).
 */
export function useClockCues(
  tournamentId: string,
  derived: DerivedClock | null,
  levels: readonly BlindLevel[],
  play: ClockSound["play"],
  settings: CueSettings = ALL_CUES_ON,
): void {
  const previous = useRef<DerivedClock | null>(null);
  const played = useRef<string[] | null>(null);
  // By value: each poll brings the settings as a new object.
  const { minute, countdown, level: blindsUp, break: breakChimes } = settings;
  useEffect(() => {
    const switches: CueSettings = { minute, countdown, level: blindsUp, break: breakChimes };
    played.current ??= readPlayed(tournamentId);
    const before = previous.current;
    previous.current = derived;
    if (!derived) return;
    // A reset starts the night again; going back to a level lets its sounds play again.
    if (derived.status === "idle" && played.current.length > 0) {
      played.current = [];
      writePlayed(tournamentId, played.current);
    } else if (before && levels.findIndex((level) => level.id === before.level.id) > derived.levelIndex) {
      const row = `${derived.level.id}:`;
      played.current = played.current.filter((key) => !key.startsWith(row));
      writePlayed(tournamentId, played.current);
    }
    const event = clockCue(before, derived, levels);
    if (!event || played.current.includes(event.key)) return;
    played.current = [...played.current, event.key];
    writePlayed(tournamentId, played.current);
    if (switches[SWITCH_OF[event.cue]]) play(event.cue);
  }, [tournamentId, derived, levels, play, minute, countdown, blindsUp, breakChimes]);
}
