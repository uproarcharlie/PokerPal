import { useWatch, type Control } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toCents } from "@shared/domain/money";
import { PAYOUT_STRUCTURE_KEYS, PAYOUT_STRUCTURE_LABELS, type PayoutStructureKey } from "@shared/domain/payouts";
import type { RecordedEntries, TournamentFormValues } from "../../tournament-form";
import { bountyPriceLines } from "../../buy-in-price";
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

const AMOUNT = /^\s*\d+(\.\d*)?\s*$/;

/** A buy-in typed as $0 (round 7, item 8): the whole game is free, and its pool is what the club puts up. */
const isFreeBuyIn = (text: string) => AMOUNT.test(text) && toCents(text) === 0;

/**
 * What a seat costs: the buy-in and its bounty (round 11: paid on top, never in the prize pool), and
 * re-buys and add-ons when the tournament sells them, each with its AP and its limit per player, and,
 * when it sells both, whether a player may take only one kind.
 */
export function BuyInSection({ control, rakeLabel, recorded }: MoneySectionProps & { recorded?: RecordedEntries }) {
  const rebuys = useWatch({ control, name: "enableRebuys" });
  const addons = useWatch({ control, name: "enableAddons" });
  const [buyInAmount, bountyAmount] = useWatch({ control, name: ["buyInAmount", "bountyAmount"] });
  const bountyLines = AMOUNT.test(bountyAmount) ? bountyPriceLines({ buyInAmount, bountyAmount }) : null;

  return (
    <FormSection title="Buy-in Configuration">
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-4 sm:max-w-xl sm:grid-cols-2">
          <FormField
            control={control}
            name="buyInAmount"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Buy-in Amount</FormLabel>
                <FormControl>
                  <AmountInput unit="$" placeholder="100" {...field} data-testid="buyin-amount" />
                </FormControl>
                {isFreeBuyIn(field.value) ? (
                  <FormDescription data-testid="free-tournament-hint">
                    Free tournament — set the prize pool the club puts up (Prize Pool → Edit on the tournament&apos;s page).
                  </FormDescription>
                ) : (
                  <FormDescription>Goes into the prize pool the places are paid from.</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          {/* Round 11: paid on top of the buy-in, never in the prize pool. */}
          <FormField
            control={control}
            name="bountyAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bounty per player</FormLabel>
                <FormControl>
                  <AmountInput unit="$" placeholder="None" {...field} data-testid="bounty-amount" />
                </FormControl>
                <FormDescription>Optional. Paid on top of the buy-in and kept out of the prize pool.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {bountyLines ? (
          <dl className="divide-y divide-border rounded-md border border-border text-sm sm:max-w-xl" data-testid="bounty-hint">
            {bountyLines.map((line, index) => (
              <div key={line.label} className={index === bountyLines.length - 1 ? "flex justify-between gap-3 p-2 font-semibold" : "flex justify-between gap-3 p-2"}>
                <dt className={index === bountyLines.length - 1 ? undefined : "text-muted-foreground"}>{line.label}</dt>
                <dd className="tabular-nums">{line.amount}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

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
