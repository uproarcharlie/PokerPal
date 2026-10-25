import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Cents } from "@shared/domain/money";
import {
  differenceSentence,
  PRIZE_DIFFERENCE_CHOICES,
  PRIZE_DIFFERENCE_LABELS,
  type PrizeDifference,
  type PrizeDifferenceChoice,
} from "@shared/domain/prize-difference";

interface DifferenceChoiceProps {
  /** The difference as the choice now settles it: only shown while the prizes leave money over (cents > 0). */
  difference: PrizeDifference;
  value: PrizeDifferenceChoice;
  onChange: (choice: PrizeDifferenceChoice) => void;
  /** Where carried money goes ("Winter League", "the next tournament"). */
  carryTarget: string;
  /** What 1st pays as set, so "Add it to 1st" can say what 1st would pay. */
  firstCents?: Cents;
  /** The club's name for its AP. */
  rakeLabel: string;
  disabled?: boolean;
}

/**
 * The choice the owner asked for whenever the prizes as set leave part of the money available (round 5,
 * item 16): the club keeps it (the default), it goes to 1st, it is shared across the paid places, or it
 * is carried over, each with what it means, and the outcome in one plain sentence (announced as it
 * changes). 44 px rows, one tap each, on a phone.
 */
export function DifferenceChoice({ difference, value, onChange, carryTarget, firstCents, rakeLabel, disabled }: DifferenceChoiceProps) {
  const ids = useId();
  if (difference.cents <= 0) return null;
  const help: Readonly<Record<PrizeDifferenceChoice, string>> = {
    club: `It becomes part of the club's take, like the ${rakeLabel}.`,
    first: firstCents === undefined ? "Added to 1st's prize." : `1st pays ${formatMoney(firstCents + difference.cents)}.`,
    pro_rata: "Each paid place gets a share, in proportion to its prize.",
    carry: `To ${carryTarget}: a later tournament can add it to its prize pool.`,
  };
  return (
    <section aria-labelledby={`${ids}-legend`} className="space-y-2 rounded-lg border border-border p-3" data-testid="difference-choice">
      <p id={`${ids}-legend`} className="text-sm font-semibold text-foreground">
        Where does the {formatMoney(difference.cents)} left over go?
      </p>
      <RadioGroup aria-labelledby={`${ids}-legend`} value={value} onValueChange={(choice) => onChange(choice as PrizeDifferenceChoice)} className="gap-2" disabled={disabled}>
        {PRIZE_DIFFERENCE_CHOICES.map((choice) => (
          <Label
            key={choice}
            htmlFor={`${ids}-${choice}`}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 font-normal",
              choice === value ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <RadioGroupItem value={choice} id={`${ids}-${choice}`} className="mt-0.5" aria-describedby={`${ids}-${choice}-help`} />
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{PRIZE_DIFFERENCE_LABELS[choice]}</span>
              <span id={`${ids}-${choice}-help`} className="block text-xs text-muted-foreground">
                {help[choice]}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <p aria-live="polite" className="text-sm text-foreground" data-testid="difference-sentence">
        {differenceSentence(difference, carryTarget)}
      </p>
    </section>
  );
}

/** Prizes above the money available: paid as set, the club adding the rest ("Added by the club"). Nothing otherwise. */
export function AddedByClubNote({ difference, carryTarget }: { difference: PrizeDifference; carryTarget: string }) {
  if (difference.cents >= 0) return null;
  return (
    <Alert data-testid="added-by-club">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>
        <span className="font-semibold">Added by the club: {formatMoney(difference.addedByClubCents)}.</span> {differenceSentence(difference, carryTarget)}
      </AlertDescription>
    </Alert>
  );
}
