import type { CSSProperties, ReactNode } from "react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { formatClock, type DerivedClock } from "@shared/domain/clock";
import { cn } from "@/lib/utils";
import { breakNote, CLOCK_STATUS_WORDS, nextText, PAUSED_TONE, timerTemplate, timerTone, toneClass } from "./clock-face";
import { LINE, px, type CentrePlan, type CentreText } from "./screen-plan";
import { TvLogo } from "./tv-logo";

/** Said under "Starting soon" (or "Clock not set up yet") while the TD has not set the clock up. */
export const NOT_SET_UP_LINE = "The blinds appear here as soon as the tournament director sets the clock up.";

const words = (headline: string, more: Partial<CentreText> = {}): CentreText => ({ headline, status: null, timer: null, note: null, lines: [], action: false, ...more });

/**
 * What the screen says under the logo when the logo is its centrepiece (round 5, item 24), or null
 * while the clock is in play: "Starting soon" before the clock starts (with the first blinds), "Break —
 * back in" over the break's countdown (its note and what comes next under it), and the screens with no
 * clock to show: not set up yet ("Starting soon" until the tournament is under way), complete (with its
 * results), cancelled.
 */
export function centreText(display: Pick<LiveDisplayDto, "tournament" | "clock">, derived: DerivedClock | null): CentreText | null {
  const { tournament, clock } = display;
  if (tournament.status === "cancelled") return words("This tournament was cancelled");
  if (tournament.status === "completed") return words("Tournament complete", { action: true });
  if (!clock || !derived) {
    return words(tournament.status === "in_progress" ? "Clock not set up yet" : "Starting soon", { lines: [{ text: NOT_SET_UP_LINE, wrap: true }] });
  }
  if (derived.isBreak) {
    return words("Break — back in", {
      status: derived.status === "paused" ? CLOCK_STATUS_WORDS.paused : null,
      timer: timerTemplate(derived),
      note: breakNote(derived),
      lines: [{ text: `Next: ${nextText(derived.next, clock.structure) ?? "Final level"}` }],
    });
  }
  if (derived.status === "idle") {
    const first = nextText(derived.currentPlayLevel, clock.structure);
    return words("Starting soon", { lines: first ? [{ text: `First blinds: ${first}` }] : [] });
  }
  return null;
}

/** A line of `size` px, `line` high. */
const sized = (size: number, line: number): CSSProperties => ({ fontSize: px(size), lineHeight: line });

interface CentrePieceProps {
  display: LiveDisplayDto;
  derived: DerivedClock | null;
  text: CentreText;
  plan: CentrePlan;
  /** Under it all (the results' link once the game is over). */
  action?: ReactNode;
}

/**
 * The club's logo as large as the screen allows (about 30% of a TV's height), with the words under it:
 * the headline ("Starting soon", "Break — back in", "Tournament complete"), the break's countdown as
 * large as the room allows (amber, red and PAUSED as the clock's own), its note, and smaller lines.
 */
export function CentrePiece({ display, derived, text, plan, action }: CentrePieceProps) {
  const tone = derived ? timerTone(derived) : "plain";
  return (
    <div className="flex w-full min-w-0 flex-col items-center text-center" style={{ gap: px(plan.gap) }} data-testid="clock-centrepiece">
      {plan.logo > 0 ? <TvLogo name={display.club.name} imageUrl={display.club.imageUrl} width={plan.logoWidth} height={plan.logo} /> : null}
      <h2
        className={cn("max-w-full truncate font-display font-black uppercase tracking-wide", text.timer ? "text-status-live-foreground" : "text-foreground")}
        style={sized(plan.headline, LINE.title)}
        data-testid={text.timer ? "break-line" : undefined}
      >
        {text.headline}
      </h2>
      {text.status ? (
        <p className={cn("max-w-full truncate font-display font-black uppercase tracking-widest", PAUSED_TONE)} style={sized(plan.status, LINE.status)} data-tone="paused" data-testid="clock-paused">
          {text.status}
        </p>
      ) : null}
      {text.timer && derived ? (
        <p role="timer" aria-label="Time left" data-tone={tone} className={cn("whitespace-nowrap font-display font-black tabular-nums", toneClass(tone))} style={sized(plan.timer, LINE.timer)}>
          {formatClock(derived.remainingMs)}
        </p>
      ) : null}
      {text.note ? (
        <p className="max-w-full truncate font-bold uppercase tracking-wide text-status-live-foreground" style={sized(plan.note, LINE.note)}>
          {text.note}
        </p>
      ) : null}
      {text.lines.map((line, i) => (
        <p
          key={line.text}
          className={cn("max-w-full font-semibold tabular-nums text-muted-foreground", line.wrap ? "line-clamp-3 text-balance" : "truncate")}
          style={sized(plan.lines[i]?.size ?? 0, LINE.next)}
        >
          {line.text}
        </p>
      ))}
      {action}
    </div>
  );
}
