import type { Control } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import type { TournamentFormValues } from "../../tournament-form";

type BooleanField = {
  [K in keyof TournamentFormValues]: TournamentFormValues[K] extends boolean ? K : never;
}[keyof TournamentFormValues];

interface ToggleFieldProps {
  control: Control<TournamentFormValues>;
  name: BooleanField;
  label: string;
  description: string;
  testId?: string;
  /** Why the setting stays on (entries are recorded at its price): while it is on, it cannot be turned off. */
  keptOnBecause?: string;
}

/** A setting that opens more fields: a labelled switch in its own box. */
export function SwitchField({ control, name, label, description, testId, keptOnBecause }: ToggleFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const kept = keptOnBecause !== undefined && field.value;
        return (
          <FormItem className="flex flex-row items-center justify-between gap-4 space-y-0 rounded-lg border p-4">
            <div className="space-y-0.5">
              <FormLabel className="text-base">{label}</FormLabel>
              <FormDescription>{kept ? keptOnBecause : description}</FormDescription>
              <FormMessage />
            </div>
            <FormControl>
              <Switch
                ref={field.ref}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                disabled={kept}
                data-testid={testId}
              />
            </FormControl>
          </FormItem>
        );
      }}
    />
  );
}

/** A yes/no option: a labelled checkbox. */
export function CheckboxField({ control, name, label, description, testId, keptOnBecause }: ToggleFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const kept = keptOnBecause !== undefined && field.value;
        return (
          <FormItem className="flex flex-row items-start gap-3 space-y-0">
            <FormControl>
              <Checkbox
                ref={field.ref}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                disabled={kept}
                data-testid={testId}
              />
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel className="text-sm font-medium">{label}</FormLabel>
              <FormDescription>{kept ? keptOnBecause : description}</FormDescription>
              <FormMessage />
            </div>
          </FormItem>
        );
      }}
    />
  );
}
