import { forwardRef, useId, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DEFAULT_RAKE_LABEL } from "@shared/domain/prize-pool";

/** rakeLabelSchema's limit (shared/api/clubs, which exports no constant for it). */
const RAKE_LABEL_MAX = 16;

/** What clubs call it most often, one tap each: the name a blank label shows first. */
const COMMON_LABELS = [DEFAULT_RAKE_LABEL, "AP", "Admin fee"] as const;

interface RakeLabelInputProps extends Omit<ComponentProps<"input">, "value" | "onChange"> {
  /** The label as typed; blank (or null) shows "Rake". */
  value: string | null | undefined;
  onChange: (value: string) => void;
}

/**
 * The club's name for its AP (rake): a text box of up to 16 characters with Rake / AP / Admin fee one
 * tap away. Wrapped in a FormField's FormControl, the box takes the label's id and the field's
 * description and error, beside its own help line.
 */
export const RakeLabelInput = forwardRef<HTMLInputElement, RakeLabelInputProps>(
  ({ id, value, onChange, disabled, className, "aria-describedby": describedBy, ...props }, ref) => {
    const helpId = `${useId()}-help`;
    const text = value ?? "";
    return (
      <div className={cn("space-y-2", className)}>
        <div role="group" aria-label="Common names" className="flex flex-wrap gap-2">
          {COMMON_LABELS.map((label) => (
            <Button
              key={label}
              type="button"
              variant={text.trim() === label ? "default" : "outline"}
              className="px-3"
              aria-pressed={text.trim() === label}
              disabled={disabled}
              onClick={() => onChange(label)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Input
          ref={ref}
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          maxLength={RAKE_LABEL_MAX}
          placeholder={DEFAULT_RAKE_LABEL}
          autoComplete="off"
          aria-describedby={describedBy ? `${helpId} ${describedBy}` : helpId}
          {...props}
        />
        <p id={helpId} className="text-sm text-muted-foreground">
          Shown wherever the house take appears, e.g. AP. Leave it blank for &ldquo;{DEFAULT_RAKE_LABEL}&rdquo;.
        </p>
      </div>
    );
  },
);
RakeLabelInput.displayName = "RakeLabelInput";
