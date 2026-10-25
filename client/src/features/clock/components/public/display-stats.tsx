import type { LiveDisplayDto } from "@shared/api/live-display";
import { bigBlindsOf, formatChips, formatClock, msUntilClockMinute, type DerivedClock } from "@shared/domain/clock";
import { entriesOf } from "@/lib/entries";
import { formatNumber, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What the re-buy countdown is about: re-buys, add-ons or both, as the tournament sells them. */
export function rebuyWindowName(tournament: Pick<LiveDisplayDto["tournament"], "offersRebuys" | "offersAddons">): string | null {
  if (tournament.offersRebuys && tournament.offersAddons) return "Re-buys & add-ons";
  if (tournament.offersRebuys) return "Re-buys";
  if (tournament.offersAddons) return "Add-ons";
  return null;
}

interface Tile {
  label: string;
  value: string;
  detail?: string;
  /** Drawn larger: the figures the room looks for first. */
  lead?: boolean;
}

/** The room's figures, as tiles: players, entries, add-ons, early birds, chips and the re-buy countdown. */
export function displayTiles(display: LiveDisplayDto, derived: DerivedClock | null): Tile[] {
  const { stats, tournament } = display;
  const tiles: Tile[] = [{ label: "Players", value: `${formatNumber(stats.remaining)} / ${formatNumber(stats.entrants)}`, lead: true }];
  tiles.push({ label: "Entries", value: formatNumber(entriesOf(stats)), detail: stats.rebuys > 0 ? `incl. ${plural(stats.rebuys, "re-buy")}` : undefined });
  if (tournament.offersAddons || stats.addons > 0) tiles.push({ label: "Add-ons", value: formatNumber(stats.addons) });
  if (stats.earlyBirds > 0) tiles.push({ label: "Early birds", value: formatNumber(stats.earlyBirds) });
  if (stats.averageStack !== null) {
    const bigBlinds = bigBlindsOf(stats.averageStack, derived?.currentPlayLevel?.bigBlind ?? derived?.nextPlayLevel?.bigBlind);
    tiles.push({ label: "Average stack", value: formatChips(stats.averageStack), detail: bigBlinds !== null ? `${String(bigBlinds)} BB` : undefined, lead: true });
  }
  if (stats.totalChips !== null) tiles.push({ label: "Chips in play", value: formatChips(stats.totalChips) });
  if (stats.activeTables > 0) tiles.push({ label: "Tables", value: formatNumber(stats.activeTables) });
  const sold = rebuyWindowName(tournament);
  const left = derived && sold ? msUntilClockMinute(derived, tournament.rebuyPeriodMinutes) : null;
  if (sold && left !== null) {
    tiles.push(left > 0 ? { label: `${sold} close in`, value: formatClock(left), lead: true } : { label: sold, value: "Closed" });
  }
  return tiles;
}

interface DisplayStatsProps {
  display: LiveDisplayDto;
  derived: DerivedClock | null;
  className?: string;
}

/** The TV's figure tiles: two across on a phone or a portrait screen, a column beside the clock on a wide one. */
export function DisplayStats({ display, derived, className }: DisplayStatsProps) {
  return (
    // Sized by the screen's height as well as its width, so up to eight tiles fit one 16:9 screen.
    <dl className={cn("grid grid-cols-2 gap-[1vh] lg:grid-cols-1", className)} data-testid="display-stats">
      {displayTiles(display, derived).map((tile) => (
        <div key={tile.label} className="rounded-lg border border-border bg-card/60 px-4 py-[0.8vh]">
          <dt className="text-[clamp(0.75rem,min(1.3vw,1.9vh),1.25rem)] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">{tile.label}</dt>
          <dd
            className={cn(
              "font-bold leading-none tabular-nums text-foreground",
              tile.lead ? "text-[clamp(1.4rem,min(3.4vw,4.6vh),3.25rem)]" : "text-[clamp(1.2rem,min(2.4vw,3.4vh),2.25rem)]",
            )}
          >
            {tile.value}
            {/* After a space, so on a narrow tile "176.8 BB" moves under the figure whole rather than overflowing. */}
            {tile.detail ? (
              <>
                {" "}
                <span className="inline-block whitespace-nowrap text-[0.55em] font-semibold text-muted-foreground">{tile.detail}</span>
              </>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
