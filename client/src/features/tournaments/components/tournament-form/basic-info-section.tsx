import { useWatch, type UseFormReturn } from "react-hook-form";
import { ImageField } from "@/components/image/image-field";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { figureOf } from "@/components/shared/query-figure";
import { useAuth } from "@/contexts/auth-context";
import type { ClubDto } from "@shared/api/public";
import { usePointsSystems, useSeasons } from "@/features/seasons/hooks";
import type { TournamentFormValues } from "../../tournament-form";
import { FormSection } from "./form-section";

interface BasicInfoSectionProps {
  form: UseFormReturn<TournamentFormValues>;
  /** The clubs a new tournament may go in; an edit shows its club instead (a tournament never moves). */
  clubs: readonly ClubDto[] | null;
  clubName?: string;
  /** Points are worked out with these settings at finalize: frozen once the tournament is closed. */
  pointsLocked: boolean;
  /** The club's zone, which the start time is typed in (as every screen shows it). */
  timeZone: string;
  onUploadingChange: (uploading: boolean) => void;
}

export function BasicInfoSection({ form, clubs, clubName, pointsLocked, timeZone, onUploadingChange }: BasicInfoSectionProps) {
  const { control, setValue } = form;
  const { isAdmin } = useAuth();
  const clubId = useWatch({ control, name: "clubId" });
  const seasonId = useWatch({ control, name: "seasonId" });
  const seasonsQuery = useSeasons({ clubId, enabled: Boolean(clubId) });
  const pointsSystemsQuery = usePointsSystems(seasonId);
  const seasons = seasonsQuery.data ?? [];
  const pointsSystems = pointsSystemsQuery.data ?? [];
  // An empty menu says why: still loading, or not loaded, is not "this club has none" (P3REV3-CQ-02).
  const noSeasonsText = !clubId
    ? "Select a club first"
    : emptyMenuText(seasonsQuery, { loading: "Loading seasons…", failed: "Seasons could not be loaded", none: "No seasons available for this club" });
  const noPointsSystemsText = !seasonId
    ? "Select a season first"
    : emptyMenuText(pointsSystemsQuery, {
        loading: "Loading points systems…",
        failed: "Points systems could not be loaded",
        none: "No points systems available for this season",
      });
  // The clubs are in before the form opens (CreateTournamentDialog), so their menu is only ever empty for want of one.
  const noClubsText = isAdmin ? "No clubs available" : "You don't run any clubs";

  return (
    <FormSection title="Basic Information" first>
      <FormField
        control={control}
        name="imageUrl"
        render={({ field }) => (
          <FormItem>
            <ImageField kind="tournament_banner" label="Tournament Image" value={field.value} onChange={field.onChange} onUploadingChange={onUploadingChange} />
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <FormItem required>
              <FormLabel>Tournament Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Friday Night Series #13" {...field} data-testid="tournament-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {clubs ? (
          <FormField
            control={control}
            name="clubId"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Club</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    // A season or points system belongs to one club: never keep another club's.
                    setValue("seasonId", "");
                    setValue("pointsSystemId", "");
                  }}
                >
                  <FormControl>
                    <SelectTrigger data-testid="club-select">
                      <SelectValue placeholder="Select a club" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {clubs.length === 0 ? (
                      <SelectItem value="no-clubs" disabled>
                        {noClubsText}
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
        ) : (
          <div className="space-y-2">
            <Label htmlFor="tournament-club">Club</Label>
            <Input id="tournament-club" value={clubName ?? ""} readOnly disabled aria-describedby="tournament-club-note" />
            <p id="tournament-club-note" className="text-sm text-muted-foreground">
              A tournament stays with the club it was created in.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="seasonId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Season</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  setValue("pointsSystemId", "");
                }}
                disabled={!clubId || pointsLocked}
              >
                <FormControl>
                  <SelectTrigger data-testid="season-select">
                    <SelectValue placeholder="Select a season" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {seasons.length === 0 ? (
                    <SelectItem value="no-seasons" disabled>
                      {noSeasonsText}
                    </SelectItem>
                  ) : (
                    seasons.map((season) => (
                      <SelectItem key={season.id} value={season.id}>
                        {season.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {clubId ? <LoadFailed what="The club's seasons" query={seasonsQuery} /> : null}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="pointsSystemId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Points System</FormLabel>
              <Select value={field.value} onValueChange={field.onChange} disabled={!seasonId || pointsLocked}>
                <FormControl>
                  <SelectTrigger data-testid="points-system-select">
                    <SelectValue placeholder="Select a points system" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {pointsSystems.length === 0 ? (
                    <SelectItem value="no-points-systems" disabled>
                      {noPointsSystemsText}
                    </SelectItem>
                  ) : (
                    pointsSystems.map((system) => (
                      <SelectItem key={system.id} value={system.id}>
                        {system.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {seasonId ? <LoadFailed what="The season's points systems" query={pointsSystemsQuery} /> : null}
              <FormDescription>Optional - Select a points system to award points based on player placement</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="startDateTime"
        render={({ field }) => (
          <FormItem className="md:max-w-xs" required>
            <FormLabel>Start Date & Time</FormLabel>
            <FormControl>
              <Input type="datetime-local" {...field} data-testid="start-datetime" />
            </FormControl>
            <FormDescription>The club&apos;s local time ({timeZone})</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                rows={3}
                placeholder="Add tournament details, rules, or special notes..."
                className="resize-none"
                {...field}
                data-testid="tournament-description"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormSection>
  );
}

interface ListQuery {
  data: readonly unknown[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

/** What an empty menu says for a list query: why it is empty, read the way every figure is (figureOf). */
function emptyMenuText(query: ListQuery, text: { loading: string; failed: string; none: string }): string {
  const figure = figureOf(query, () => text.none);
  return figure === "loading" ? text.loading : figure === "failed" ? text.failed : text.none;
}

/** Beside a menu whose list failed to load: says so, with a way to ask again. */
function LoadFailed({ what, query }: { what: string; query: ListQuery }) {
  if (!query.isError || query.data !== undefined) return null;
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
      {what} could not be loaded.
      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void query.refetch()}>
        Try again
      </Button>
    </p>
  );
}
