import { useEffect, useRef, useState } from "react";
import { Armchair, Keyboard, Trophy } from "lucide-react";
import type { ClockDisplaySettings, ClockUndoDto } from "@shared/api/clock";
import { CLOCK_LIMITS, type DerivedClock } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { cn } from "@/lib/utils";
import { ClockActionButtons } from "./clock-action-buttons";
import type { ScreenTools } from "./public/clock-screen";
import { keepFocusOnMouseDown } from "./public/keep-focus";
import { useEscapeLock } from "./public/use-screen";
import { useClockActions, useClockConfig, useUndoOffer, type ClockIntent } from "../staff-hooks";

/** A held or bounced arrow key moves one level, not several; a bounced U undoes once, never undoes then redoes. */
export const LEVEL_KEY_DEBOUNCE_MS = 600;

const SHORTCUTS_BEFORE_ESC: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: "Space", does: "Start, pause or resume" },
  { keys: "→ or N", does: "Next level" },
  { keys: "← or P", does: "Previous level" },
  { keys: "↑ or +", does: "Add a minute" },
  { keys: "↓ or −", does: "Take a minute off" },
  { keys: "Shift + ↑ / ↓", does: "Add or take off five minutes" },
  { keys: "U", does: `Undo the last change, for ${String(CLOCK_LIMITS.undoWindowMs / 60_000)} minutes (again: redo it)` },
  { keys: "S", does: "Show everyone's seat over the clock, or take it down" },
  { keys: "$", does: "Show the payouts over the clock, or take them down" },
];

const SHORTCUTS_AFTER_ESC: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: "F", does: "Full screen" },
  { keys: "M", does: "Sound on or off" },
  { keys: "?", does: "These shortcuts" },
];

/**
 * The TV's keyboard, as the help lists it. Esc is promised in full screen only where the page can
 * keep it there (`escapeInFullscreen`, Keyboard Lock); elsewhere the browser keeps Esc for leaving full
 * screen, and S or $ take a layer down (TDN4-TV-ESC-FULLSCREEN).
 */
export function shortcutList(escapeInFullscreen: boolean): ReadonlyArray<{ keys: string; does: string }> {
  return [
    ...SHORTCUTS_BEFORE_ESC,
    {
      keys: "Esc",
      does: escapeInFullscreen
        ? "Take the seats or the payouts down: back to the clock (with nothing up, leave full screen)"
        : "Take the seats or the payouts down: back to the clock (not in full screen, where Esc leaves it: press S or $ again)",
    },
    ...SHORTCUTS_AFTER_ESC,
  ];
}

/** A layer over the clock, as the TV's settings name it. */
type Layer = ClockDisplaySettings["overlay"];

/**
 * A key that changes the clock (`debounce` names the keys one press of which a bounce must not repeat),
 * one that puts a layer up or takes it down (`layer`: "none" for Esc), or one for this screen alone.
 */
type Shortcut = { intent: ClockIntent; debounce?: "level" | "undo" } | { layer: Layer } | "fullscreen" | "mute" | "help";

/** The layer a layer key leaves on the TV: its own, or none when it is already up. */
const layerAfter = (shown: Layer, pressed: Layer): Layer => (pressed === "none" || shown === pressed ? "none" : pressed);

/** What a key press asks for, or null for a key the clock does not use. */
export function shortcutFor(event: Pick<KeyboardEvent, "key" | "shiftKey">, alsoStartTournament: boolean): Shortcut | null {
  const minutes = event.shiftKey ? 5 : 1;
  switch (event.key) {
    case " ":
      return { intent: { action: "toggle", alsoStartTournament } };
    case "ArrowRight":
    case "n":
    case "N":
      return { intent: { action: "next" }, debounce: "level" };
    case "ArrowLeft":
    case "p":
    case "P":
      return { intent: { action: "prev" }, debounce: "level" };
    case "ArrowUp":
      return { intent: { action: "adjust", deltaSeconds: minutes * 60 } };
    case "+":
    case "=":
      return { intent: { action: "adjust", deltaSeconds: 60 } };
    case "ArrowDown":
      return { intent: { action: "adjust", deltaSeconds: -minutes * 60 } };
    case "-":
    case "−":
    case "_":
      return { intent: { action: "adjust", deltaSeconds: -60 } };
    case "u":
    case "U":
      return { intent: { action: "undo" }, debounce: "undo" };
    case "s":
    case "S":
      return { layer: "seating" };
    case "$":
      return { layer: "payouts" };
    case "Escape":
      return { layer: "none" };
    case "f":
    case "F":
      return "fullscreen";
    case "m":
    case "M":
      return "mute";
    case "?":
      return "help";
    default:
      return null;
  }
}

/**
 * Typing in a box, or pressing keys in a dialog, is not a clock shortcut. Anywhere else Space is Start /
 * Pause, even with a button focused: the room's screen must pause on Space whatever was clicked last
 * (P4REV0-TV-SPACE-FOCUS); Enter still presses a focused button.
 */
function belongsToTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [role='dialog']") !== null;
}

interface DisplayControlsProps {
  tournamentId: string;
  derived: DerivedClock;
  /** The clock's undo as the display has it (ClockDto.undo). */
  undo: ClockUndoDto | null;
  /** The layer over the clock now (ClockDto.displaySettings.overlay). */
  overlay: Layer;
  tools: ScreenTools;
}

/**
 * The club's staff controls on the TV (loaded only for them): the keyboard shortcuts, a control bar
 * that shows while the pointer moves, and the list of shortcuts. Every action carries the level and
 * status this screen shows, so a repeated key never skips a level, and Undo the undo it shows, so a
 * second U, or a U after the TD's phone undid, never puts the change back. The seats and the payouts
 * go up and come down from here too (S, $, Esc, or the bar), not only from the Clock tab: a layer left
 * up covers the countdown and the QR code (TDN3-OVERLAY-STUCK).
 */
export function DisplayControls({ tournamentId, derived, undo: stored, overlay, tools }: DisplayControlsProps) {
  const { toast } = useToast();
  const { send, busy } = useClockActions(tournamentId);
  const { patchDisplay } = useClockConfig(tournamentId);
  const [helpOpen, setHelpOpen] = useState(false);
  const escapeInFullscreen = useEscapeLock(tools.fullscreen.active);
  const undo = useUndoOffer(stored, derived.levelIndex);
  // Starting from the TV starts a tournament that has not begun; a resume never reopens anything.
  const alsoStartTournament = derived.status === "idle";
  const act = (intent: ClockIntent) => void send(intent, { levelIndex: derived.levelIndex, status: derived.status, undo });
  // The layer asked for by name, never "the other one": a second press before the answer asks for the same.
  const showLayer = (pressed: Layer) =>
    void patchDisplay
      .mutateAsync({ overlay: layerAfter(overlay, pressed) })
      .catch((error: unknown) => toast({ title: "Could not change the TV display", description: errorMessage(error), variant: "destructive" }));

  const latest = useRef({ act, showLayer, overlay, tools, alsoStartTournament, busy });
  useEffect(() => {
    latest.current = { act, showLayer, overlay, tools, alsoStartTournament, busy };
  });

  useEffect(() => {
    const lastPress = { level: Number.NEGATIVE_INFINITY, undo: Number.NEGATIVE_INFINITY };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || belongsToTarget(event.target)) return;
      const current = latest.current;
      const shortcut = shortcutFor(event, current.alsoStartTournament);
      if (shortcut === null) return;
      if (typeof shortcut === "object" && "layer" in shortcut && shortcut.layer === "none" && current.overlay === "none") {
        // Esc with nothing up leaves full screen: the browser's own Esc, unless the page holds Esc there (useEscapeLock).
        if (!current.tools.fullscreen.active) return;
        event.preventDefault();
        current.tools.fullscreen.toggle();
        return;
      }
      event.preventDefault();
      if (typeof shortcut === "object" && "layer" in shortcut) current.showLayer(shortcut.layer);
      else if (shortcut === "fullscreen") current.tools.fullscreen.toggle();
      else if (shortcut === "mute") current.tools.sound.toggle();
      else if (shortcut === "help") setHelpOpen(true);
      else {
        // U while an undo is on its way does nothing, as the busy Undo button would: it would be a redo.
        if (shortcut.intent.action === "undo" && current.busy.has("undo")) return;
        if (shortcut.debounce) {
          const now = performance.now();
          if (now - lastPress[shortcut.debounce] < LEVEL_KEY_DEBOUNCE_MS) return;
          lastPress[shortcut.debounce] = now;
        }
        current.act(shortcut.intent);
      }
    };
    // A focused button is pressed by Space when the key comes up (Firefox): the keydown above already toggled the clock.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " && !belongsToTarget(event.target)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <>
      {/* Shown while the pointer moves, or while a key moves focus into it: never kept up by a click's focus. */}
      <div
        role="toolbar"
        aria-label="Clock controls"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-2 border-t border-border bg-card/95 px-4 py-3 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100",
          tools.awake ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ClockActionButtons
          status={derived.status}
          busy={busy}
          onAct={act}
          alsoStartTournament={alsoStartTournament}
          undo={undo}
          layout="bar"
          extra={
            <>
              <Button
                variant={overlay === "seating" ? "secondary" : "ghost"}
                aria-pressed={overlay === "seating"}
                onMouseDown={keepFocusOnMouseDown}
                onClick={() => showLayer("seating")}
              >
                <Armchair aria-hidden="true" />
                Seats
              </Button>
              <Button
                variant={overlay === "payouts" ? "secondary" : "ghost"}
                aria-pressed={overlay === "payouts"}
                onMouseDown={keepFocusOnMouseDown}
                onClick={() => showLayer("payouts")}
              >
                <Trophy aria-hidden="true" />
                Payouts
              </Button>
              <Button variant="ghost" onMouseDown={keepFocusOnMouseDown} onClick={() => setHelpOpen(true)}>
                <Keyboard aria-hidden="true" />
                Shortcuts
              </Button>
            </>
          }
        />
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Only the club&apos;s staff can control the clock from this screen.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {shortcutList(escapeInFullscreen).map((shortcut) => (
              <div key={shortcut.keys} className="contents">
                <dt className="font-mono font-semibold text-foreground">{shortcut.keys}</dt>
                <dd className="text-muted-foreground">{shortcut.does}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
