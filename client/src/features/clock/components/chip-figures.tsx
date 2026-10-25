import type { LiveDisplayDto } from "@shared/api/live-display";
import { computeChipStats, formatChips, type ChipStats, type ClockStructure, type DerivedClock } from "@shared/domain/clock";
import { entriesOf } from "@/lib/entries";
import { formatNumber } from "@/lib/format";

/**
 * Why the chips in play cannot be counted, worded for the stack to set; null whenever computeChipStats
 * counted them, so the words never claim what the count does not (P4REV4-R3-CQ-05).
 */
function chipsUnknownBecause(structure: ClockStructure, stats: LiveDisplayDto["stats"], chips: ChipStats): string | null {
  if (chips.totalChips !== null) return null;
  if (structure.startingStack === null) return "Set the starting stack in the structure to count the chips in play.";
  if (stats.addons > 0 && structure.addonStack === null) return "Set the add-on stack in the structure: add-ons have been taken.";
  if (stats.earlyBirds > 0 && structure.earlyBirdStack === null) return "Set the early-bird bonus in the structure: early birds have it.";
  return "Set the stacks in the structure to count the chips in play.";
}

interface ChipFiguresProps {
  stats: LiveDisplayDto["stats"];
  structure: ClockStructure;
  derived: DerivedClock;
}

/**
 * The TD's chip count: players left, the chips in play (buy-ins, re-buys, add-ons and early birds at
 * the structure's stacks) and the average stack in chips and big blinds. Worked out here from the
 * counts, so the TD sees it whether or not the TV shows it.
 */
export function ChipFigures({ stats, structure, derived }: ChipFiguresProps) {
  const bigBlind = derived.currentPlayLevel?.bigBlind ?? derived.nextPlayLevel?.bigBlind ?? null;
  const chips = computeChipStats(structure, stats, stats.remaining, bigBlind);
  const unknown = chipsUnknownBecause(structure, stats, chips);
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="chip-figures">
        <div className="rounded-lg bg-muted/50 p-3">
          <dt className="text-xs text-muted-foreground">Players left</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">
            {formatNumber(stats.remaining)} / {formatNumber(stats.entrants)}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <dt className="text-xs text-muted-foreground">Entries</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">{formatNumber(entriesOf(stats))}</dd>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <dt className="text-xs text-muted-foreground">Chips in play</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">{chips.totalChips === null ? "–" : formatChips(chips.totalChips)}</dd>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <dt className="text-xs text-muted-foreground">Average stack</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">
            {chips.averageStack === null ? "–" : formatChips(chips.averageStack)}
            {chips.averageBigBlinds !== null ? <span className="ml-1 text-sm font-normal text-muted-foreground">({String(chips.averageBigBlinds)} BB)</span> : null}
          </dd>
        </div>
      </dl>
      {unknown ? <p className="text-sm text-muted-foreground">{unknown}</p> : null}
    </div>
  );
}
