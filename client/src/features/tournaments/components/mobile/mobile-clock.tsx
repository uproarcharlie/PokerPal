import { Button } from "@/components/ui/button";
import { DISPLAY_REFRESH_MS } from "@/features/clock/api";
import { chipTapFocuses, ClockStateMark, offersQuickToggle, QuickToggle, type ClockOpenRequest } from "@/features/clock/components/clock-status-chip";
import { useLiveClock } from "@/features/clock/hooks";
import { formatBlinds, formatClock } from "@shared/domain/clock";

interface MobileClockStripProps {
  tournamentId: string;
  /** A tap on the clock: the page opens its Clock tab. */
  onOpen: (request: ClockOpenRequest) => void;
}

/**
 * The phone header's clock (round5-contracts §8.1): the level, the time left in large figures and the
 * blinds, as the room's TV has them, opening the Clock tab; beside it a 44 px Pause / Resume, sent with
 * the status on screen, so a tap on a clock someone else just paused does nothing. Nothing without a
 * clock. The header chip's pieces (clock-status-chip) laid out for a thumb.
 */
export function MobileClockStrip({ tournamentId, onOpen }: MobileClockStripProps) {
  const { display, derived } = useLiveClock(tournamentId, { refetchMs: DISPLAY_REFRESH_MS.chip });
  if (!display?.clock || !derived) return null;
  const play = derived.currentPlayLevel;
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5">
      <Button
        variant="outline"
        className="h-11 min-w-0 flex-1 justify-start gap-2 px-3 tabular-nums"
        onClick={(event) => onOpen({ focus: chipTapFocuses(event) })}
        data-testid="mobile-clock"
      >
        <ClockStateMark derived={derived} />
        <span className="shrink-0 text-xs font-semibold uppercase text-muted-foreground">{play ? `L${String(derived.levelNumber)}` : "Break"}</span>
        <span className="shrink-0 text-lg font-bold text-foreground">{formatClock(derived.remainingMs)}</span>
        {play ? <span className="min-w-0 truncate text-sm text-foreground">{formatBlinds(play)}</span> : null}
      </Button>
      {offersQuickToggle(display, derived) ? <QuickToggle tournamentId={tournamentId} derived={derived} touch testId="mobile-clock-toggle" /> : null}
    </div>
  );
}
