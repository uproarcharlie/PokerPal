import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import type { ClubDto } from "@shared/api/public";
import { updateClubSchema, type UpdateClubInput } from "@shared/api/clubs";
import { SEATING_LIMITS } from "@shared/domain/seating";
import { resolveTableShape, TABLE_SHAPE_LABELS, type TableShape } from "@shared/domain/table-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { useUpdateClub } from "@/features/clubs/staff-hooks";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { FormNumberStepper } from "@/components/shared/number-stepper";
import { ShapePicker } from "./shape-picker";

const fields = updateClubSchema.shape;
const defaultsFormSchema = z.object({
  defaultSeatsPerTable: typedNumber(fields.defaultSeatsPerTable),
  defaultTableShape: fields.defaultTableShape.unwrap().unwrap(),
});

interface DefaultsValues {
  defaultSeatsPerTable: string;
  defaultTableShape: TableShape;
}

type ClubTableDefaults = Pick<ClubDto, "defaultSeatsPerTable" | "defaultTableShape">;

const valuesOf = (club: ClubTableDefaults): DefaultsValues => ({
  defaultSeatsPerTable: String(club.defaultSeatsPerTable ?? SEATING_LIMITS.defaultSeats),
  defaultTableShape: resolveTableShape(club.defaultTableShape),
});

/**
 * What a save changes: a value moved off what is in force now is stored; one left as it was is not
 * sent, so a club that never chose keeps following the app's defaults (9 seats, oval).
 */
export function tableDefaultsChanges(club: ClubTableDefaults, values: z.output<typeof defaultsFormSchema>): UpdateClubInput {
  const changes: UpdateClubInput = {};
  if (values.defaultSeatsPerTable !== (club.defaultSeatsPerTable ?? SEATING_LIMITS.defaultSeats)) changes.defaultSeatsPerTable = values.defaultSeatsPerTable;
  if (values.defaultTableShape !== resolveTableShape(club.defaultTableShape)) changes.defaultTableShape = values.defaultTableShape;
  return changes;
}

/**
 * Club settings (round 5, items 4 and 12): the seats per table and the table shape every new
 * tournament of the club starts with (Central Stars: 9-seat rectangles). A tournament can choose its
 * own in its seating settings; "Use the app's defaults" clears them (9 seats, oval), and a cleared
 * value stays cleared.
 */
export function ClubTableDefaultsFields({ club }: { club: ClubDto }) {
  const { toast } = useToast();
  const update = useUpdateClub(club.id);
  const shapeLabel = useId();
  const form = useForm<DefaultsValues>({ resolver: formResolver(defaultsFormSchema), defaultValues: valuesOf(club) });
  const chosen = club.defaultSeatsPerTable !== null || club.defaultTableShape !== null;

  const save = async (changes: UpdateClubInput, done: string) => {
    let saved: ClubDto;
    try {
      saved = await update.mutateAsync(changes);
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["defaultSeatsPerTable", "defaultTableShape"] })) {
        toast({ title: "Could not save the table defaults", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    form.reset(valuesOf(saved));
    toast({ title: done });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const changes = tableDefaultsChanges(club, defaultsFormSchema.parse(values));
    if (Object.keys(changes).length === 0) {
      toast({ title: "Nothing to save", description: "The table defaults are as they were." });
      return;
    }
    await save(changes, "Table defaults saved");
  });

  return (
    <Card data-testid="club-table-defaults">
      <CardHeader>
        <CardTitle className="text-xl">Tables</CardTitle>
        <CardDescription>The tables your tournaments start with. Each tournament can change them in its seating settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <FormField
              control={form.control}
              name="defaultSeatsPerTable"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Seats per table</FormLabel>
                  <FormNumberStepper field={field} min={SEATING_LIMITS.minSeats} max={SEATING_LIMITS.maxSeats} noun="seat" quickPicks={[6, 8, 9, 10]} testId="club-default-seats" />
                  <FormDescription>{club.defaultSeatsPerTable === null ? `Not chosen yet: tables have ${SEATING_LIMITS.defaultSeats} seats.` : "6-handed or 8-handed games can choose fewer per tournament."}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <Label id={shapeLabel}>Table shape</Label>
              <Controller
                control={form.control}
                name="defaultTableShape"
                render={({ field }) => <ShapePicker value={field.value} onChange={field.onChange} labelledBy={shapeLabel} testId="club-default-shape" />}
              />
              <p className="text-sm text-muted-foreground">
                {club.defaultTableShape === null ? `Not chosen yet: tables are drawn as ${TABLE_SHAPE_LABELS.oval.toLowerCase()}s.` : "How the seat finder, the TV and your Seats tab draw the tables."}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row [&>button]:min-h-11">
              <Button type="submit" busy={update.isPending} data-testid="club-table-defaults-save">
                {update.isPending ? "Saving…" : "Save table defaults"}
              </Button>
              {chosen ? (
                <Button type="button" variant="ghost" busy={update.isPending} onClick={() => void save({ defaultSeatsPerTable: null, defaultTableShape: null }, "Table defaults cleared")}>
                  Use the app's defaults
                </Button>
              ) : null}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
