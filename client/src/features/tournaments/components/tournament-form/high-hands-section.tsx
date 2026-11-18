import type { Control } from "react-hook-form";
import type { HighHandsFormValues } from "../../high-hands-form";
import type { TournamentFormValues } from "../../tournament-form";
import { HighHandsEditor } from "../high-hands/high-hands-editor";
import { FormSection } from "./form-section";

interface HighHandsSectionProps {
  control: Control<TournamentFormValues>;
  rakeLabel: string;
  /** A closed tournament keeps the high hands it was played with. */
  moneyLocked: boolean;
  /** Editing: how many players are in each high hand (by id), which keeps it on the list. */
  entrants: Readonly<Record<string, number>>;
}

/** The tournament's high hands (round 10), each its own pot: the same editor as the Money tab's. */
export function HighHandsSection({ control, rakeLabel, moneyLocked, entrants }: HighHandsSectionProps) {
  // The form holds the list under `highHands`, as the editor's own form does; RHF's paths cannot see that through the cast.
  const highHands = control as unknown as Control<HighHandsFormValues>;
  return (
    <FormSection title="High hands">
      {/* min-w-0: a fieldset is as wide as its widest content by default, which ran the cards off a phone. */}
      <fieldset disabled={moneyLocked} className="min-w-0 space-y-4">
        <legend className="sr-only">High hands</legend>
        <HighHandsEditor control={highHands} rakeLabel={rakeLabel} entrants={entrants} />
      </fieldset>
    </FormSection>
  );
}
