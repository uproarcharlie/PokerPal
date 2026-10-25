import type { MouseEvent } from "react";
import { Pause, Play } from "lucide-react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { formatBlinds, formatClock, type DerivedClock } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DISPLAY_REFRESH_MS } from "../api";
import { useLiveClock } from "../hooks";
import { useClockActions } from "../staff-hooks";

type ClockState = "running" | "paused" | "break" | "stopped";

function clockState(derived: DerivedClock): ClockState {
  if (derived.status === "running") return derived.isBreak ? "break" : "running";
  return derived.status === "paused" ? "paused" : "stopped";
}

const STATE_WORDS: Readonly<Record<ClockState, string>> = { running: "running", paused: "paused", break: "on a break", stopped: "not running" };
const DOTS: Readonly<Record<ClockState, string>> = {
  running: "bg-status-live-foreground",
  paused: "bg-status-scheduled-foreground",
  break: "bg-status-registration-foreground",
  stopped: "bg-muted-foreground",
};

/**
 * The clock's state at a glance, for the header's chip and the phone header's strip: a coloured dot
 * (pulsing while it runs), and the words for a screen reader ("Clock, paused:"). One copy of the
 * wording, so the two never drift apart (R5REV3-CQ-01).
 */
export function ClockStateMark({ derived }: { derived: DerivedClock }) {
  const state = clockState(derived);
  return (
    <>
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOTS[state], state === "running" && "motion-safe:animate-pulse")} />
      <span className="sr-only">Clock, {STATE_WORDS[state]}:</span>
    </>
  );
}

/** Whether the viewer gets Pause / Resume beside the clock: the club's staff, for a clock already started. */
export const offersQuickToggle = (display: Pick<LiveDisplayDto, "viewer">, derived: DerivedClock): boolean =>
  display.viewer.canControl && (derived.status === "running" || derived.status === "paused");

/** "L6 · 12:34 · 800/1,600", or "Break · 9:59" on a break. */
export function chipText(derived: DerivedClock): string {
  const time = formatClock(derived.remainingMs);
  const play = derived.currentPlayLevel;
  return play ? `L${String(derived.levelNumber)} · ${time} · ${formatBlinds(play)}` : `Break · ${time}`;
}

/** A tap on the header's clock chip, for the Clock tab: Start / Pause is brought into view, and focused when `focus`. */
export interface ClockOpenRequest {
  focus: boolean;
}

/**
 * Whether a tap on the chip also puts focus on Start / Pause: from the keyboard (a click with no
 * pointer: `detail` 0) or a finger or pen, never a mouse. Focus a script moves after a mouse click
 * shows no ring, and Space or Enter, the keys a laptop pages down with, would then pause or resume the
 * room's clock unseen (TDN2-CHIP-FOCUS-SPACE).
 */
export function chipTapFocuses(event: Pick<MouseEvent, "detail" | "nativeEvent">): boolean {
  if (event.detail === 0) return true;
  const { pointerType } = event.nativeEvent as Partial<PointerEvent>;
  return pointerType === "touch" || pointerType === "pen";
}

/**
 * The tournament header's clock at a glance, opening the Clock tab; nothing while the tournament has no
 * clock. Beside it, for the club's staff, Pause / Resume of a clock already started: on a phone the TD
 * pauses from the top of the page, without scrolling to the Clock tab's controls (P4REV0-PHONE-PAUSE-FOLD).
 */
export function ClockStatusChip({ tournamentId, onOpen }: { tournamentId: string; onOpen: (request: ClockOpenRequest) => void }) {
  const { display, derived } = useLiveClock(tournamentId, { refetchMs: DISPLAY_REFRESH_MS.chip });
  if (!display?.clock || !derived) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="outline" size="sm" className="tabular-nums" onClick={(event) => onOpen({ focus: chipTapFocuses(event) })} data-testid="clock-status-chip">
        <ClockStateMark derived={derived} />
        <span>{chipText(derived)}</span>
      </Button>
      {offersQuickToggle(display, derived) ? <QuickToggle tournamentId={tournamentId} derived={derived} /> : null}
    </span>
  );
}

interface QuickToggleProps {
  tournamentId: string;
  derived: DerivedClock;
  /** A phone's: a 44 px thumb target, Resume drawn as the main action. */
  touch?: boolean;
  testId?: string;
}

/** Pause or Resume, sent with the status on screen: a tap on a clock someone else just paused does nothing. */
export function QuickToggle({ tournamentId, derived, touch = false, testId = "clock-quick-toggle" }: QuickToggleProps) {
  const { send, busy } = useClockActions(tournamentId);
  const running = derived.status === "running";
  return (
    <Button
      variant={touch && !running ? "default" : "outline"}
      size="icon"
      className={touch ? "h-11 w-11 shrink-0" : undefined}
      aria-label={running ? "Pause the clock" : "Resume the clock"}
      busy={busy.has("toggle")}
      onClick={() => void send({ action: "toggle", alsoStartTournament: false }, { levelIndex: derived.levelIndex, status: derived.status })}
      data-testid={testId}
    >
      {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </Button>
  );
}
