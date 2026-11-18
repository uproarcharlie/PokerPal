import { useWatch, type Control } from "react-hook-form";
import type { TournamentFormValues } from "../../tournament-form";
import { FormSection } from "./form-section";
import { CheckboxField } from "./toggle-fields";
import { pointsOffReason } from "./use-tournament-form";

interface OptionsSectionProps {
  control: Control<TournamentFormValues>;
  /** Closed tournaments keep the points settings they were scored with. */
  moneyLocked: boolean;
}

/** Late registration and season points (none for a one-off game, or without a points system). The high hands are their own part (round 10). */
export function OptionsSection({ control, moneyLocked }: OptionsSectionProps) {
  const [seasonId, pointsSystemId] = useWatch({ control, name: ["seasonId", "pointsSystemId"] });

  return (
    <FormSection title="Additional Options">
      <div className="space-y-3">
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
            offBecause={pointsOffReason({ seasonId, pointsSystemId })}
          />
        </fieldset>
      </div>
    </FormSection>
  );
}
