import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import type { SeatingDto } from "@shared/api/seating";
import { createTournamentSchema, type TournamentDetailDto, type UpdateTournamentInput } from "@shared/api/tournaments";
import { SEATING_LIMITS } from "@shared/domain/seating";
import { AUTO_SEAT_LABELS, AUTO_SEAT_MODES, seatingSettingsProblem, type AutoSeatMode } from "@shared/domain/table-advisor";
import { TABLE_SHAPE_LABELS, type TableShape } from "@shared/domain/table-layout";
import { PhoneSheet } from "@/components/shared/phone-sheet";
import { Button } from "@/components/ui/button";
import { Form, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useUpdateTournament } from "@/features/tournaments/staff-hooks";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormNumberStepper } from "@/components/shared/number-stepper";
import { ShapePicker } from "./shape-picker";

/** What each way of seating new players does, under its name. */
const AUTO_SEAT_HINTS: Readonly<Record<AutoSeatMode, string>> = {
  on_register: "Late players get a seat as they sign up, at the table with the fewest players.",
  once_paid: "Late players get a seat when you confirm their payment. Unpaid sign-ups don't count towards opening tables.",
  off: "Nobody is seated by the app: you seat late players yourself.",
};

const fields = createTournamentSchema.shape;
const present = (value: number | null | undefined) => value !== null && value !== undefined;

const settingsFormSchema = z
  .object({
    seatsPerTable: typedNumber(fields.seatsPerTable).refine(present, `Choose ${SEATING_LIMITS.minSeats} to ${SEATING_LIMITS.maxSeats} seats`),
    startingTables: typedNumber(fields.startingTables).refine(present, "Choose how many tables to start with"),
    openTableAt: typedNumber(fields.openTableAt).refine(present, "Choose when the next table opens"),
    autoSeat: z.enum(AUTO_SEAT_MODES),
    tableShape: z.enum(["oval", "rectangle", "round"]),
  })
  .superRefine((values, ctx) => {
    const problem = seatingSettingsProblem({ tournament: { maxPlayers: 1, seatsPerTable: values.seatsPerTable, openTableAt: values.openTableAt } });
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [problem.field], message: problem.message });
  });

type SettingsOutput = z.output<typeof settingsFormSchema>;

export interface SeatingSettingsValues {
  seatsPerTable: string;
  startingTables: string;
  openTableAt: string;
  autoSeat: AutoSeatMode;
  tableShape: TableShape;
}

export const settingsValues = (settings: SeatingDto["settings"]): SeatingSettingsValues => ({
  seatsPerTable: String(settings.seatsPerTable),
  startingTables: String(settings.startingTables),
  openTableAt: String(settings.openTableAt),
  autoSeat: settings.autoSeat,
  tableShape: settings.tableShape,
});

type StoredSettings = Pick<TournamentDetailDto, "seatsPerTable" | "startingTables" | "openTableAt" | "autoSeat" | "tableShape">;

/**
 * The tournament columns a save changes: each setting the TD moved off what is in force now is stored
 * on the tournament; a setting left as it was is not sent, so one that follows the club's default keeps
 * following it. "When full" (the threshold at the seats per table) is stored as no threshold, which
 * follows the seats per table if they change later.
 */
export function settingsChanges(settings: SeatingDto["settings"], stored: StoredSettings, values: SettingsOutput): UpdateTournamentInput {
  const changes: UpdateTournamentInput = {};
  const seats = values.seatsPerTable as number;
  if (seats !== settings.seatsPerTable) changes.seatsPerTable = seats;
  if (values.startingTables !== settings.startingTables) changes.startingTables = values.startingTables;
  const threshold = (values.openTableAt as number) >= seats ? null : (values.openTableAt as number);
  if (threshold !== (stored.openTableAt ?? null)) changes.openTableAt = threshold;
  if (values.autoSeat !== settings.autoSeat) changes.autoSeat = values.autoSeat;
  if (values.tableShape !== settings.tableShape) changes.tableShape = values.tableShape;
  return changes;
}

/** "Up to 5 tables for 40 players · start with 2 · open Table 3 when both have 9 players". */
export function settingsSummary(values: SeatingSettingsValues, maxPlayers: number): string | null {
  const seats = Number(values.seatsPerTable);
  const start = Number(values.startingTables);
  const at = Number(values.openTableAt);
  if (![seats, start, at].every((value) => Number.isInteger(value) && value > 0) || seats < SEATING_LIMITS.minSeats || seats > SEATING_LIMITS.maxSeats) return null;
  const most = Math.min(SEATING_LIMITS.maxActiveTables, Math.ceil(maxPlayers / seats));
  const every = start === 1 ? "it has" : start === 2 ? "both have" : "they all have";
  const when = at >= seats ? `when ${start === 1 ? "it is" : start === 2 ? "both are" : "they are all"} full` : `when ${every} ${plural(at, "player")}`;
  return `Up to ${plural(most, "table")} of ${seats} for ${plural(maxPlayers, "player")}. Start with ${plural(start, "table")}; open Table ${start + 1} ${when}.`;
}

interface SeatingSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: TournamentDetailDto;
  settings: SeatingDto["settings"];
}

/**
 * The Seats tab's settings (round 5, items 9, 11 and 12): seats per table (6-handed to 10), how many
 * tables to start with, when the next table opens, how late players are seated, and the tables' shape.
 * Saved on the tournament (PUT /api/tournaments/:id); the club's defaults fill whatever it leaves.
 */
export function SeatingSettingsSheet({ open, onOpenChange, tournament, settings }: SeatingSettingsSheetProps) {
  const formId = useId();
  const update = useUpdateTournament(tournament.id);
  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Seating settings"
      description="How many seats each table has, how many tables you start with and when the next one opens."
      testId="seating-settings"
      footer={
        <>
          <Button type="button" variant="ghost" className="min-h-11 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} className="min-h-11 flex-1" busy={update.isPending} data-testid="seating-settings-save">
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {open ? <SettingsForm formId={formId} tournament={tournament} settings={settings} save={update.mutateAsync} onDone={() => onOpenChange(false)} /> : null}
    </PhoneSheet>
  );
}

interface SettingsFormProps {
  formId: string;
  tournament: TournamentDetailDto;
  settings: SeatingDto["settings"];
  save: (changes: UpdateTournamentInput) => Promise<TournamentDetailDto>;
  onDone: () => void;
}

function SettingsForm({ formId, tournament, settings, save, onDone }: SettingsFormProps) {
  const { toast } = useToast();
  const shapeLabel = useId();
  const autoSeatLabel = useId();
  const form = useForm<SeatingSettingsValues>({ resolver: formResolver(settingsFormSchema), defaultValues: settingsValues(settings) });
  const values = useWatch({ control: form.control }) as SeatingSettingsValues;
  const seats = Number(values.seatsPerTable);
  const seatsKnown = Number.isInteger(seats) && seats >= SEATING_LIMITS.minSeats && seats <= SEATING_LIMITS.maxSeats;
  const summary = settingsSummary(values, tournament.maxPlayers);

  const submit = form.handleSubmit(async (typed) => {
    const changes = settingsChanges(settings, tournament, settingsFormSchema.parse(typed));
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    try {
      await save(changes);
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["seatsPerTable", "startingTables", "openTableAt", "autoSeat", "tableShape"] })) {
        toast({ title: "Could not save the seating settings", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: "Seating settings saved" });
    onDone();
  });

  return (
    <Form {...form}>
      <form id={formId} onSubmit={submit} noValidate className="space-y-6">
        <FormField
          control={form.control}
          name="seatsPerTable"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seats per table</FormLabel>
              <FormNumberStepper
                field={{
                  ...field,
                  onChange: (next: string) => {
                    // "When full" stays when full, and a threshold never ends up above the seats.
                    const at = Number(form.getValues("openTableAt"));
                    if (at >= Number(field.value) || at > Number(next)) form.setValue("openTableAt", next);
                    field.onChange(next);
                  },
                }}
                min={SEATING_LIMITS.minSeats}
                max={SEATING_LIMITS.maxSeats}
                noun="seat"
                quickPicks={[6, 8, 9, 10]}
                testId="settings-seats"
              />
              <FormDescription>A 6-handed game on 9-seat tables is 6 seats per table. Tables already out keep their seats.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="startingTables"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Start with</FormLabel>
              <FormNumberStepper field={field} min={1} max={SEATING_LIMITS.maxActiveTables} noun="table" quickPicks={[1, 2, 3]} testId="settings-starting-tables" />
              <FormDescription>How many tables Set up puts out. More open as players arrive.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="openTableAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Open the next table when every table has</FormLabel>
              <FormNumberStepper field={field} min={1} max={seatsKnown ? seats : SEATING_LIMITS.maxSeats} noun="player" testId="settings-open-at" />
              {seatsKnown ? (
                <Button
                  type="button"
                  size="sm"
                  variant={Number(field.value) >= seats ? "default" : "outline"}
                  aria-pressed={Number(field.value) >= seats}
                  className="min-h-11"
                  onClick={() => field.onChange(String(seats))}
                >
                  When full ({seats})
                </Button>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="space-y-2">
          <Label id={autoSeatLabel}>Seat new players automatically</Label>
          <Controller
            control={form.control}
            name="autoSeat"
            render={({ field }) => (
              <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby={autoSeatLabel} className="gap-2" data-testid="settings-auto-seat">
                {AUTO_SEAT_MODES.map((mode) => (
                  <ModeTile key={mode} mode={mode} selected={field.value === mode} />
                ))}
              </RadioGroup>
            )}
          />
        </div>
        <div className="space-y-2">
          <Label id={shapeLabel}>Table shape</Label>
          <Controller
            control={form.control}
            name="tableShape"
            render={({ field }) => <ShapePicker value={field.value} onChange={field.onChange} labelledBy={shapeLabel} testId="settings-shape" />}
          />
          <p className="text-sm text-muted-foreground">New tables are drawn as {TABLE_SHAPE_LABELS[values.tableShape].toLowerCase()}s; change one table from its menu.</p>
        </div>
        <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" aria-live="polite" data-testid="settings-summary">
          {summary ?? "Choose the seats and tables"}
        </p>
      </form>
    </Form>
  );
}

/** One way of seating new players as a large tile: the whole tile is the radio's label. */
function ModeTile({ mode, selected }: { mode: AutoSeatMode; selected: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border-2 p-3", selected ? "border-primary bg-primary/5" : "border-border")}>
      <RadioGroupItem value={mode} id={id} className="mt-1" />
      <span className="space-y-0.5">
        <span className="block font-medium text-foreground">{AUTO_SEAT_LABELS[mode]}</span>
        <span className="block text-sm text-muted-foreground">{AUTO_SEAT_HINTS[mode]}</span>
      </span>
    </label>
  );
}
