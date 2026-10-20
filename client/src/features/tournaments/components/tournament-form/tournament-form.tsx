import { useWatch, type UseFormReturn } from "react-hook-form";
import type { FormEventHandler } from "react";
import { Form } from "@/components/ui/form";
import { RequiredNote } from "@/components/shared/required-note";
import type { ClubDto } from "@shared/api/public";
import { rakeLabel } from "@shared/domain/prize-pool";
import { clubTimeZone } from "@/lib/format";
import type { RecordedEntries, TournamentFormValues } from "../../tournament-form";
import { BasicInfoSection } from "./basic-info-section";
import { BuyInSection, PrizePoolSection } from "./buy-in-section";
import { LimitsSection } from "./limits-section";
import { OptionsSection } from "./options-section";

interface TournamentFormProps {
  form: UseFormReturn<TournamentFormValues>;
  id: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /**
   * Creating: the clubs the viewer runs, to choose from. Editing: null, and `club` is the
   * tournament's own (a tournament never moves).
   */
  clubChoices: readonly ClubDto[] | null;
  club?: ClubDto;
  /**
   * A completed or cancelled tournament keeps the money and points settings it was paid and scored
   * with: those fields are shown but cannot be changed.
   */
  moneyLocked?: boolean;
  /** Editing: the re-buys, add-ons and high-hand entries already recorded, which keep those parts on. */
  recorded?: RecordedEntries;
  onUploadingChange: (uploading: boolean) => void;
}

/**
 * The tournament form, for a new tournament and for editing one: its sections are the same, and every
 * AP rate is the one RakeFields, labelled with the club's name for rake.
 */
export function TournamentForm({
  form,
  id,
  onSubmit,
  clubChoices,
  club,
  moneyLocked = false,
  recorded,
  onUploadingChange,
}: TournamentFormProps) {
  const clubId = useWatch({ control: form.control, name: "clubId" });
  const selectedClub = club ?? clubChoices?.find((choice) => choice.id === clubId);
  const label = rakeLabel(selectedClub);

  return (
    <Form {...form}>
      <form id={id} onSubmit={onSubmit} className="space-y-6" noValidate>
        <RequiredNote />
        <BasicInfoSection
          form={form}
          clubs={clubChoices}
          clubName={club?.name}
          pointsLocked={moneyLocked}
          timeZone={clubTimeZone(selectedClub)}
          onUploadingChange={onUploadingChange}
        />
        {moneyLocked ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="money-locked-note">
            This tournament is closed: its buy-ins, {label}, payouts, high hand and points settings stay as they were paid and
            scored.
          </p>
        ) : null}
        <fieldset disabled={moneyLocked} className="space-y-6">
          <legend className="sr-only">Money</legend>
          <BuyInSection control={form.control} rakeLabel={label} recorded={recorded} />
          <PrizePoolSection control={form.control} rakeLabel={label} />
        </fieldset>
        <OptionsSection control={form.control} rakeLabel={label} moneyLocked={moneyLocked} highHandEntrants={recorded?.highHandEntrants ?? 0} />
        <LimitsSection control={form.control} club={selectedClub} />
      </form>
    </Form>
  );
}
