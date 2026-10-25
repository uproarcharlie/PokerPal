import { memo, useId } from "react";
import { Volume2 } from "lucide-react";
import type { ClockDisplaySettings, ClockDisplaySettingsPatch } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { useClockConfig } from "../staff-hooks";
import { PanelCard } from "./panel-card";
import { CUE_SWITCHES, EdgeMarginChoice, useVolumeDraft, VolumeSlider } from "./public/screen-settings";
import { playTestSounds } from "./public/use-clock-sound";

const PRIZE_POOL_CHOICES: ReadonlyArray<[ClockDisplaySettings["showPrizePool"], string]> = [
  ["when_locked", "Once the pool is locked"],
  ["always", "Always (marked est. until locked)"],
  ["never", "Never"],
];

const QR_CHOICES: ReadonlyArray<[ClockDisplaySettings["qrTarget"], string]> = [
  ["season", "The season leaderboard"],
  ["tournament", "This tournament's page"],
  ["seats", "Find your seat"],
  ["none", "No QR code"],
];

const OVERLAY_CHOICES: ReadonlyArray<[ClockDisplaySettings["overlay"], string]> = [
  ["none", "Nothing: the clock"],
  ["seating", "Everyone's seat"],
  ["payouts", "The payouts"],
];

/**
 * Where the TV's QR code leads now, in words. The season choice falls back to the tournament's page
 * when there is no season: only then is the missing season named (P4REV4-CQ-08).
 */
export function qrDestination(display: Pick<LiveDisplayDto, "qr" | "season">, chosen: ClockDisplaySettings["qrTarget"]): string {
  const { qr, season } = display;
  if (!qr) return "The TV shows no QR code.";
  if (qr.target === "season" && season) return `The QR code opens the ${season.name} leaderboard.`;
  if (qr.target === "seats") return "The QR code opens the seat finder.";
  return chosen === "season" ? "The QR code opens this tournament's live results (it has no season)." : "The QR code opens this tournament's live results.";
}

/**
 * What "Always" does not change: the TV shows the estimated pool and places before the lock, but the
 * tournament's public page (where the QR code can lead) still waits for the lock (P4REV2R3-MONEY-02).
 * Null once the pool is locked, or for any other choice.
 */
export function publicPoolNote(showPrizePool: ClockDisplaySettings["showPrizePool"], poolLocked: boolean): string | null {
  return showPrizePool === "always" && !poolLocked
    ? "The TV shows the estimate now; the tournament's public page shows the prize pool and the prizes once the pool is locked."
    : null;
}

type Choice<T> = ReadonlyArray<[T, string]>;

/** The settings that are switched on or off. */
type Toggle = { [K in keyof ClockDisplaySettings]: ClockDisplaySettings[K] extends boolean ? K : never }[keyof ClockDisplaySettings];

/** The TV's figures beyond the core set, each off until switched on (round 5, items 21, 25 and 26). */
const FIGURE_SWITCHES: ReadonlyArray<{ field: Toggle; label: string }> = [
  { field: "showLevel", label: "Level number (LEVEL 3)" },
  { field: "showEntries", label: "Entries" },
  { field: "showRebuys", label: "Re-buys" },
  { field: "showAddons", label: "Add-ons" },
  { field: "showEarlyBirds", label: "Early birds" },
  { field: "showChipsInPlay", label: "Chips in play" },
  { field: "showTables", label: "Tables" },
  { field: "showRebuyWindow", label: "Time left to re-buy (Re-buys close in …)" },
];

interface SettingsCardProps extends Pick<LiveDisplayDto, "qr" | "season"> {
  tournamentId: string;
  settings: ClockDisplaySettings;
  /** The club's name for its take ("AP"). */
  rakeLabel: string;
  /** The prize pool is locked: every screen shows it. */
  poolLocked: boolean;
  /** In a sheet of its own (a phone's Clock tab). */
  bare?: boolean;
}

/**
 * What the TV clock shows and plays, changed at once (no Save) and remembered for this tournament: the
 * prize pool and payouts, the club's take, a layer over the clock (the seats after a draw, the payouts
 * at the bubble), the figures beyond the core set (each off until switched on), where the QR code
 * leads, the sounds (how loud, which, and a test on this device) and the edge margin for a TV that
 * crops the picture's edges. Every screen showing the clock follows within a few seconds.
 */
export const DisplaySettingsCard = memo(function DisplaySettingsCard({ tournamentId, settings, rakeLabel, poolLocked, qr, season, bare = false }: SettingsCardProps) {
  const { toast } = useToast();
  const { patchDisplay } = useClockConfig(tournamentId);
  const { busy, run } = useBusyRows();
  const id = useId();
  const save = (patch: ClockDisplaySettingsPatch): Promise<boolean> => {
    const [field] = Object.keys(patch);
    return run(field, () => patchDisplay.mutateAsync(patch)).then(
      () => true,
      (error: unknown) => {
        toast({ title: "Could not change the TV display", description: errorMessage(error), variant: "destructive" });
        return false;
      },
    );
  };
  const change = (patch: ClockDisplaySettingsPatch) => void save(patch);
  const volume = useVolumeDraft(settings.soundVolume, save);

  const select = <K extends "showPrizePool" | "qrTarget" | "overlay">(field: K, label: string, choices: Choice<ClockDisplaySettings[K]>) => (
    <div className="space-y-2">
      <Label htmlFor={`${id}-${field}`}>{label}</Label>
      <NativeSelect
        id={`${id}-${field}`}
        value={settings[field]}
        aria-busy={busy.has(field) || undefined}
        onChange={(event) => change({ [field]: event.target.value } as ClockDisplaySettingsPatch)}
      >
        {choices.map(([value, words]) => (
          <option key={value} value={value}>
            {words}
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  const toggle = (field: Toggle, label: string) => (
    <div key={field} className="flex min-h-11 items-center justify-between gap-4">
      <Label htmlFor={`${id}-${field}`} className="min-w-0">
        {label}
      </Label>
      <Switch
        id={`${id}-${field}`}
        checked={settings[field]}
        aria-busy={busy.has(field) || undefined}
        onCheckedChange={(checked) => change({ [field]: checked } as ClockDisplaySettingsPatch)}
      />
    </div>
  );

  return (
    <PanelCard title="TV display" description={bare ? undefined : "Changes show on the TV within a few seconds."} bare={bare} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          {select("showPrizePool", "Show the prize pool", PRIZE_POOL_CHOICES)}
          {publicPoolNote(settings.showPrizePool, poolLocked) ? (
            <p className="text-sm text-muted-foreground" data-testid="public-pool-note">
              {publicPoolNote(settings.showPrizePool, poolLocked)}
            </p>
          ) : null}
        </div>
        {select("overlay", "Over the clock", OVERLAY_CHOICES)}
      </div>
      <div className="space-y-1">
        {toggle("showPayouts", "Show the payouts with the pool")}
        {toggle("showAp", `Show the ${rakeLabel}`)}
        {toggle("showAverageStack", "Show the average stack")}
      </div>
      <fieldset className="space-y-1 border-t border-border pt-4" data-testid="tv-figures">
        <legend className="text-sm font-medium text-foreground">More on the TV</legend>
        <p className="text-sm text-muted-foreground">
          The TV always shows the countdown, the blinds and ante, what comes next, the time to the break and the players left. Switch on anything else
          the room should see.
        </p>
        {FIGURE_SWITCHES.map(({ field, label }) => toggle(field, label))}
      </fieldset>
      <div className="space-y-2">
        {select("qrTarget", "The QR code leads to", QR_CHOICES)}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {qrDestination({ qr, season }, settings.qrTarget)}
        </p>
      </div>
      <fieldset className="space-y-3 border-t border-border pt-4" data-testid="tv-sounds">
        <legend className="text-sm font-medium text-foreground">Sounds</legend>
        <VolumeSlider id={`${id}-volume`} volume={volume.volume} onChange={volume.change} />
        <div className="space-y-1">
          {CUE_SWITCHES.map(({ setting, label }) => toggle(setting, label))}
        </div>
        <Button type="button" variant="outline" className="h-11" onClick={() => playTestSounds(volume.volume)}>
          <Volume2 aria-hidden="true" />
          Test sounds on this device
        </Button>
      </fieldset>
      <section aria-labelledby={`${id}-edge`} className="space-y-3 border-t border-border pt-4">
        <h3 id={`${id}-edge`} className="text-sm font-medium text-foreground">
          Edge margin (TV overscan)
        </h3>
        <p className="text-sm text-muted-foreground">Many TVs cut off the edges of the picture. A margin keeps everything on screen.</p>
        <EdgeMarginChoice id={`${id}-edge-margin`} labelledBy={`${id}-edge`} margin={settings.edgeMargin} onChange={(edgeMargin) => change({ edgeMargin })} />
      </section>
    </PanelCard>
  );
});
