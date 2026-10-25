import { anteText, formatBlinds, formatClock, type BlindLevel, type ClockStatus, type ClockStructure, type DerivedClock } from "@shared/domain/clock";
import { cn } from "@/lib/utils";

/** The last minute of a level is shown in the warning colour. */
const FINAL_MINUTE_MS = 60_000;

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
 * (seen from across the room: the time is not running), the final minute, a break, or plain play.
 */
type ClockTone = "paused" | "final-minute" | "break" | "plain";

const TONE_CLASS: Readonly<Record<ClockTone, string>> = {
  paused: "text-status-scheduled-foreground",
  "final-minute": "text-destructive",
  break: "text-status-live-foreground",
  plain: "text-foreground",
};

const PAUSED_TONE = TONE_CLASS.paused;

/** The countdown's tone: paused first, then the last minute of a level, then a break. */
function timerTone(derived: DerivedClock): ClockTone {
  if (derived.status === "paused") return "paused";
  if (derived.status === "running" && !derived.isBreak && derived.remainingMs <= FINAL_MINUTE_MS && !derived.overtime) return "final-minute";
  return derived.isBreak ? "break" : "plain";
}

/**
 * The clock in one line, for a layer over it (the seats, the payouts): the status when the clock is not
 * simply counting down ("Paused" in the paused colour), then the period, the time and the blinds. A
 * paused clock under the seats never looks frozen (TDN2-TV-STATE-TOO-SMALL).
 */
export function ClockStrip({ derived }: { derived: DerivedClock }) {
  const status = statusWord(derived);
  const play = derived.currentPlayLevel;
  return (
    <>
      {status ? (
        <span className={cn("font-bold uppercase", derived.status === "paused" ? PAUSED_TONE : "text-foreground")} data-tone={derived.status === "paused" ? "paused" : "plain"}>
          {status} ·{" "}
        </span>
      ) : null}
      {periodName(derived)} · {formatClock(derived.remainingMs)}
      {play ? ` · ${formatBlinds(play)}` : ""}
    </>
  );
}

interface ClockFaceProps {
  derived: DerivedClock;
  structure: Pick<ClockStructure, "anteMode">;
  /** The TV's full-screen sizes, or the TD panel's. */
  variant: "tv" | "compact";
}

/**
 * The clock itself: the level (or "Break" over its note), the time left, the blinds and the ante, what
 * comes next and the time to the next break. On the TV a paused clock says PAUSED as large as the
 * blinds, and its time is in the paused colour. The countdown is a timer (never announced each second);
 * the page announces level changes.
 */
export function ClockFace({ derived, structure, variant }: ClockFaceProps) {
  const tv = variant === "tv";
  // The TV's own heading is the tournament (h1); in the TD's panel the face sits under the card's title.
  const Heading = tv ? "h2" : "h3";
  const play = derived.currentPlayLevel;
  const ante = play ? anteText(play, structure.anteMode) : null;
  const status = statusWord(derived);
  const note = breakNote(derived);
  const paused = derived.status === "paused";
  const following = nextText(derived.next, structure);
  const tone = timerTone(derived);

  return (
    <div className="flex flex-col items-center text-center" data-testid="clock-face">
      <div className="flex flex-wrap items-baseline justify-center gap-x-3">
        <Heading
          className={cn(
            "font-display font-bold uppercase tracking-wide",
            derived.isBreak ? "text-status-live-foreground" : "text-foreground",
            tv ? "leading-tight text-[clamp(1.75rem,min(5vw,7vh),4.5rem)]" : "text-xl",
          )}
        >
          {periodTitle(derived)}
        </Heading>
        {play ? (
          <span className={cn("text-muted-foreground", tv ? "text-[clamp(1rem,min(2vw,2.8vh),1.75rem)]" : "text-sm")}>of {derived.playLevelCount}</span>
        ) : null}
      </div>
      {note ? (
        // "Last re-buys / add-ons" is longer than "Level 12": a size that keeps it on a line or two under "Break".
        <p className={cn("text-balance font-semibold uppercase tracking-wide text-status-live-foreground", tv ? "text-[clamp(1.25rem,min(3.2vw,4.8vh),3rem)] leading-tight" : "text-sm")}>
          {note}
        </p>
      ) : null}
      {status && tv && paused ? (
        <p className={cn("mt-[1vh] font-display font-bold uppercase leading-none tracking-widest text-[clamp(2rem,min(6vw,8.5vh),6rem)]", PAUSED_TONE)} data-tone="paused" data-testid="clock-paused">
          {status}
        </p>
      ) : status ? (
        <p className={cn("mt-1 rounded-full border border-border px-3 py-0.5 font-semibold uppercase tracking-wider", paused ? PAUSED_TONE : "text-muted-foreground", tv ? "text-[clamp(0.9rem,min(1.6vw,2.2vh),1.5rem)]" : "text-xs")}>
          {status}
        </p>
      ) : null}

      <p
        role="timer"
        aria-label="Time left"
        data-tone={tone}
        className={cn("font-display font-bold tabular-nums leading-none", tv ? "my-[1.5vh] text-[clamp(5rem,min(21vw,30vh),19rem)]" : "my-2 text-6xl sm:text-7xl", TONE_CLASS[tone])}
      >
        {formatClock(derived.remainingMs)}
      </p>

      {play ? (
        <div>
          <p className={cn("font-bold tabular-nums text-foreground", tv ? "text-[clamp(2rem,min(6vw,8.5vh),6rem)] leading-none" : "text-3xl")}>
            <span className="sr-only">Blinds </span>
            {formatBlinds(play)}
          </p>
          {ante ? <p className={cn("mt-1 font-semibold tabular-nums text-accent-text", tv ? "text-[clamp(1.5rem,min(4vw,5.5vh),3.5rem)] leading-tight" : "text-lg")}>{ante}</p> : null}
        </div>
      ) : null}

      <dl className={cn("mt-[1.5vh] flex flex-wrap justify-center gap-x-8 gap-y-1 text-muted-foreground", tv ? "text-[clamp(1rem,min(2.4vw,3.4vh),2.25rem)] leading-tight" : "text-sm")}>
        <div className="flex gap-2">
          <dt>Next:</dt>
          <dd className="font-semibold tabular-nums text-foreground">{following ?? "Final level"}</dd>
        </div>
        {derived.msUntilNextBreak !== null ? (
          <div className="flex gap-2">
            <dt>Break in</dt>
            <dd className="font-semibold tabular-nums text-foreground">{formatClock(derived.msUntilNextBreak)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
