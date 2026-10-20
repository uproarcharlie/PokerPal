import { useId, type ReactNode } from "react";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

interface ChoiceTileProps {
  value: string;
  selected: boolean;
  "data-testid"?: string;
  children: ReactNode;
}

/**
 * One answer of a RadioGroup as a large tile: the whole tile is the radio's label, so a tap anywhere
 * on it chooses it, and the keyboard moves between tiles as between radios.
 */
export function ChoiceTile({ value, selected, "data-testid": testId, children }: ChoiceTileProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border-2 p-4 transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
      )}
    >
      <RadioGroupItem value={value} id={id} data-testid={testId} />
      <span className="flex flex-1 items-center gap-2 font-medium text-foreground">{children}</span>
    </label>
  );
}
