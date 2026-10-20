import { forwardRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AmountInputProps extends ComponentProps<"input"> {
  /** "$" before a money amount, "%" after a percentage. */
  unit: "$" | "%";
}

/**
 * A money or percentage box with its unit drawn inside it. The id and aria props a FormControl passes
 * land on the input itself, so its label names it.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(({ unit, className, ...props }, ref) => (
  <div className="relative">
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground", unit === "$" ? "left-3" : "right-3")}
    >
      {unit}
    </span>
    <Input ref={ref} inputMode="decimal" className={cn(unit === "$" ? "pl-8" : "pr-8", className)} {...props} />
  </div>
));
AmountInput.displayName = "AmountInput";
