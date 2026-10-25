import type { ReactNode } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DifferenceLine } from "@shared/domain/prize-difference";

/** The calculator's card: a title, what the figures are, and the lines. */
export function PoolCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6">{children}</CardContent>
    </Card>
  );
}

interface PoolLineProps {
  label: ReactNode;
  value: ReactNode;
  /** A line under the label, e.g. "Fixed at $20 (calculated $35)". */
  note?: ReactNode;
  testId?: string;
  /** "total" for a subtotal, "deduction" for money taken off, "result" for the net pool. */
  tone?: "plain" | "total" | "deduction" | "result" | "accent";
  className?: string;
}

const VALUE_CLASSES = {
  plain: "text-sm font-semibold text-foreground",
  total: "text-sm font-bold text-foreground",
  deduction: "text-sm text-destructive",
  result: "text-2xl font-bold text-primary",
  accent: "text-sm font-bold text-accent-text",
} as const;

const LABEL_CLASSES = {
  plain: "text-sm text-muted-foreground",
  total: "text-sm font-medium text-foreground",
  deduction: "text-sm text-muted-foreground",
  result: "text-base font-bold text-foreground",
  accent: "text-sm font-medium text-foreground",
} as const;

/** One line of a money breakdown (the prize pool calculator, the AP panel): what it is, and the amount. */
export function PoolLine({ label, value, note, testId, tone = "plain", className }: PoolLineProps) {
  return (
    <div className={cn("flex justify-between gap-4 py-2", note ? "items-start" : "items-center", className)}>
      <span className={cn("min-w-0", LABEL_CLASSES[tone])}>
        {label}
        {note ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{note}</span> : null}
      </span>
      <span className={cn("shrink-0 tabular-nums", VALUE_CLASSES[tone])} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** How each difference line counts towards the net pool: money in (+) or out (−) of it. */
const DIFFERENCE_SIGNS: Readonly<Partial<Record<DifferenceLine["kind"], "+" | "-">>> = {
  carried_in: "+",
  kept_by_club: "-",
  carried_over: "-",
  added_by_club: "+",
};

/**
 * The lines between the AP and the net pool that say where money came from or went (round 5, item 16):
 * carried in from an earlier tournament, kept by the club, carried over, added by the club. So the lines
 * above the net pool always add up to it (P2REV1-MONEY-03). A leftover added to the places is part of the
 * net pool already: the card says so under it instead (`LeftoverNote`).
 */
export function DifferenceRows({ lines }: { lines: readonly DifferenceLine[] }) {
  return (
    <>
      {lines.map((line, index) => {
        const sign = DIFFERENCE_SIGNS[line.kind];
        if (!sign) return null;
        return (
          <div key={`${index}-${line.kind}`} className="flex items-center justify-between gap-4 py-2" data-testid={`difference-${line.kind.replaceAll("_", "-")}`}>
            <span className="min-w-0 text-sm text-muted-foreground">{line.label}</span>
            <span className={cn("shrink-0 text-sm tabular-nums", sign === "+" ? "text-foreground" : "text-destructive")}>
              {sign === "+" ? "+" : "−"}
              {formatMoney(line.cents)}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** Under the net pool: the leftover the places were paid on top of what they were set to ("Includes $50 left over, added to 1st"). */
export function LeftoverNote({ lines }: { lines: readonly DifferenceLine[] }) {
  const added = lines.find((line) => line.kind === "added_to_prizes");
  if (!added) return null;
  const where = added.label.replace(/^Left over, /, "");
  return (
    <p className="text-right text-xs text-muted-foreground" data-testid="leftover-note">
      Includes {formatMoney(added.cents)} left over, {where}
    </p>
  );
}
