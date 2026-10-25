import type { CSSProperties } from "react";
import { anteText, formatBlinds, formatClock, type BlindLevel, type ClockStatus, type ClockStructure, type DerivedClock } from "@shared/domain/clock";
import { cn } from "@/lib/utils";
import { LINE, px, type FacePlan } from "./screen-plan";

/** The last minute of a level is shown in amber, the last seconds in red and pulsing (round 5, item 20). */
const FINAL_MINUTE_MS = 60_000;
const FINAL_SECONDS_MS = 10_000;

/**
 * "Level 3", or "Break" for every break: the word the clock heads the period with. A break's note is
 * said under it (breakNote), never instead of it, so the room always sees that play has stopped
 * (TDN2-BREAK-WORD-MISSING).
 */
export function periodTitle(derived: DerivedClock): string {
  return derived.level.kind === "break" ? "Break" : `Level ${String(derived.levelNumber)}`;
}

/** A break's note ("Last re-buys / add-ons", "Colour up"); null on a level or a break without one. */
export function breakNote(derived: DerivedClock): string | null {
  return derived.level.kind === "break" && derived.level.note ? derived.level.note : null;
}

/** The period where there is room for one line only: "Level 3", "Break" or "Break · Colour up". */
export function periodName(derived: DerivedClock): string {
  const note = breakNote(derived);
  return note ? `${periodTitle(derived)} · ${note}` : periodTitle(derived);
}

/**
 * The time to the break, as the room reads it from across it (round 5, item 21): "Break in 52:31" on
 * a level; "Break — back in 8:12" on a break; "No more breaks" once none is left.
 */
export function breakText(derived: DerivedClock): string {
  if (derived.isBreak) return `Break — back in ${formatClock(derived.remainingMs)}`;
  return derived.msUntilNextBreak === null ? "No more breaks" : `Break in ${formatClock(derived.msUntilNextBreak)}`;
}

/** The widest the countdown gets on this level (every digit a 0), so its size holds for the whole level. */
export function timerTemplate(derived: DerivedClock): string {
  return formatClock(Math.max(derived.durationMs, derived.remainingMs)).replace(/\d/g, "0");
}

/** What comes next, e.g. "300/600 · BB ante 600" or "Break (15 min)"; null on the final level. */
export function nextText(next: BlindLevel | null, structure: Pick<ClockStructure, "anteMode">): string | null {
  if (!next) return null;
  if (next.kind === "break") return `Break (${String(next.durationMinutes)} min)`;
  const ante = anteText(next, structure.anteMode);
  return ante ? `${formatBlinds(next)} · ${ante}` : formatBlinds(next);
}

/** The clock's status in a word, wherever a screen names it. */
export const CLOCK_STATUS_WORDS: Readonly<Record<ClockStatus, string>> = {
  idle: "Not started",
  running: "Running",
  paused: "Paused",
  finished: "Finished",
};

/** A word for a clock that is not counting down (a running one only says when it is on its final level). */
export function statusWord(derived: DerivedClock): string | null {
  if (derived.status !== "running") return CLOCK_STATUS_WORDS[derived.status];
  return derived.overtime ? "Final level" : null;
}

/**
 * What the clock's colour tells the room, wherever a screen shows it (and `data-tone` names it): paused
 * (seen from across the room: the time is not running), the final minute (amber), the final seconds
 * (red, pulsing unless the viewer asked for less motion), a break, or plain play.
 */
type ClockTone = "paused" | "final-minute" | "final-seconds" | "break" | "plain";

const TONE_CLASS: Readonly<Record<ClockTone, string>> = {
  paused: "text-status-scheduled-foreground",
  // No token is amber in both schemes: the TV is dark (amber-400), the TD's panel light (amber-700, 4.5:1 on white).
  "final-minute": "text-amber-700 dark:text-amber-400",
  "final-seconds": "text-destructive motion-safe:animate-[pulse_1s_ease-in-out_infinite]",
  break: "text-status-live-foreground",
  plain: "text-foreground",
};

export const PAUSED_TONE = TONE_CLASS.paused;

/** The classes that colour the countdown in `tone`. */
export const toneClass = (tone: ClockTone): string => TONE_CLASS[tone];

/** The countdown's tone: paused first, then the last seconds and the last minute of a level, then a break. */
export function timerTone(derived: DerivedClock): ClockTone {
  if (derived.status === "paused") return "paused";
  if (derived.status === "running" && !derived.isBreak && !derived.overtime) {
    if (derived.remainingMs <= FINAL_SECONDS_MS) return "final-seconds";
    if (derived.remainingMs <= FINAL_MINUTE_MS) return "final-minute";
  }
  return derived.isBreak ? "break" : "plain";
}

/**
 * The clock in one line, for a layer over it (the seats, the payouts): the status when the clock is not
 * simply counting down ("Paused" in the paused colour), then the period (a level only where the TV
 * shows its number), the time and the blinds. A paused clock under the seats never looks frozen
 * (TDN2-TV-STATE-TOO-SMALL).
 */
export function ClockStrip({ derived, showLevel }: { derived: DerivedClock; showLevel: boolean }) {
  const status = statusWord(derived);
  const play = derived.currentPlayLevel;
  const period = derived.isBreak || showLevel ? periodName(derived) : null;
  return (
    <>
      {status ? (
        <span className={cn("font-bold uppercase", derived.status === "paused" ? PAUSED_TONE : "text-foreground")} data-tone={derived.status === "paused" ? "paused" : "plain"}>
          {status} ·{" "}
        </span>
      ) : null}
      {[period, formatClock(derived.remainingMs), play ? formatBlinds(play) : null].filter((part) => part !== null).join(" · ")}
    </>
  );
}

interface ClockFaceProps {
  derived: DerivedClock;
  structure: Pick<ClockStructure, "anteMode">;
  /** The TV's full-screen sizes (from its screen plan), or the TD panel's. */
  variant: "tv" | "compact";
  /** The TV's sizes in pixels (screen-plan): required for "tv". */
  plan?: FacePlan;
}

/** A line of `size` px, `line` high, never wrapping: shrunk to fit by the plan, cut short if it still does not. */
const sized = (size: number, line: number): CSSProperties => ({ fontSize: px(size), lineHeight: line });

/**
 * The clock itself: the level (or "Break" over its note), the time left, the blinds and the ante, the
 * time to the break, and what comes next. On the TV the level's number is left out unless the TD shows
 * it, so the blinds are the headline under the countdown, a paused clock says PAUSED as large as the
 * blinds, and its time is in the paused colour; every size comes from the screen's plan, so it fits. No
 * total of levels is shown (round 5, item 21). The countdown is a timer (never announced each second);
 * the page announces level changes.
 */
export function ClockFace({ derived, structure, variant, plan }: ClockFaceProps) {
  if (variant === "tv" && plan) return <TvFace derived={derived} structure={structure} plan={plan} />;
  const play = derived.currentPlayLevel;
  const ante = play ? anteText(play, structure.anteMode) : null;
  const status = statusWord(derived);
  const note = breakNote(derived);
  const paused = derived.status === "paused";
  const following = nextText(derived.next, structure);
  const tone = timerTone(derived);

  return (
    <div className="flex flex-col items-center text-center" data-testid="clock-face">
      {/* In the TD's panel the face sits under the card's title. */}
      <h3 className={cn("font-display text-xl font-bold uppercase tracking-wide", derived.isBreak ? "text-status-live-foreground" : "text-foreground")}>{periodTitle(derived)}</h3>
      {note ? <p className="text-balance text-sm font-semibold uppercase tracking-wide text-status-live-foreground">{note}</p> : null}
      {status ? (
        <p className={cn("mt-1 rounded-full border border-border px-3 py-0.5 text-xs font-semibold uppercase tracking-wider", paused ? PAUSED_TONE : "text-muted-foreground")}>{status}</p>
      ) : null}

      <p role="timer" aria-label="Time left" data-tone={tone} className={cn("my-2 font-display text-6xl font-bold tabular-nums leading-none sm:text-7xl", TONE_CLASS[tone])}>
        {formatClock(derived.remainingMs)}
      </p>

      {play ? (
        <div>
          <p className="text-3xl font-bold tabular-nums text-foreground">
            <span className="sr-only">Blinds </span>
            {formatBlinds(play)}
          </p>
          {ante ? <p className="mt-1 text-lg font-semibold tabular-nums text-accent-text">{ante}</p> : null}
        </div>
      ) : null}

      <p className="mt-2 text-sm font-semibold tabular-nums text-foreground" data-testid="break-line">
        {breakText(derived)}
      </p>
      <p className="text-sm text-muted-foreground">
        Next: <span className="font-semibold tabular-nums text-foreground">{following ?? "Final level"}</span>
      </p>
    </div>
  );
}

/** The TV's clock, every line at the plan's size, centred in its column; the level's title only where the plan sizes one (the TD shows it). */
function TvFace({ derived, structure, plan }: { derived: DerivedClock; structure: Pick<ClockStructure, "anteMode">; plan: FacePlan }) {
  const play = derived.currentPlayLevel;
  const title = plan.title > 0 ? periodTitle(derived) : null;
  const ante = play ? anteText(play, structure.anteMode) : null;
  const status = statusWord(derived);
  const note = breakNote(derived);
  const paused = derived.status === "paused";
  const following = nextText(derived.next, structure);
  const tone = timerTone(derived);
  const gap = px(plan.gap);

  return (
    <div className="flex w-full min-w-0 flex-col items-center text-center" style={{ gap }} data-testid="clock-face">
      {/* The TV's own heading is the tournament (h1). */}
      {title ? (
        <h2
          className={cn("max-w-full truncate font-display font-black uppercase tracking-wide", derived.isBreak ? "text-status-live-foreground" : "text-foreground")}
          style={sized(plan.title, LINE.title)}
        >
          {title}
        </h2>
      ) : null}
      {note ? (
        <p className="max-w-full truncate font-bold uppercase tracking-wide text-status-live-foreground" style={sized(plan.note, LINE.note)}>
          {note}
        </p>
      ) : null}
      {status && paused ? (
        <p className={cn("max-w-full truncate font-display font-black uppercase tracking-widest", PAUSED_TONE)} style={sized(plan.status, LINE.status)} data-tone="paused" data-testid="clock-paused">
          {status}
        </p>
      ) : status ? (
        <p className="max-w-full truncate rounded-full border-2 border-border px-[0.8em] font-bold uppercase tracking-wider text-muted-foreground" style={sized(plan.status, LINE.chip)}>
          {status}
        </p>
      ) : null}

      <p role="timer" aria-label="Time left" data-tone={tone} className={cn("whitespace-nowrap font-display font-black tabular-nums", TONE_CLASS[tone])} style={sized(plan.timer, LINE.timer)}>
        {formatClock(derived.remainingMs)}
      </p>

      {play ? (
        <p className="max-w-full truncate font-extrabold tabular-nums text-foreground" style={sized(plan.blinds, LINE.blinds)}>
          <span className="sr-only">Blinds </span>
          {formatBlinds(play)}
        </p>
      ) : null}
      {ante ? (
        <p className="max-w-full truncate font-bold tabular-nums text-accent-text" style={sized(plan.ante, LINE.ante)}>
          {ante}
        </p>
      ) : null}

      <p
        className={cn("max-w-full truncate font-display font-black uppercase tabular-nums tracking-wide", derived.isBreak ? "text-status-live-foreground" : "text-foreground")}
        style={sized(plan.breakLine, LINE.breakLine)}
        data-testid="break-line"
      >
        {breakText(derived)}
      </p>
      <p className="max-w-full truncate font-semibold text-muted-foreground" style={sized(plan.next, LINE.next)}>
        Next: <span className="tabular-nums text-foreground">{following ?? "Final level"}</span>
      </p>
    </div>
  );
}
