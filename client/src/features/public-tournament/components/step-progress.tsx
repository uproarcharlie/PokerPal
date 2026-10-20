import { cn } from "@/lib/utils";

/** "Step 2 of 3" with a bar for each step, filled up to the current one. */
export function StepProgress({ step, steps = 3 }: { step: number; steps?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2" aria-hidden="true">
        {Array.from({ length: steps }, (_, index) => (
          <div key={index} className={cn("h-2 flex-1 rounded", index < step ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground" aria-live="polite">
        Step {step} of {steps}
      </p>
    </div>
  );
}
