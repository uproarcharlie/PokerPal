import type { ReactNode } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, type Cents } from "@/lib/format";
import { cn } from "@/lib/utils";

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

/**
 * How far a manual prize pool is from what the rates give: taken off (negative) or added by the club
 * (positive), so the lines above the net pool always add up to it (P2REV1-MONEY-03).
 */
export function ManualAdjustment({ cents }: { cents: Cents }) {
  if (cents === 0) return null;
  return (
    <div className="flex items-center justify-between py-2" data-testid="manual-adjustment">
      <span className="text-sm text-muted-foreground">{cents > 0 ? "Added by the club" : "Manual adjustment"}</span>
      <span className={cn("text-sm tabular-nums", cents > 0 ? "text-foreground" : "text-destructive")}>
        {cents > 0 ? "+" : "-"}
        {formatMoney(Math.abs(cents))}
      </span>
    </div>
  );
}
