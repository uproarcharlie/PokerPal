import { useEffect, useId, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import type { ClockDisplaySettingsPatch } from "@shared/api/clock";
import { EDGE_MARGINS, type EdgeMargin } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { CueSettings } from "./clock-cues";
import type { ScreenPrefs } from "./screen-prefs";
import type { ClockSound } from "./use-clock-sound";

type CueSetting = "soundMinute" | "soundCountdown" | "soundLevel" | "soundBreak";

/** Each sound's switch: the cue it is under on the screen, the display setting it is saved as. */
export const CUE_SWITCHES: ReadonlyArray<{ cue: keyof CueSettings; setting: CueSetting; label: string }> = [
  { cue: "minute", setting: "soundMinute", label: "One minute left (alarm)" },
  { cue: "countdown", setting: "soundCountdown", label: "The last 10 seconds (beeps)" },
  { cue: "level", setting: "soundLevel", label: "A new level (blinds up)" },
  { cue: "break", setting: "soundBreak", label: "A break starting and ending" },
];

/** "None", "2.5%", "5%". */
export const edgeMarginLabel = (margin: EdgeMargin) => (margin === 0 ? "None" : `${String(margin)}%`);

/** The next edge margin, round and round (the TV's E key). */
export const nextEdgeMargin = (margin: EdgeMargin): EdgeMargin => EDGE_MARGINS[(EDGE_MARGINS.indexOf(margin) + 1) % EDGE_MARGINS.length];

/** Saves a change to the clock's display settings; resolves false when it was refused (the caller has said why). */
export type SaveDisplaySettings = (patch: ClockDisplaySettingsPatch) => Promise<boolean>;

/** How long the volume slider rests before its volume is saved: one save for a drag, not one per step. */
export const VOLUME_SAVE_MS = 400;

/**
 * A volume slider's value while it moves: shown at once, saved once it rests (and when the slider goes
 * away first, so closing the dialog straight after keeps the choice). A refused save shows the saved
 * volume again; once the new one is saved, the saved one is shown.
 */
export function useVolumeDraft(saved: number, save: SaveDisplaySettings | null): { volume: number; change: (volume: number) => void } {
  const [draft, setDraft] = useState<{ volume: number; over: number } | null>(null);
  const latest = useRef(save);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    latest.current = save;
  });
  const current = draft !== null && draft.over === saved ? draft : null;

  useEffect(() => {
    if (current === null || current.volume === saved) return;
    const send = () => {
      pending.current = null;
      void latest.current?.({ soundVolume: current.volume }).then((done) => {
        if (!done) setDraft(null);
      });
    };
    pending.current = send;
    const timer = setTimeout(send, VOLUME_SAVE_MS);
    return () => clearTimeout(timer);
  }, [current, saved]);
  useEffect(() => {
    const unsaved = pending;
    return () => unsaved.current?.();
  }, []);

  return { volume: current?.volume ?? saved, change: (volume) => setDraft({ volume, over: saved }) };
}

interface VolumeSliderProps {
  id: string;
  /** 0–1. */
  volume: number;
  /** Null: shown, not changed here. */
  onChange: ((volume: number) => void) | null;
}

/** The TV's volume in 5% steps, a thumb's height to drag. */
export function VolumeSlider({ id, volume, onChange }: VolumeSliderProps) {
  const percent = Math.round(volume * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id}>Volume</Label>
        <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        disabled={onChange === null}
        onChange={(event) => onChange?.(Number(event.target.value) / 100)}
        className="h-11 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}

interface ScreenSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tournament's settings, as this screen plays and shows them. */
  prefs: ScreenPrefs;
  /** Saves a change for the tournament (the club's staff at this screen); null: shown, not changed here. */
  onChange: SaveDisplaySettings | null;
  sound: ClockSound;
  /** A phone or a tablet: it keeps no edge margin, whatever the TV's. */
  handheld: boolean;
}

/**
 * The TV's sound and edge margin, for whoever stands at it: the sound on or off on this screen, and a
 * test of every sound; then the tournament's own settings, changed here by the club's staff (saved for
 * every screen showing the clock, as the Clock tab's TV settings are) or shown to anyone else.
 */
export function ScreenSettingsDialog({ open, onOpenChange, prefs, onChange, sound, handheld }: ScreenSettingsDialogProps) {
  const id = useId();
  const draft = useVolumeDraft(prefs.volume, onChange);
  const locked = onChange === null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sound and edge margin</DialogTitle>
          <DialogDescription>
            {locked
              ? "Set for this tournament by the club's staff, on the Clock tab's TV display settings. Muting is this screen's own."
              : "Saved for this tournament: every screen showing its clock follows. Muting is this screen's own."}
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby={`${id}-sound`} className="space-y-4">
          <h3 id={`${id}-sound`} className="text-base font-semibold text-foreground">
            Sound
          </h3>
          {sound.supported ? (
            <>
              <div className="flex min-h-11 items-center justify-between gap-4">
                <Label htmlFor={`${id}-on`}>Sounds on this screen</Label>
                <Switch id={`${id}-on`} checked={sound.on} onCheckedChange={sound.toggle} />
              </div>
              <VolumeSlider id={`${id}-volume`} volume={draft.volume} onChange={locked ? null : draft.change} />
              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => sound.test(draft.volume)}>
                <Volume2 aria-hidden="true" />
                Test sounds
              </Button>
              <fieldset className="space-y-1" disabled={locked}>
                <legend className="mb-1 text-sm font-medium text-foreground">Play a sound for</legend>
                {CUE_SWITCHES.map(({ cue, setting, label }) => (
                  <div key={setting} className="flex min-h-11 items-center justify-between gap-4">
                    <Label htmlFor={`${id}-${setting}`} className="font-normal">
                      {label}
                    </Label>
                    <Switch
                      id={`${id}-${setting}`}
                      checked={prefs.cues[cue]}
                      disabled={locked}
                      onCheckedChange={(checked) => void onChange?.({ [setting]: checked } as ClockDisplaySettingsPatch)}
                    />
                  </div>
                ))}
              </fieldset>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">This browser cannot play sounds.</p>
          )}
        </section>

        <section aria-labelledby={`${id}-edge`} className="space-y-3">
          <h3 id={`${id}-edge`} className="text-base font-semibold text-foreground">
            Edge margin (TV overscan)
          </h3>
          <p className="text-sm text-muted-foreground">
            Many TVs cut off the edges of the picture. A margin keeps everything on screen.
            {handheld ? " This screen keeps none: a phone or a tablet shows the whole picture." : null}
          </p>
          <EdgeMarginChoice id={`${id}-edge-margin`} labelledBy={`${id}-edge`} margin={prefs.edgeMargin} onChange={locked ? null : (edgeMargin) => void onChange({ edgeMargin })} />
        </section>
      </DialogContent>
    </Dialog>
  );
}

interface EdgeMarginChoiceProps {
  id: string;
  /** The heading that names the choice. */
  labelledBy: string;
  margin: EdgeMargin;
  /** Null: shown, not changed here. */
  onChange: ((margin: EdgeMargin) => void) | null;
  className?: string;
}

/** None, 2.5% or 5%, each a thumb-sized choice. */
export function EdgeMarginChoice({ id, labelledBy, margin, onChange, className }: EdgeMarginChoiceProps) {
  return (
    <RadioGroup
      value={String(margin)}
      onValueChange={(value) => onChange?.(Number(value) as EdgeMargin)}
      disabled={onChange === null}
      className={cn("grid grid-cols-3 gap-2", className)}
      aria-labelledby={labelledBy}
    >
      {EDGE_MARGINS.map((each) => (
        <Label
          key={each}
          htmlFor={`${id}-${String(each)}`}
          className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 font-normal has-[[data-state=checked]]:border-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70"
        >
          <RadioGroupItem id={`${id}-${String(each)}`} value={String(each)} />
          {edgeMarginLabel(each)}
        </Label>
      ))}
    </RadioGroup>
  );
}
