import type { ClockDisplaySettings } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { bigBlindsOf, formatChips, formatClock, msUntilClockMinute, type DerivedClock } from "@shared/domain/clock";
import { entriesOf } from "@/lib/entries";
import { formatNumber, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LINE, px, type TilePlan, type TileText } from "./screen-plan";

/** What the re-buy countdown is about: re-buys, add-ons or both, as the tournament sells them. */
export function rebuyWindowName(tournament: Pick<LiveDisplayDto["tournament"], "offersRebuys" | "offersAddons">): string | null {
  if (tournament.offersRebuys && tournament.offersAddons) return "Re-buys & add-ons";
  if (tournament.offersRebuys) return "Re-buys";
  if (tournament.offersAddons) return "Add-ons";
  return null;
}

/** The optional figures, each on the TV only once the TD switches it on (round 5, items 25 and 26). */
export type TileSettings = Pick<ClockDisplaySettings, "showRebuyWindow" | "showEntries" | "showRebuys" | "showAddons" | "showEarlyBirds" | "showChipsInPlay" | "showTables">;

/**
 * The room's figures, as tiles, in the order the screen gives them room (round 5, item 17): the
 * players left of those who entered and the average stack (the server leaves it out when the TD does),
 * then each figure the TD switched on: the re-buy countdown, the entries, re-buys, add-ons, early
 * birds, the chips in play and the tables. Every chip and dollar still counts in the average stack and
 * the pool whether its tile is shown or not.
 */
export function displayTiles(display: LiveDisplayDto, derived: DerivedClock | null, settings: TileSettings): TileText[] {
  const { stats, tournament } = display;
  const tiles: TileText[] = [{ label: "Players", value: `${formatNumber(stats.remaining)} / ${formatNumber(stats.entrants)}`, lead: true }];
  if (stats.averageStack !== null) {
    const bigBlinds = bigBlindsOf(stats.averageStack, derived?.currentPlayLevel?.bigBlind ?? derived?.nextPlayLevel?.bigBlind);
    tiles.push({ label: "Average stack", value: formatChips(stats.averageStack), detail: bigBlinds !== null ? `${String(bigBlinds)} BB` : undefined, lead: true });
  }
  const sold = rebuyWindowName(tournament);
  const left = settings.showRebuyWindow && derived && sold ? msUntilClockMinute(derived, tournament.rebuyPeriodMinutes) : null;
  if (sold && left !== null) {
    // Closed, it is named as the window, never as the count beside it ("Re-buys 6").
    tiles.push(left > 0 ? { label: `${sold} close in`, value: formatClock(left), lead: true } : { label: `${sold} window`, value: "Closed" });
  }
  if (settings.showEntries) {
    // The re-buys are named on the entries only while they have no tile of their own.
    const rebuysNamed = stats.rebuys > 0 && !settings.showRebuys;
    tiles.push({ label: "Entries", value: formatNumber(entriesOf(stats)), detail: rebuysNamed ? `incl. ${plural(stats.rebuys, "re-buy")}` : undefined });
  }
  if (settings.showRebuys && (tournament.offersRebuys || stats.rebuys > 0)) tiles.push({ label: "Re-buys", value: formatNumber(stats.rebuys) });
  if (settings.showAddons && (tournament.offersAddons || stats.addons > 0)) tiles.push({ label: "Add-ons", value: formatNumber(stats.addons) });
  if (settings.showEarlyBirds && stats.earlyBirds > 0) tiles.push({ label: "Early birds", value: formatNumber(stats.earlyBirds) });
  if (settings.showChipsInPlay && stats.totalChips !== null) tiles.push({ label: "Chips in play", value: formatChips(stats.totalChips) });
  if (settings.showTables && stats.activeTables > 0) tiles.push({ label: "Tables", value: formatNumber(stats.activeTables) });
  return tiles;
}

interface DisplayStatsProps {
  tiles: readonly TileText[];
  /** The screen plan's tiles: how many fit, and their sizes. */
  plan: TilePlan;
  className?: string;
}

/** The TV's figure tiles, as many as the screen has room for, in their order: a column beside the clock, or rows of two under it. */
export function DisplayStats({ tiles, plan, className }: DisplayStatsProps) {
  if (plan.shown === 0) return null;
  return (
    <dl
      className={cn("grid content-start", className)}
      style={{ gridTemplateColumns: `repeat(${String(plan.columns)}, minmax(0, 1fr))`, gap: px(plan.gap) }}
      data-testid="display-stats"
    >
      {tiles.slice(0, plan.shown).map((tile, i) => (
        <div key={tile.label} className="min-w-0 rounded-lg border border-border bg-card/60" style={{ padding: `${px(plan.padY)} ${px(plan.padX)}` }}>
          <dt className="line-clamp-2 break-words font-bold uppercase tracking-wider text-muted-foreground" style={{ fontSize: px(plan.label), lineHeight: LINE.label }}>
            {tile.label}
          </dt>
          <dd className="truncate font-extrabold tabular-nums text-foreground" style={{ fontSize: px(plan.values[i]), lineHeight: LINE.value }}>
            {tile.value}
            {tile.detail ? (
              <>
                {" "}
                <span className="whitespace-nowrap text-[0.55em] font-bold text-muted-foreground">{tile.detail}</span>
              </>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
