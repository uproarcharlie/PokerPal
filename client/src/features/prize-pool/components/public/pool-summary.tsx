import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PrizePoolSnapshot } from "@shared/domain/finalize";
import type { Cents } from "@shared/domain/money";
import { carryTargetName, differenceLines, type DifferenceLine } from "@shared/domain/prize-difference";
import type { PrizePoolBreakdown } from "@shared/domain/prize-pool";

/**
 * A pool's honest breakdown in one line (round 5, item 16): "Prize pool $1,000 · AP $200 · Kept by the
 * club $50", "… · Carried over to Winter League $50", "… · Added by the club $100". The same words on
 * the TD's pages, the public tournament page and the TV. Public-safe: no zod, no staff code.
 */
export interface PoolSummaryFigures {
  netCents: Cents;
  /** The AP taken (the manual total, else what the rates give); 0 shows no AP part. */
  apCents: Cents;
  rakeLabel: string;
  lines: DifferenceLine[];
}

/** A live pool's figures (computePrizePool's breakdown). */
export function liveSummary(breakdown: Pick<PrizePoolBreakdown, "net" | "rake" | "difference" | "carriedIn">, rakeLabel: string, carryTarget: string): PoolSummaryFigures {
  return { netCents: breakdown.net, apCents: breakdown.rake.applied, rakeLabel, lines: differenceLines(breakdown, carryTarget) };
}

type FrozenPool = Pick<
  PrizePoolSnapshot["pool"],
  "netCents" | "grossCents" | "rakeCalculatedCents" | "rakeOverrideCents" | "netSource" | "difference" | "carriedIn"
>;

/**
 * What finalize froze. A snapshot from before round 5 records no difference: a pool fixed by hand
 * then kept what it left over (or the club added what it was short), worked out from its figures.
 */
export function frozenSummary(pool: FrozenPool, rakeLabel: string): PoolSummaryFigures {
  const apCents = pool.rakeOverrideCents ?? pool.rakeCalculatedCents;
  const carryTarget = pool.difference?.carryTarget ?? carryTargetName(null);
  let lines = differenceLines(pool, carryTarget);
  if (!pool.difference && pool.netSource === "manual_pool") {
    const cents = pool.grossCents - apCents - pool.netCents;
    if (cents > 0) lines = [...lines, { kind: "kept_by_club", label: "Kept by the club", cents }];
    if (cents < 0) lines = [...lines, { kind: "added_by_club", label: "Added by the club", cents: -cents }];
  }
  return { netCents: pool.netCents, apCents, rakeLabel, lines };
}

/** The parts of the line, in order: the pool, the AP, then each difference line. */
export function poolSummaryParts({ netCents, apCents, rakeLabel, lines }: PoolSummaryFigures): string[] {
  return [
    `Prize pool ${formatMoney(Math.max(0, netCents))}`,
    ...(apCents > 0 ? [`${rakeLabel} ${formatMoney(apCents)}`] : []),
    ...lines.map((line) => `${line.label} ${formatMoney(line.cents)}`),
  ];
}

/**
 * The breakdown line, wrapping between its parts on a phone. Shown only when there is more to say than
 * the pool and its AP (something kept, carried or added): the cards beside it already show those.
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
