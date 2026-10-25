import { forwardRef } from "react";
import type { ControllerRenderProps, FieldPath, FieldValues } from "react-hook-form";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormControl } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";

export interface NumberStepperProps {
  id?: string;
  name?: string;
  /** What the buttons change, for their names: "minutes per level" gives "Fewer minutes per level". */
  label: string;
  /** The box's text (a whole number as typed). */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  min: number;
  max: number;
  step?: number;
  /** Said after the box: "min", "levels". */
  unit?: string;
  /** Common values offered as one tap each (6, 8, 9 and 10 seats), in `pickText`'s words. */
  quickPicks?: readonly number[];
  pickText?: (value: number) => string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean;
  "data-testid"?: string;
}

/**
 * A small whole number on a phone: − and + either side of the box, each a 44 px thumb target, the box
 * typed with the number pad (inputmode numeric), and the usual values as one tap each; held within
 * `min`..`max`. The box takes the id and aria props, so `<FormControl>` (FormNumberStepper) labels it.
 */
export const NumberStepper = forwardRef<HTMLInputElement, NumberStepperProps>(function NumberStepper(
  { id, name, label, value, onChange, onBlur, min, max, step = 1, unit, quickPicks = [], pickText = String, disabled, "data-testid": testId, ...aria },
  ref,
) {
  const text = value.trim();
  const current = /^\d+$/.test(text) ? Number(text) : null;
  const set = (next: number) => onChange(String(Math.min(max, Math.max(min, next))));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={`Fewer ${label}`}
          aria-controls={id}
          disabled={disabled || (current !== null && current <= min)}
          onClick={() => set((current ?? min) - step)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Input
          ref={ref}
          id={id}
          name={name}
          inputMode="numeric"
          autoComplete="off"
          className="h-11 w-20 text-center text-base tabular-nums"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          data-testid={testId}
          {...aria}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={`More ${label}`}
          aria-controls={id}
          disabled={disabled || (current !== null && current >= max)}
          onClick={() => set((current ?? min) + step)}
        >
          <Plus aria-hidden="true" />
        </Button>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {quickPicks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {quickPicks.map((pick) => (
            <Button
              key={pick}
              type="button"
              variant={current === pick ? "default" : "outline"}
              aria-pressed={current === pick}
              className="min-h-11 min-w-16"
              disabled={disabled}
              onClick={() => set(pick)}
            >
              {pickText(pick)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

interface FormNumberStepperProps<V extends FieldValues, N extends FieldPath<V>> {
  /** The react-hook-form field it drives: a whole number typed as text. */
  field: ControllerRenderProps<V, N>;
  min: number;
  max: number;
  /** What is counted: "seat" gives "Fewer seats" / "More seats" / "6 seats". */
  noun: string;
  quickPicks?: readonly number[];
  testId?: string;
}

/** A NumberStepper for a form field: inside a FormItem, after its FormLabel, which names the box. */
export function FormNumberStepper<V extends FieldValues, N extends FieldPath<V>>({ field: { ref, ...field }, min, max, noun, quickPicks, testId }: FormNumberStepperProps<V, N>) {
  return (
    <FormControl>
      <NumberStepper
        ref={ref}
        name={field.name}
        label={`${noun}s`}
        value={String(field.value ?? "")}
        onChange={field.onChange}
        onBlur={field.onBlur}
        min={min}
        max={max}
        quickPicks={quickPicks}
        pickText={(pick) => plural(pick, noun)}
        disabled={field.disabled}
        data-testid={testId}
      />
    </FormControl>
  );
}
