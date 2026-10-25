import type { ReactNode, Ref } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Redo2, Undo2 } from "lucide-react";
import type { ClockUndoDto } from "@shared/api/clock";
import type { ClockStatus } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import type { ClockIntent } from "../staff-hooks";
import { keepFocusOnMouseDown } from "./public/keep-focus";

/** What the start / pause / resume button does next. */
export function toggleLabel(status: ClockStatus): "Pause" | "Resume" | "Start" {
  if (status === "running") return "Pause";
  return status === "paused" ? "Resume" : "Start";
}

/**
 * What Undo does, as its button says it: "Undo: Moved to Level 5 (600/1,200)", "Redo: …" once that was
 * undone (pressing it again puts the change back), or "Undo" with nothing to undo.
 */
export function undoLabel(undo: Pick<ClockUndoDto, "redo" | "description"> | null): string {
  if (!undo) return "Undo";
  return `${undo.redo ? "Redo" : "Undo"}: ${undo.description}`;
}

/** The TD panel's three main buttons: the icon over the word on a phone, beside it from `sm`. */
const BIG = "h-14 flex-col gap-0.5 px-2 sm:h-12 sm:flex-row sm:gap-2";

interface ClockActionButtonsProps {
  status: ClockStatus;
  /** The actions whose request is on its way (useClockActions' `busy`). */
  busy: ReadonlySet<string>;
  onAct: (intent: ClockIntent) => void;
  /** Whether starting the clock also starts the tournament. */
  alsoStartTournament: boolean;
  /** What Undo would take back (or put back) now (useUndoOffer); null greys it out. */
  undo: ClockUndoDto | null;
  /** The Clock tab's big buttons on a grid, or the TV's one-row bar (whose buttons never take focus from a click). */
  layout: "panel" | "bar";
  /** The panel's Set time… (before Undo), the bar's Shortcuts (after it). */
  extra?: ReactNode;
  /** Start / Pause, for a page that brings it into view. */
  toggleRef?: Ref<HTMLButtonElement>;
}

/**
 * The clock's controls, one set for the Clock tab and the TV's staff bar: previous, start / pause /
 * resume, next, a minute either way, and undo, which names the change it takes back. Each button is
 * busy while its own request runs; none works on a finished clock.
 */
export function ClockActionButtons({ status, busy, onAct, alsoStartTournament, undo, layout, extra, toggleRef }: ClockActionButtonsProps) {
  const panel = layout === "panel";
  const finished = status === "finished";
  const press = (action: ClockIntent["action"]) => ({ busy: busy.has(action), onMouseDown: panel ? undefined : keepFocusOnMouseDown });

  const previous = (
    <Button variant="outline" className={panel ? BIG : undefined} onClick={() => onAct({ action: "prev" })} disabled={finished} {...press("prev")}>
      <ChevronLeft aria-hidden="true" />
      {panel ? "Previous" : "Previous level"}
    </Button>
  );
  const toggle = (
    <Button
      ref={toggleRef}
      className={panel ? BIG : "min-w-28"}
      onClick={() => onAct({ action: "toggle", alsoStartTournament })}
      disabled={finished}
      {...press("toggle")}
    >
      {status === "running" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      {toggleLabel(status)}
    </Button>
  );
  const next = (
    <Button variant="outline" className={panel ? BIG : undefined} onClick={() => onAct({ action: "next" })} disabled={finished} {...press("next")}>
      <ChevronRight aria-hidden="true" className={panel ? "sm:order-last" : "order-last"} />
      {panel ? "Next" : "Next level"}
    </Button>
  );
  const minutes = (
    <>
      <Button variant="outline" onClick={() => onAct({ action: "adjust", deltaSeconds: -60 })} disabled={finished} {...press("adjust")}>
        −1 min
      </Button>
      <Button variant="outline" onClick={() => onAct({ action: "adjust", deltaSeconds: 60 })} disabled={finished} {...press("adjust")}>
        +1 min
      </Button>
    </>
  );
  const undoButton = (
    <Button variant="outline" className="min-w-0 max-w-full" onClick={() => onAct({ action: "undo" })} disabled={finished || !undo} {...press("undo")} data-testid="clock-undo">
      {undo?.redo ? <Redo2 aria-hidden="true" /> : <Undo2 aria-hidden="true" />}
      <span className="min-w-0 truncate">{undoLabel(undo)}</span>
    </Button>
  );

  if (!panel) {
    return (
      <>
        {previous}
        {toggle}
        {next}
        {minutes}
        {undoButton}
        {extra}
      </>
    );
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {previous}
        {toggle}
        {next}
      </div>
      <div className="flex flex-wrap gap-2">
        {minutes}
        {extra}
        {undoButton}
      </div>
    </>
  );
}
