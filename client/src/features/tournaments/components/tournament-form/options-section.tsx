import { useWatch, type Control } from "react-hook-form";
import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { HIGH_HAND_PRIZES_MAX } from "@shared/domain/prize-pool";
import { plural } from "@/lib/format";
import type { TournamentFormValues } from "../../tournament-form";
import { AmountInput } from "@/components/shared/amount-input";
import { FormSection } from "./form-section";
import { RakeFields } from "./rake-fields";
import { CheckboxField } from "./toggle-fields";

interface OptionsSectionProps {
  control: Control<TournamentFormValues>;
  rakeLabel: string;
  /** Closed tournaments keep the high-hand and points settings they were paid and scored with. */
  moneyLocked: boolean;
  /** Editing: the players already in the high hand, who keep it on (their entry fees are in its pot). */
  highHandEntrants: number;
}

/** The high-hand side pot, late registration and season points. */
export function OptionsSection({ control, rakeLabel, moneyLocked, highHandEntrants }: OptionsSectionProps) {
  const highHand = useWatch({ control, name: "enableHighHand" });

  return (
    <FormSection title="Additional Options">
      <div className="space-y-3">
        <fieldset disabled={moneyLocked} className="contents">
          <CheckboxField
            control={control}
            name="enableHighHand"
            label="Enable High Hand Bonus"
            description="Award a bonus for the highest poker hand during the tournament"
            testId="enable-high-hand"
            keptOnBecause={
              highHandEntrants > 0
                ? `${plural(highHandEntrants, "player has", "players have")} entered the high hand, so it stays on. Take them out of it first to turn it off.`
                : undefined
            }
          />
        </fieldset>
        <CheckboxField
          control={control}
          name="enableLateRegistration"
          label="Enable Late Registration"
          description="Allow players to join after the tournament has started"
          testId="enable-late-registration"
        />
        <fieldset disabled={moneyLocked} className="contents">
          <CheckboxField
            control={control}
            name="trackPoints"
            label="Track Player Points"
            description="Assign points to players based on their final placement"
            testId="track-points"
          />
        </fieldset>
      </div>

      {highHand ? (
        <fieldset disabled={moneyLocked} className="space-y-4 rounded-lg border border-border bg-muted/20 p-4 sm:ml-6">
          <legend className="sr-only">High hand</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={control}
              name="highHandAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>High Hand Entry Fee (per player)</FormLabel>
                  <FormControl>
                    <AmountInput unit="$" placeholder="10" {...field} data-testid="high-hand-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="highHandPayouts"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Number of High Hand Payouts</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="1" {...field} data-testid="high-hand-payouts" />
                  </FormControl>
                  <FormDescription>Split the high hand pool among up to {HIGH_HAND_PRIZES_MAX} winners</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <RakeFields control={control} component="highHandRakeType" label={rakeLabel} part="High Hand" testId="high-hand-rake" flat />
        </fieldset>
      ) : null}

      <Alert>
        <InfoIcon className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          <strong>High Hand Bonus:</strong> each player who enters pays the entry fee into a separate pot. Set the number of
          payouts and any {rakeLabel}: the pot, less its {rakeLabel}, is shared among the winners.
        </AlertDescription>
      </Alert>
    </FormSection>
  );
}
