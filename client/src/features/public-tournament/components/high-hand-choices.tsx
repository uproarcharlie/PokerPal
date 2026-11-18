import { useId, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { MoneyText } from "@/components/shared/money-text";
import { cn } from "@/lib/utils";
import { allHighHandsFeeCents, highHandLabel, type HighHandSettings } from "@shared/domain/high-hands";
import { formatMoney } from "@shared/domain/money";

interface HighHandChoicesProps {
  /** The tournament's high hands, in order (highHandsOf): two or more, each ticked on its own. */
  highHands: readonly HighHandSettings[];
  value: readonly string[];
  onChange: (highHandIds: string[]) => void;
  /** The question these answer, for the group's name. */
  labelledBy: string;
  /** Smaller tiles, for the TD's desk. */
  compact?: boolean;
}

/** One tick-box as a tile: the whole tile is its label, so a tap anywhere on it ticks it. */
function ChoiceTick({ checked, onChange, compact, testId, children }: { checked: boolean; onChange: (checked: boolean) => void; compact: boolean; testId: string; children: ReactNode }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border-2 transition-colors",
        compact ? "min-h-11 p-3" : "min-h-14 p-4",
        checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
      )}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} data-testid={testId} />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-foreground">{children}</span>
    </label>
  );
}

/**
 * Which high hands a player enters (round 10: "players will only want to sign up to one of the high
 * hands … so they pay 5 instead of 10"): one tick per high hand, with its note and fee, and "All high
 * hands" to tick (or untick) them all at once. Each fee is paid at the door.
 */
export function HighHandChoices({ highHands, value, onChange, labelledBy, compact = false }: HighHandChoicesProps) {
  const chosen = new Set(value);
  const all = highHands.every((highHand) => chosen.has(highHand.id));
  const choose = (id: string, checked: boolean) => {
    const next = new Set(chosen);
    if (checked) next.add(id);
    else next.delete(id);
    // In the tournament's order, whatever order they were ticked in.
    onChange(highHands.filter((highHand) => next.has(highHand.id)).map((highHand) => highHand.id));
  };
  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-2" data-testid="high-hand-choices">
      {highHands.map((highHand) => (
        <ChoiceTick key={highHand.id} checked={chosen.has(highHand.id)} onChange={(checked) => choose(highHand.id, checked)} compact={compact} testId={`high-hand-choice-${highHand.id}`}>
          <span className="min-w-0">
            <span className="block font-medium">{highHandLabel(highHand.name)}</span>
            {highHand.note ? <span className="block text-sm text-muted-foreground">{highHand.note}</span> : null}
          </span>
          <MoneyText amount={highHand.entryFee} forceCents className="shrink-0 font-semibold tabular-nums" />
        </ChoiceTick>
      ))}
      <ChoiceTick
        checked={all}
        onChange={(checked) => onChange(checked ? highHands.map((highHand) => highHand.id) : [])}
        compact={compact}
        testId="high-hand-choice-all"
      >
        <span className="font-medium">All high hands</span>
        <span className="shrink-0 font-semibold tabular-nums">{formatMoney(allHighHandsFeeCents({ highHands }), { forceCents: true })}</span>
      </ChoiceTick>
    </div>
  );
}
