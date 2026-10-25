import { memo, useId } from "react";
import type { ClockDisplaySettings, ClockDisplaySettingsPatch } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { useClockConfig } from "../staff-hooks";

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

interface SettingsCardProps extends Pick<LiveDisplayDto, "qr" | "season"> {
  tournamentId: string;
  settings: ClockDisplaySettings;
  /** The club's name for its take ("AP"). */
  rakeLabel: string;
  /** The prize pool is locked: every screen shows it. */
  poolLocked: boolean;
}

/**
 * What the TV clock shows, changed at once (no Save): the prize pool and payouts, the club's take,
 * the average stack, where the QR code leads, and a layer over the clock (the seats after a draw, the
 * payouts at the bubble).
 */
export const DisplaySettingsCard = memo(function DisplaySettingsCard({ tournamentId, settings, rakeLabel, poolLocked, qr, season }: SettingsCardProps) {
  const { toast } = useToast();
  const { patchDisplay } = useClockConfig(tournamentId);
  const { busy, run } = useBusyRows();
  const id = useId();
  const change = (patch: ClockDisplaySettingsPatch) => {
    const [field] = Object.keys(patch);
    void run(field, () => patchDisplay.mutateAsync(patch)).catch((error: unknown) =>
      toast({ title: "Could not change the TV display", description: errorMessage(error), variant: "destructive" }),
    );
  };

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

  const toggle = (field: "showPayouts" | "showAp" | "showAverageStack", label: string) => (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={`${id}-${field}`}>{label}</Label>
      <Switch
        id={`${id}-${field}`}
        checked={settings[field]}
        aria-busy={busy.has(field) || undefined}
        onCheckedChange={(checked) => change({ [field]: checked } as ClockDisplaySettingsPatch)}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>TV display</CardTitle>
        <CardDescription>Changes show on the TV within a few seconds.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
        <div className="space-y-3">
          {toggle("showPayouts", "Show the payouts with the pool")}
          {toggle("showAp", `Show the ${rakeLabel}`)}
          {toggle("showAverageStack", "Show the chips in play and the average stack")}
        </div>
        <div className="space-y-2">
          {select("qrTarget", "The QR code leads to", QR_CHOICES)}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {qrDestination({ qr, season }, settings.qrTarget)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
});
