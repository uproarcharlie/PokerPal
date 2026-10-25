import { useWatch, type Control } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { NativeSelect } from "@/components/ui/native-select";
import { AmountInput } from "@/components/shared/amount-input";
import type { RakeType } from "@shared/api/common";
import { RAKE_COMPONENTS, type RakeAmountKey, type RakeTypeKey } from "@shared/domain/rake-rates";

const AMOUNT_OF = Object.fromEntries(RAKE_COMPONENTS.map(({ type, amount }) => [type, amount])) as {
  [K in RakeTypeKey]: Extract<(typeof RAKE_COMPONENTS)[number], { type: K }>["amount"];
};

/** The boxes of the four AP rates, as every form holding them has them: a type each, and its amount as typed text. */
export type RakeRateValues = { [K in RakeTypeKey]: RakeType } & { [K in RakeAmountKey]: string };

interface RakeFieldsProps<T extends RakeRateValues> {
  control: Control<T>;
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
  /** Takes a new type instead of the box setting it (the AP rates sheet empties the amount, so 10% never silently becomes $10). */
  onTypeChange?: (type: RakeType) => void;
}

/**
 * One AP rate: how it is taken (none, a percentage or a fixed amount) and how much. The one set of
 * boxes for a rate, in the tournament form and the AP rates sheet alike (P4REV4-CQ-03).
 */
export function RakeFields<T extends RakeRateValues>({ control, component, label, part, testId, flat = false, onTypeChange }: RakeFieldsProps<T>) {
  // Every form T holds the rates' fields under these names (RakeRateValues); RHF's paths cannot see that through the generic.
  const rates = control as unknown as Control<RakeRateValues>;
  const amountName = AMOUNT_OF[component];
  const type = useWatch({ control: rates, name: component });
  const prefix = part ? `${part} ${label}` : label;
  const amountLabel = type === "percentage" ? `${prefix} Percentage` : flat ? `${prefix} Amount` : `${prefix} Per Entry`;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField
        control={rates}
        name={component}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{prefix} Type</FormLabel>
            <FormControl>
              <NativeSelect
                name={field.name}
                ref={field.ref}
                value={field.value}
                onBlur={field.onBlur}
                onChange={(event) => (onTypeChange ?? field.onChange)(event.target.value as RakeType)}
                disabled={field.disabled}
                data-testid={`${testId}-type`}
              >
                <option value="none">No {label}</option>
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">{flat ? "Fixed amount ($)" : "Per entry ($)"}</option>
              </NativeSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {type !== "none" ? (
        <FormField
          control={rates}
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
