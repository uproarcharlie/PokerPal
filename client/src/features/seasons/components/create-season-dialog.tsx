import { useForm } from "react-hook-form";
import { z } from "zod";
import { Check } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { createSeasonSchema } from "@shared/api/seasons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { useCreateSeason } from "../staff-hooks";
import { ActiveSeasonField, isSeasonField, SeasonDateFields, SeasonNameField, type SeasonFormValues } from "./season-fields";

/** The shared rule, plus a form-only one that names a missing club in words (the id rule says "Invalid id"). */
const createSeasonFormSchema = z.intersection(z.object({ clubId: z.string().trim().min(1, "Choose a club") }), createSeasonSchema);

interface CreateSeasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The clubs the viewer runs: a season can only be added to one of them. */
  clubs: readonly ClubDto[];
  /** A club to start with (a club page's "Create Season"); used only if it is one of `clubs`. */
  clubId?: string;
}

function startingClubId(clubs: readonly ClubDto[], clubId: string | undefined): string {
  const named = clubs.find((club) => club.id === clubId);
  if (named) return named.id;
  // Someone who runs one club (most owners) has nothing to choose.
  return clubs.length === 1 ? clubs[0].id : "";
}

function CreateSeasonForm({ clubs, clubId, onDone }: { clubs: readonly ClubDto[]; clubId?: string; onDone: () => void }) {
  const { toast } = useToast();
  const create = useCreateSeason();
  const form = useForm<SeasonFormValues>({
    resolver: formResolver(createSeasonFormSchema),
    defaultValues: { clubId: startingClubId(clubs, clubId), name: "", startDate: "", endDate: "", isActive: true },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(createSeasonSchema.parse(values));
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: isSeasonField })) {
        toast({ title: "Could not create the season", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: "Season created successfully!" });
    onDone();
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <SeasonNameField control={form.control} />
        <FormField
          control={form.control}
          name="clubId"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Club</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="club-select" onBlur={field.onBlur}>
                    <SelectValue placeholder="Select a club" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {clubs.length === 0 ? (
                    <SelectItem value="no-clubs" disabled>
                      No clubs available
                    </SelectItem>
                  ) : (
                    clubs.map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <SeasonDateFields control={form.control} />
        <ActiveSeasonField control={form.control} />
        <DialogFooter className="gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onDone} data-testid="cancel-season">
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending} data-testid="create-season-final">
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {create.isPending ? "Creating..." : "Create Season"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/** "Create New Season": name, club, dates and whether it is the club's active season. */
export function CreateSeasonDialog({ open, onOpenChange, clubs, clubId }: CreateSeasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Season</DialogTitle>
          <DialogDescription>
            Set up a new tournament season to organize events and track player progress over time.
          </DialogDescription>
        </DialogHeader>
        <CreateSeasonForm clubs={clubs} clubId={clubId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
