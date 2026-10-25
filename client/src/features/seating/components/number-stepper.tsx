import type { ControllerRenderProps, FieldPath, FieldValues } from "react-hook-form";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormControl } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

interface NumberStepperProps<V extends FieldValues, N extends FieldPath<V>> {
  /** The react-hook-form field it drives: a whole number typed as text. */
  field: ControllerRenderProps<V, N>;
  min: number;
  max: number;
  /** What is counted, for the buttons' names: "seat" gives "Fewer seats" / "More seats" / "6 seats". */
  unit: string;
  /** Common values offered as one tap each (6, 8, 9 and 10 seats). */
  quickPicks?: readonly number[];
  testId?: string;
}

/**
 * A small whole number on a phone: − and + either side of the box (which can still be typed in), and
 * the usual values as one tap each. Goes inside a FormItem, after its FormLabel; the box is the
 * labelled control.
 */
export function NumberStepper<V extends FieldValues, N extends FieldPath<V>>({ field: { ref, ...field }, min, max, unit, quickPicks = [], testId }: NumberStepperProps<V, N>) {
  const typed = String(field.value ?? "");
  const text = typed.trim();
  const current = Number(text);
  const known = text !== "" && Number.isInteger(current);
  const set = (next: number) => field.onChange(String(Math.min(max, Math.max(min, next))));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" aria-label={`Fewer ${unit}s`} disabled={known && current <= min} onClick={() => set(known ? current - 1 : min)}>
          <Minus aria-hidden="true" />
        </Button>
        <FormControl>
          <Input
            {...field}
            value={typed}
            ref={ref}
            inputMode="numeric"
            autoComplete="off"
            className="w-20 text-center tabular-nums"
            data-testid={testId}
          />
        </FormControl>
        <Button type="button" variant="outline" size="icon" aria-label={`More ${unit}s`} disabled={known && current >= max} onClick={() => set(known ? current + 1 : min)}>
          <Plus aria-hidden="true" />
        </Button>
      </div>
      {quickPicks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {quickPicks.map((pick) => (
            <Button
              key={pick}
              type="button"
              size="sm"
              variant={known && current === pick ? "default" : "outline"}
              aria-pressed={known && current === pick}
              className="min-h-10 min-w-16"
              onClick={() => set(pick)}
            >
              {pick} {unit}s
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
