import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PrizePoolSnapshot } from "@shared/domain/finalize";
import type { Cents } from "@shared/domain/money";
import { differenceLines, settleDifference, type DifferenceLine } from "@shared/domain/prize-difference";
import type { PrizePoolBreakdown } from "@shared/domain/prize-pool";

/**
 * A pool's honest breakdown in one line: "Prize pool $1,000 · AP $200 · Leftover $3 → AP", "… · Added by
 * the club for free entries $100", "… · Added by the club $100". The same words on every staff screen
 * (the prize structure card, the paid pool, End Tournament). Staff-only (round 6): the AP and what the
 * club keeps are never on a public page or the TV.
 */
export interface PoolSummaryFigures {
  netCents: Cents;
  /** The AP taken (the manual total, else what the rates give); 0 shows no AP part. */
  apCents: Cents;
  rakeLabel: string;
  lines: DifferenceLine[];
}

/** A live pool's figures (computePrizePool's breakdown). */
export function liveSummary(breakdown: Pick<PrizePoolBreakdown, "net" | "rake" | "difference" | "carriedIn" | "freeEntries">, rakeLabel: string): PoolSummaryFigures {
  return { netCents: breakdown.net, apCents: breakdown.rake.applied, rakeLabel, lines: differenceLines(breakdown, rakeLabel) };
}

type FrozenPool = Pick<
  PrizePoolSnapshot["pool"],
  "netCents" | "grossCents" | "rakeCalculatedCents" | "rakeOverrideCents" | "netSource" | "difference" | "carriedIn" | "freeEntries"
>;

/**
 * What finalize froze. A snapshot from before round 5 records no difference: a pool fixed by hand
 * then kept what it left over (or the club added what it was short), worked out from its figures.
 */
export function frozenSummary(pool: FrozenPool, rakeLabel: string): PoolSummaryFigures {
  const apCents = pool.rakeOverrideCents ?? pool.rakeCalculatedCents;
  const unrecorded = !pool.difference && pool.netSource === "manual_pool";
  const difference = unrecorded ? settleDifference(pool.netCents, pool.grossCents - apCents) : pool.difference;
  return { netCents: pool.netCents, apCents, rakeLabel, lines: differenceLines({ ...pool, difference }, rakeLabel) };
}

/** The parts of the line, in order: the pool, the AP, then each difference line ("Leftover $3 → AP"). */
export function poolSummaryParts({ netCents, apCents, rakeLabel, lines }: PoolSummaryFigures): string[] {
  return [`Prize pool ${formatMoney(Math.max(0, netCents))}`, ...(apCents > 0 ? [`${rakeLabel} ${formatMoney(apCents)}`] : []), ...lines.map((line) => line.text)];
}

/**
 * The breakdown line, wrapping between its parts on a phone. Shown only when there is more to say than
 * the pool and its AP (a leftover, money carried in or added by the club): the cards beside it already
 * show those.
 */
export function PoolSummary({ figures, className, testId = "pool-summary" }: { figures: PoolSummaryFigures; className?: string; testId?: string }) {
  if (figures.lines.length === 0) return null;
  const parts = poolSummaryParts(figures);
  return (
    <p className={cn("flex flex-wrap gap-x-2 gap-y-0.5 text-sm text-muted-foreground", className)} data-testid={testId}>
      {parts.map((part, index) => (
        <span key={`${index}-${part}`} className="whitespace-nowrap">
          {index > 0 ? <span aria-hidden="true">· </span> : null}
          <span className={index === 0 ? "font-semibold text-foreground" : undefined}>{part}</span>
        </span>
      ))}
    </p>
  );
}
