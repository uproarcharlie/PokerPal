import { useEffect, useId, useRef, useState } from "react";
import type { ClockDto } from "@shared/api/clock";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { CLOCK_LIMITS, type DerivedClock } from "@shared/domain/clock";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/hooks/use-toast";
import { hasErrorCode } from "@/lib/api/http";
import { levelOption } from "../structure-form";
import { clockAfterRefusal, useClockActions, useClockConfig, useUndoOffer, type ClockIntent } from "../staff-hooks";
import { ClockActionButtons } from "./clock-action-buttons";
import type { ClockOpenRequest } from "./clock-status-chip";
import { periodName } from "./public/clock-face";
import { SetTimeDialog, type SetTimeLevel } from "./set-time-dialog";

type ControlDialog = "reset" | "remove";

const levelShown = (derived: DerivedClock): SetTimeLevel => ({ levelIndex: derived.levelIndex, levelName: periodName(derived) });

interface ClockControlsProps {
  tournament: TournamentDetailDto;
  clock: ClockDto;
  derived: DerivedClock;
  /**
   * The header chip's last "open the clock" tap: each brings Start / Pause into view, so on a phone the
   * TD's pause is one tap away, not a scroll below the fold, and focuses it when asked (a tap from the
   * keyboard or a finger, never a mouse: TDN2-CHIP-FOCUS-SPACE).
   */
  openRequest?: ClockOpenRequest | null;
}

const UNDO_MINUTES = CLOCK_LIMITS.undoWindowMs / 60_000;

/**
 * The TD's clock controls: previous, start / pause / resume, next, a minute either way, undo, set the
 * time, jump to a level, and (asked first) reset or remove. Each sends the level and status on screen;
 * Set time sends the level it was opened for, so a level that ends while the TD types is refused.
 */
export function ClockControls({ tournament, clock, derived, openRequest = null }: ClockControlsProps) {
  const { toast } = useToast();
  const { send, perform, busy } = useClockActions(tournament.id);
  const { remove } = useClockConfig(tournament.id);
  const [dialog, setDialog] = useState<ControlDialog | null>(null);
  const [timeFor, setTimeFor] = useState<SetTimeLevel | null>(null);
  const [alsoStart, setAlsoStart] = useState(true);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const alsoStartId = useId();
  const jumpId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!openRequest) return;
    // After the tab it is on is shown: a hidden control can be neither scrolled to nor focused.
    const frame = requestAnimationFrame(() => {
      toggle.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (openRequest.focus) toggle.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [openRequest]);

  const undo = useUndoOffer(clock.undo, derived.levelIndex);
  const shown = { levelIndex: derived.levelIndex, status: derived.status, undo };
  const act = (intent: ClockIntent) => send(intent, shown);
  const finished = derived.status === "finished";
  const running = derived.status === "running";
  // The tournament can be started with the clock while it has not begun (spec D8).
  const startable = tournament.status === "scheduled" || tournament.status === "registration";
  const alsoStartTournament = startable && alsoStart;
  const levels = clock.structure.levels;
  // The level chosen is followed by its id, so a structure edit that moves rows (a poll from another
  // device) keeps the box on the same level rather than on whatever row now has its place (P4REV1-R2-03).
  const chosenIndex = jumpTo === null ? -1 : levels.findIndex((level) => level.id === jumpTo);
  const jumpIndex = chosenIndex === -1 ? derived.levelIndex : chosenIndex;

  const setTime = async (remainingSeconds: number) => {
    if (!timeFor) return;
    try {
      await perform({ action: "set_remaining", remainingSeconds }, { levelIndex: timeFor.levelIndex, status: derived.status });
    } catch (error) {
      // The level ended while the TD typed: the dialog now names the level on screen, and a second Set applies to it.
      const now = hasErrorCode(error, "LEVEL_CHANGED") ? clockAfterRefusal(error) : null;
      if (now) setTimeFor(levelShown(now));
      throw error;
    }
  };

  const removeClock = async () => {
    await remove.mutateAsync();
    toast({ title: "Clock removed", description: "Set it up again from a preset, the generator or an earlier game." });
  };

  return (
    <div className="space-y-4">
      <ClockActionButtons
        status={derived.status}
        busy={busy}
        onAct={(intent) => void act(intent)}
        alsoStartTournament={alsoStartTournament}
        undo={undo}
        layout="panel"
        toggleRef={toggle}
        extra={
          <Button variant="outline" onClick={() => setTimeFor(levelShown(derived))} disabled={finished}>
            Set time…
          </Button>
        }
      />

      {startable && !running && !finished ? (
        <div className="flex items-center gap-3">
          <Checkbox id={alsoStartId} checked={alsoStart} onCheckedChange={(checked) => setAlsoStart(checked === true)} />
          <Label htmlFor={alsoStartId} className="font-normal">
            Also start the tournament (status In Progress)
          </Label>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={jumpId}>Jump to level</Label>
          <NativeSelect id={jumpId} value={levels[jumpIndex]?.id ?? ""} onChange={(event) => setJumpTo(event.target.value)} disabled={finished}>
            {levels.map((level, index) => (
              <option key={level.id} value={level.id}>
                {levelOption(levels, index)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          busy={busy.has("jump")}
          disabled={finished}
          onClick={() => void act({ action: "jump", levelIndex: jumpIndex }).then((done) => done && setJumpTo(null))}
        >
          Go to level
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={() => setDialog("reset")} disabled={finished}>
          Reset clock…
        </Button>
        <Button variant="outline" className="text-destructive" onClick={() => setDialog("remove")}>
          Remove clock…
        </Button>
      </div>

      <SetTimeDialog
        level={timeFor}
        onClose={() => setTimeFor(null)}
        remainingMs={derived.remainingMs}
        busy={busy.has("set_remaining")}
        onSet={setTime}
      />
      <ConfirmDialog
        open={dialog === "reset"}
        onOpenChange={(open) => setDialog(open ? "reset" : null)}
        title="Reset the clock?"
        description={`It goes back to the start of the first level, stopped. For ${String(UNDO_MINUTES)} minutes, Undo brings it back to where it is now.`}
        confirmLabel="Reset clock"
        pendingLabel="Resetting…"
        // Refused, the dialog stays open with the server's reason, like Remove.
        onConfirm={() => perform({ action: "reset" }, shown)}
      />
      <ConfirmDialog
        open={dialog === "remove"}
        onOpenChange={(open) => setDialog(open ? "remove" : null)}
        title="Remove the clock?"
        description="The structure and the clock's place are deleted, and the TV display shows that the clock is not set up. This cannot be undone."
        confirmLabel="Remove clock"
        pendingLabel="Removing…"
        destructive
        onConfirm={removeClock}
      />
    </div>
  );
}
