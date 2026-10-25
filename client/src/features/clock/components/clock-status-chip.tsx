import type { MouseEvent } from "react";
import { Pause, Play } from "lucide-react";
import { formatBlinds, formatClock, type DerivedClock } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DISPLAY_REFRESH_MS } from "../api";
import { useLiveClock } from "../hooks";
import { useClockActions } from "../staff-hooks";

type ChipState = "running" | "paused" | "break" | "stopped";

function chipState(derived: DerivedClock): ChipState {
  if (derived.status === "running") return derived.isBreak ? "break" : "running";
  return derived.status === "paused" ? "paused" : "stopped";
}

const STATE_WORDS: Readonly<Record<ChipState, string>> = { running: "running", paused: "paused", break: "on a break", stopped: "not running" };
const DOTS: Readonly<Record<ChipState, string>> = {
  running: "bg-status-live-foreground",
  paused: "bg-status-scheduled-foreground",
  break: "bg-status-registration-foreground",
  stopped: "bg-muted-foreground",
};

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
  const state = chipState(derived);
  const quickToggle = display.viewer.canControl && (derived.status === "running" || derived.status === "paused");
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="outline" size="sm" className="tabular-nums" onClick={(event) => onOpen({ focus: chipTapFocuses(event) })} data-testid="clock-status-chip">
        <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOTS[state], state === "running" && "motion-safe:animate-pulse")} />
        <span className="sr-only">Clock, {STATE_WORDS[state]}:</span>
        <span>{chipText(derived)}</span>
      </Button>
      {quickToggle ? <QuickToggle tournamentId={tournamentId} derived={derived} /> : null}
    </span>
  );
}

/** Pause or Resume, sent with the status on screen: a tap on a clock someone else just paused does nothing. */
function QuickToggle({ tournamentId, derived }: { tournamentId: string; derived: DerivedClock }) {
  const { send, busy } = useClockActions(tournamentId);
  const running = derived.status === "running";
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={running ? "Pause the clock" : "Resume the clock"}
      busy={busy.has("toggle")}
      onClick={() => void send({ action: "toggle", alsoStartTournament: false }, { levelIndex: derived.levelIndex, status: derived.status })}
      data-testid="clock-quick-toggle"
    >
      {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </Button>
  );
}
