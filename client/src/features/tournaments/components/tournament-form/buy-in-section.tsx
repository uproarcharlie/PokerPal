import { useWatch, type Control } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYOUT_STRUCTURE_KEYS, PAYOUT_STRUCTURE_LABELS, type PayoutStructureKey } from "@shared/domain/payouts";
import type { RecordedEntries, TournamentFormValues } from "../../tournament-form";
import { AmountInput } from "@/components/shared/amount-input";
import { plural } from "@/lib/format";
import { FormSection } from "./form-section";
import { RakeFields } from "./rake-fields";
import { CheckboxField, SwitchField } from "./toggle-fields";

interface MoneySectionProps {
  control: Control<TournamentFormValues>;
  /** The club's name for rake ("AP", or "Rake"). */
  rakeLabel: string;
}

/**
 * Why a part with entries recorded stays on: switching it off would price those entries at $0 in the
 * pool and in what players owe (P3REV0-PARITY-EDIT-REPRICE). The pool lock is what stops taking more.
 */
function keptOnBecause(count: number, one: string, many: string): string | undefined {
  if (count === 0) return undefined;
  return `${plural(count, one, many)} ${count === 1 ? "is" : "are"} recorded, so ${many} stay on. To stop taking more, lock the prize pool.`;
}

/**
 * What a seat costs: the buy-in, and re-buys and add-ons when the tournament sells them, each with its
 * AP and its limit per player, and, when it sells both, whether a player may take only one kind.
 */
export function BuyInSection({ control, rakeLabel, recorded }: MoneySectionProps & { recorded?: RecordedEntries }) {
  const rebuys = useWatch({ control, name: "enableRebuys" });
  const addons = useWatch({ control, name: "enableAddons" });

  return (
    <FormSection title="Buy-in Configuration">
      <FormField
        control={control}
        name="buyInAmount"
        render={({ field }) => (
          <FormItem className="sm:max-w-xs" required>
            <FormLabel>Buy-in Amount</FormLabel>
            <FormControl>
              <AmountInput unit="$" placeholder="100" {...field} data-testid="buyin-amount" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <SwitchField
        control={control}
        name="enableRebuys"
        label="Enable Re-buys"
        description="Allow players to re-buy during the tournament"
        testId="enable-rebuys"
        keptOnBecause={keptOnBecause(recorded?.rebuys ?? 0, "re-buy", "re-buys")}
      />
      {rebuys ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              control={control}
              name="rebuyAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Re-buy Amount</FormLabel>
                  <FormControl>
                    <AmountInput unit="$" placeholder="50" {...field} data-testid="rebuy-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="maxRebuys"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Re-buys</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="3" {...field} data-testid="max-rebuys" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="rebuyPeriodMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Re-buy Period (minutes)</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="60" {...field} data-testid="rebuy-period" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <RakeFields control={control} component="rebuyRakeType" label={rakeLabel} part="Re-buy" testId="rebuy-rake" />
        </div>
      ) : null}

      <SwitchField
        control={control}
        name="enableAddons"
        label="Enable Add-ons"
        description="Allow players to purchase add-ons during the tournament"
        testId="enable-addons"
        keptOnBecause={keptOnBecause(recorded?.addons ?? 0, "add-on", "add-ons")}
      />
      {addons ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              control={control}
              name="addonAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Add-on Amount</FormLabel>
                  <FormControl>
                    <AmountInput unit="$" placeholder="25" {...field} data-testid="addon-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="maxAddons"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Add-ons</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="No limit" {...field} data-testid="max-addons" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <RakeFields control={control} component="addonRakeType" label={rakeLabel} part="Add-on" testId="addon-rake" />
        </div>
      ) : null}

      {rebuys && addons ? (
        <CheckboxField
          control={control}
          name="rebuyOrAddon"
          label="Re-buys OR add-ons, not both"
          description="A player who re-buys cannot take an add-on, and one who takes an add-on cannot re-buy. With one of each allowed: one re-buy OR one add-on per player."
          testId="rebuy-or-addon"
        />
      ) : null}
    </FormSection>
  );
}

/** The AP taken from the buy-ins, and how the pool is split between places (labels are the shares paid). */
export function PrizePoolSection({ control, rakeLabel }: MoneySectionProps) {
  return (
    <FormSection title="Prize Pool Settings">
      <RakeFields control={control} component="rakeType" label={rakeLabel} testId="rake" />
      <FormField
        control={control}
        name="payoutStructure"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Payout Structure</FormLabel>
            <Select value={field.value} onValueChange={(value) => field.onChange(value as PayoutStructureKey)}>
              <FormControl>
                <SelectTrigger data-testid="payout-structure">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {PAYOUT_STRUCTURE_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {PAYOUT_STRUCTURE_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormSection>
  );
}
