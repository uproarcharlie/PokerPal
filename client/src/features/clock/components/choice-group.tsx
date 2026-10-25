import { useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A line under the label, e.g. what the blinds grow from. */
  description?: string;
}

interface ChoiceGroupProps<T extends string> {
  /** The question, e.g. "Blinds". */
  legend: string;
  value: T;
  onChange: (value: T) => void;
  choices: ReadonlyArray<Choice<T>>;
  className?: string;
}

/** One of a few choices, each a full-width row a thumb can hit (44 px or more), with the radio's keyboard. */
export function ChoiceGroup<T extends string>({ legend, value, onChange, choices, className }: ChoiceGroupProps<T>) {
  const id = useId();
  return (
    <fieldset className={cn("space-y-2", className)}>
      <legend className="mb-2 text-base font-semibold text-foreground">{legend}</legend>
      <RadioGroup value={value} onValueChange={(next) => onChange(next as T)} className="gap-1.5">
        {choices.map((choice) => (
          <Label
            key={choice.value}
            htmlFor={`${id}-${choice.value}`}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 font-normal",
              value === choice.value && "border-primary bg-primary/5",
            )}
          >
            <RadioGroupItem id={`${id}-${choice.value}`} value={choice.value} />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{choice.label}</span>
              {choice.description ? <span className="block text-sm text-muted-foreground">{choice.description}</span> : null}
            </span>
          </Label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
