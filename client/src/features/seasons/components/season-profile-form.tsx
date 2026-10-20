import { useId } from "react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import { Check } from "lucide-react";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import { updateSeasonSchema } from "@shared/api/seasons";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { seasonEndDate, toDateInputValue } from "@/lib/season-dates";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { useUpdateSeason } from "../staff-hooks";
import { ActiveSeasonField, isSeasonField, SeasonDateFields, SeasonNameField, type SeasonFormValues } from "./season-fields";

interface SeasonProfileFormProps {
  season: PublicSeason;
  club: ClubDto;
}

/**
 * A season's name, dates and active flag. Render it with `key={season.id}`: its values come from the
 * season once, so a refetch never wipes a half-typed edit.
 */
export function SeasonProfileForm({ season, club }: SeasonProfileFormProps) {
  const clubFieldId = useId();
  const { toast } = useToast();
  const update = useUpdateSeason(season.id);
  const form = useForm<SeasonFormValues>({
    resolver: formResolver(updateSeasonSchema),
    defaultValues: {
      clubId: season.clubId,
      name: season.name,
      startDate: toDateInputValue(season.startDate),
      endDate: toDateInputValue(seasonEndDate(season)),
      isActive: season.isActive ?? true,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // The club is shown, never sent: a season stays with the club it was made for (CANNOT_MOVE).
      const { clubId: _unchangedClub, ...changes } = updateSeasonSchema.parse(values);
      await update.mutateAsync(changes);
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: isSeasonField })) {
        toast({ title: "Could not save the season", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: "Season updated successfully!" });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <SeasonNameField control={form.control} />
        <div className="space-y-2">
          <Label htmlFor={clubFieldId}>Club</Label>
          <Input id={clubFieldId} value={club.name} readOnly aria-describedby={`${clubFieldId}-note`} className="bg-muted" />
          <p id={`${clubFieldId}-note`} className="text-sm text-muted-foreground">
            A season stays with the club it was created for.
          </p>
        </div>
        <SeasonDateFields control={form.control} />
        <ActiveSeasonField control={form.control} />
        <div className="flex flex-wrap justify-end gap-3 pt-4">
          <Button asChild variant="outline">
            <Link href={routes.seasons()}>Cancel</Link>
          </Button>
          <Button type="submit" busy={update.isPending}>
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {update.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
