import { Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormSlideout } from "@/components/ui/form-slideout";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { clubTimeZone } from "@/lib/format";
import type { ClubDto } from "@shared/api/public";
import { useClubs } from "@/features/clubs/hooks";
import { useCreateTournament } from "../staff-hooks";
import { NEW_TOURNAMENT_VALUES, startingClubId } from "../tournament-form";
import { TournamentForm } from "./tournament-form/tournament-form";
import { configFromValues, useTournamentForm } from "./tournament-form/use-tournament-form";

const FORM_ID = "create-tournament-form";

interface CreateTournamentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A club to start with (a club page's "Create Tournament"); used only if the viewer runs it. */
  clubId?: string;
}

/**
 * A new tournament, in one of the clubs the viewer runs: saved as a draft ("scheduled") or opened for
 * registration. It opens once the viewer's clubs are known, as Create Season does (the page shows
 * when they could not be loaded, with Try again), so the club it starts in is worked out once, and
 * each opening starts afresh (P3REV6-CQ-02, CQ-03).
 */
export function CreateTournamentDialog({ open, onOpenChange, clubId }: CreateTournamentDialogProps) {
  const clubs = useClubs();
  if (!open || clubs.data === undefined) return null;
  return <CreateTournamentSheet clubs={clubs.data.filter((club) => club.viewer.canManage)} clubId={clubId} onOpenChange={onOpenChange} />;
}

function CreateTournamentSheet({ clubs, clubId, onOpenChange }: { clubs: readonly ClubDto[]; clubId?: string; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateTournament();
  const { form, uploading, setUploading, showServerError } = useTournamentForm({ ...NEW_TOURNAMENT_VALUES, clubId: startingClubId(clubs, clubId) });

  const submit = (status: "scheduled" | "registration") =>
    form.handleSubmit(async (values) => {
      try {
        const club = clubs.find((choice) => choice.id === values.clubId);
        await create.mutateAsync({ ...configFromValues(values, clubTimeZone(club)), status });
      } catch (error) {
        if (!showServerError(error)) {
          toast({ title: "Could not create the tournament", description: errorMessage(error, "Failed to create tournament"), variant: "destructive" });
        }
        return;
      }
      toast({ title: `Tournament ${status === "scheduled" ? "saved as draft" : "created"} successfully!` });
      onOpenChange(false);
    });

  return (
    <FormSlideout
      open
      onOpenChange={onOpenChange}
      title="Create New Tournament"
      description="Set up your tournament details and configuration"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="cancel-tournament">
            Cancel
          </Button>
          <Button type="button" variant="secondary" onClick={submit("scheduled")} disabled={uploading} busy={create.isPending} data-testid="save-draft-tournament">
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            Save as Draft
          </Button>
          <Button type="submit" form={FORM_ID} disabled={uploading} busy={create.isPending} data-testid="create-tournament-final">
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {uploading ? "Uploading image…" : create.isPending ? "Creating…" : "Create Tournament"}
          </Button>
        </div>
      }
    >
      <TournamentForm form={form} id={FORM_ID} onSubmit={submit("registration")} clubChoices={clubs} onUploadingChange={setUploading} />
    </FormSlideout>
  );
}
