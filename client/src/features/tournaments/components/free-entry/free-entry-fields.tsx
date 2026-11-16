import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatMoney } from "@/lib/format";
import { FREE_ENTRY_REASON_LABELS, FREE_ENTRY_REASONS, freeEntrySchema, type FreeEntryInput, type FreeEntryReason } from "@shared/api/registrations";
import type { Cents } from "@shared/domain/money";

/** A free entry as its boxes hold it: no reason chosen yet is "". */
export interface FreeEntryValues {
  reason: FreeEntryReason | "";
  note: string;
  funded: boolean;
}

export const NO_FREE_ENTRY_VALUES: FreeEntryValues = { reason: "", note: "", funded: false };

/** The free entry the boxes describe, as the request sends it (freeEntrySchema: a blank note is none). */
export const freeEntryInputOf = (values: FreeEntryValues): FreeEntryInput => freeEntrySchema.parse(values);

/** The longest note the server keeps: the shared schema's own limit. */
const NOTE_MAX = 200;

interface FreeEntryFieldsProps {
  /** The tournament's buy-in: what a funded free entry adds to the prize pool. */
  buyInCents: Cents;
  /** The club's name for its take ("AP"): none of it is taken from a funded buy-in. */
  rakeLabel: string;
}

/**
 * Why the club lets this player in free (a reason chip, and a note), and whether the club pays their
 * buy-in into the prize pool (round 7, item 6). Drawn inside a form whose values hold FreeEntryValues
 * (the free-entry sheet, the Register player sheet's "Free entry").
 */
export function FreeEntryFields({ buyInCents, rakeLabel }: FreeEntryFieldsProps) {
  const { control } = useFormContext<FreeEntryValues>();
  const reason = useWatch({ control, name: "reason" });
  const reasonsLabel = useId();
  const buyIn = formatMoney(buyInCents);
  return (
    <div className="space-y-4">
      <FormField
        control={control}
        name="reason"
        render={({ field, fieldState }) => (
          <FormItem required>
            {/* The visible words name the chips' group; the star is not read out (P3REV-MA-REQUIRED-STAR). */}
            <p id={reasonsLabel} className={fieldState.error ? "text-sm font-medium text-destructive" : "text-sm font-medium"}>
              Why is it free?<span aria-hidden="true">*</span>
            </p>
            <div role="group" aria-labelledby={reasonsLabel} className="flex flex-wrap gap-2" data-testid="free-entry-reasons">
              {FREE_ENTRY_REASONS.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  variant={reason === choice ? "default" : "outline"}
                  aria-pressed={reason === choice}
                  className="h-11 px-4"
                  onClick={() => field.onChange(choice)}
                >
                  {FREE_ENTRY_REASON_LABELS[choice]}
                </Button>
              ))}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="note"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Note (optional)</FormLabel>
            <FormControl>
              <Input {...field} maxLength={NOTE_MAX} className="h-11" placeholder={reason === "other" ? "What is it for?" : "e.g. Winter League winner"} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="funded"
        render={({ field }) => (
          <FormItem className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-1">
              <FormLabel className="text-sm font-medium">Club pays their buy-in into the pool</FormLabel>
              <FormDescription className="text-xs">
                {field.value
                  ? `Adds ${buyIn} to the prize pool, with no ${rakeLabel} taken from it.`
                  : `Off: their ${buyIn} buy-in adds nothing to the prize pool.`}
              </FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-1" />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}
