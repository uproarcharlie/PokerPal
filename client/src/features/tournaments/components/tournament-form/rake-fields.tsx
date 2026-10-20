import { useWatch, type Control } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RakeType } from "@shared/api/common";
import { RAKE_COMPONENTS, type RakeTypeKey } from "@shared/domain/rake-rates";
import type { TournamentFormValues } from "../../tournament-form";
import { AmountInput } from "@/components/shared/amount-input";

const AMOUNT_OF = Object.fromEntries(RAKE_COMPONENTS.map(({ type, amount }) => [type, amount])) as {
  [K in RakeTypeKey]: Extract<(typeof RAKE_COMPONENTS)[number], { type: K }>["amount"];
};

interface RakeFieldsProps {
  control: Control<TournamentFormValues>;
  /** Which rate: the buy-in's, a re-buy's, an add-on's or the high hand's. */
  component: RakeTypeKey;
  /** The club's name for rake ("AP", or "Rake"). */
  label: string;
  /** What the rate is taken from, before the label: "Re-buy" for "Re-buy AP Type"; none for the buy-in. */
  part?: string;
  /** Test ids: `${testId}-type` and `${testId}-amount`. */
  testId: string;
  /** The high hand's fixed rate is one amount off its pot, not an amount per entry. */
  flat?: boolean;
}

/** One AP rate: how it is taken (none, a percentage or a fixed amount) and how much. */
export function RakeFields({ control, component, label, part, testId, flat = false }: RakeFieldsProps) {
  const amountName = AMOUNT_OF[component];
  const type = useWatch({ control, name: component });
  const prefix = part ? `${part} ${label}` : label;
  const amountLabel = type === "percentage" ? `${prefix} Percentage` : flat ? `${prefix} Amount` : `${prefix} Per Entry`;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField
        control={control}
        name={component}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{prefix} Type</FormLabel>
            <Select value={field.value} onValueChange={(value) => field.onChange(value as RakeType)}>
              <FormControl>
                <SelectTrigger data-testid={`${testId}-type`}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="none">No {label}</SelectItem>
                <SelectItem value="percentage">Percentage (%)</SelectItem>
                <SelectItem value="fixed">{flat ? "Fixed amount ($)" : "Per entry ($)"}</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {type !== "none" ? (
        <FormField
          control={control}
          name={amountName}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{amountLabel}</FormLabel>
              <FormControl>
                <AmountInput
                  {...field}
                  unit={type === "percentage" ? "%" : "$"}
                  placeholder={type === "percentage" ? "10" : "5"}
                  data-testid={`${testId}-amount`}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  );
}
