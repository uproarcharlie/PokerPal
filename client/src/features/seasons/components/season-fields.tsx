import type { Control } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

/**
 * The season forms' values as the inputs hold them (date boxes give "2026-03-01", a blank end date
 * is ""); createSeasonSchema / updateSeasonSchema check and convert them.
 */
export interface SeasonFormValues {
  clubId: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

const SEASON_FIELDS: ReadonlySet<string> = new Set<keyof SeasonFormValues>(["clubId", "name", "startDate", "endDate", "isActive"]);

/** Whether a server VALIDATION problem's path names one of these fields. */
export const isSeasonField = (name: string) => SEASON_FIELDS.has(name);

type SeasonControl = Control<SeasonFormValues>;

export function SeasonNameField({ control }: { control: SeasonControl }) {
  return (
    <FormField
      control={control}
      name="name"
      render={({ field }) => (
        <FormItem required>
          <FormLabel>Season Name</FormLabel>
          <FormControl>
            <Input placeholder="e.g. Spring 2026" autoComplete="off" {...field} data-testid="season-name" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Start (required) and end (optional: no end date means the season is ongoing). */
export function SeasonDateFields({ control }: { control: SeasonControl }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField
        control={control}
        name="startDate"
        render={({ field }) => (
          <FormItem required>
            <FormLabel>Start Date</FormLabel>
            <FormControl>
              <Input type="date" {...field} data-testid="start-date" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="endDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>End Date</FormLabel>
            <FormControl>
              <Input type="date" {...field} data-testid="end-date" />
            </FormControl>
            <FormDescription>Leave blank for an ongoing season.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

export function ActiveSeasonField({ control }: { control: SeasonControl }) {
  return (
    <FormField
      control={control}
      name="isActive"
      render={({ field }) => (
        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} data-testid="is-active" />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel>Active Season</FormLabel>
            <FormDescription>Mark this as the active season for the club</FormDescription>
          </div>
        </FormItem>
      )}
    />
  );
}
