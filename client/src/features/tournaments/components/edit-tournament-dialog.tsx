import { useState, type RefObject } from "react";
import { Check } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { FormSlideout } from "@/components/ui/form-slideout";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { clubTimeZone } from "@/lib/format";
import type { ClubDto, PublicTournament } from "@shared/api/public";
import type { UpdateTournamentInput } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { useRegistrations } from "../hooks";
import { useUpdateTournament } from "../staff-hooks";
import {
  changedConfig,
  clearedRecordedPrices,
  formValuesFromTournament,
  inClubZone,
  recordedEntries,
  tournamentConfig,
  tournamentFormSchema,
} from "../tournament-form";
import { formErrorMap } from "@/lib/forms";
import { TournamentForm } from "./tournament-form/tournament-form";
import { configFromValues, useTournamentForm } from "./tournament-form/use-tournament-form";

const FORM_ID = "edit-tournament-form";

interface EditTournamentDialogProps {
  tournament: PublicTournament;
  club: ClubDto | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on close when what opened it is gone: the menu Edit was chosen from. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * A tournament's settings, as they are when the panel opens. Saving sends only what was changed, so
 * nothing the TD did not touch is resent.
 */
export function EditTournamentDialog({ tournament, club, open, onOpenChange, returnFocusTo }: EditTournamentDialogProps) {
  const timeZone = clubTimeZone(club);
  // Set up again only if the club's zone arrives after the panel opened, so the start it shows is the page's.
  return open ? (
    <EditTournamentSheet
      key={`${tournament.id}|${timeZone}`}
      tournament={tournament}
      club={club}
      timeZone={timeZone}
      onOpenChange={onOpenChange}
      returnFocusTo={returnFocusTo}
    />
  ) : null;
}

function EditTournamentSheet({ tournament, club, timeZone, onOpenChange, returnFocusTo }: Omit<EditTournamentDialogProps, "open"> & { timeZone: string }) {
  const { toast } = useToast();
  const update = useUpdateTournament(tournament.id);
  const [initialValues] = useState(() => formValuesFromTournament(tournament, timeZone));
  const { form, uploading, setUploading, showServerError } = useTournamentForm(initialValues);
  const moneyLocked = isClosedStatus(tournament.status);
  // A part with entries recorded stays on, and its price is never cleared; the server is the guard while
  // these are loading or failed.
  const registrations = useRegistrations(tournament.id);
  const recorded = registrations.data ? recordedEntries(registrations.data) : undefined;
  // New prices for entries already taken, waiting for the TD to confirm what they re-price.
  const [repricing, setRepricing] = useState<{ changes: UpdateTournamentInput; message: string } | null>(null);

  const saved = () => {
    toast({ title: "Tournament updated", description: `${tournament.name} has been saved.` });
    onOpenChange(false);
  };

  const save = form.handleSubmit(async (values) => {
    // What the form showed at first, read the same way, so an untouched field never counts as a change.
    const before = tournamentFormSchema.safeParse(inClubZone(initialValues, timeZone), { errorMap: formErrorMap });
    const after = configFromValues(values, timeZone);
    const changes = before.success ? changedConfig(tournamentConfig(before.data), after) : after;
    // A price cleared while entries are recorded at it would count them as $0: said on its box, not sent.
    const cleared = recorded ? clearedRecordedPrices(changes, recorded) : [];
    if (cleared.length > 0) {
      cleared.forEach(({ field, message }, index) => form.setError(field, { message }, { shouldFocus: index === 0 }));
      return;
    }
    if (Object.keys(changes).length === 0) {
      toast({ title: "Nothing to save", description: "No settings were changed." });
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync(changes);
    } catch (error) {
      if (hasErrorCode(error, "ENTRIES_REPRICED")) {
        setRepricing({ changes, message: errorMessage(error) });
      } else if (!showServerError(error)) {
        toast({ title: "Could not save the tournament", description: errorMessage(error, "Failed to update the tournament"), variant: "destructive" });
      }
      return;
    }
    saved();
  });

  return (
    <FormSlideout
      open
      onOpenChange={onOpenChange}
      returnFocusTo={returnFocusTo}
      title="Edit Tournament"
      description="Change the tournament's details and configuration"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={uploading} busy={update.isPending} data-testid="save-tournament">
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {uploading ? "Uploading image…" : update.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      }
    >
      <TournamentForm
        form={form}
        id={FORM_ID}
        onSubmit={save}
        clubChoices={null}
        club={club}
        moneyLocked={moneyLocked}
        recorded={recorded}
        onUploadingChange={setUploading}
      />
      <ConfirmDialog
        open={repricing !== null}
        onOpenChange={(open) => {
          if (!open) setRepricing(null);
        }}
        title="Re-price recorded entries?"
        description={repricing?.message}
        confirmLabel="Re-price and save"
        pendingLabel="Saving…"
        contentTestId="confirm-reprice"
        onConfirm={async () => {
          if (repricing === null) return;
          await update.mutateAsync({ ...repricing.changes, repriceEntries: true });
          saved();
        }}
      />
    </FormSlideout>
  );
}
