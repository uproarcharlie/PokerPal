import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { seatingSetupSchema, type SeatingDto, type SeatingMutationDto, type SeatingSetupInput } from "@shared/api/seating";
import { SEATING_LIMITS } from "@shared/domain/seating";
import { resolveSeatingSettings, setupTableCount, type SeatingSettings } from "@shared/domain/table-advisor";
import type { TableShape } from "@shared/domain/table-layout";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PhoneSheet } from "@/components/shared/phone-sheet";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { plural } from "@/lib/format";
import { FAILED, seatingRefusal } from "../seating-text";
import type { SeatingChange } from "../staff-hooks";
import { FormNumberStepper } from "@/components/shared/number-stepper";
import { ShapePicker } from "./shape-picker";

const shape = seatingSetupSchema.shape;
const setupFormSchema = z.object({
  seatCount: typedNumber(shape.seatCount),
  tableCount: typedNumber(shape.tableCount),
  shape: shape.shape,
  includeUnconfirmed: shape.includeUnconfirmed,
});

interface SetupValues {
  seatCount: string;
  tableCount: string;
  shape: TableShape;
  includeUnconfirmed: boolean;
}

const whole = (text: string, min: number, max: number): number | null => {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max ? value : null;
};

/**
 * "2 tables: 6 / 6", or "2 tables: 9 / 9 · 4 wait for a seat" when the tables chosen cannot take
 * everyone, for what is typed so far (null while it is not a setup the server would take).
 */
export function setupPreview(players: number, seatsText: string, tablesText: string): string | null {
  const seats = whole(seatsText, SEATING_LIMITS.minSeats, SEATING_LIMITS.maxSeats);
  const tables = whole(tablesText, 1, SEATING_LIMITS.maxActiveTables);
  if (seats === null || tables === null) return null;
  if (players === 0) return `${plural(tables, "table")} (nobody to seat yet)`;
  const seated = Math.min(players, seats * tables);
  const perTable = Array.from({ length: tables }, (_, i) => Math.floor(seated / tables) + (i < seated % tables ? 1 : 0));
  const left = players - seated;
  return `${plural(tables, "table")}: ${perTable.join(" / ")}${left > 0 ? ` · ${plural(left, "player waits", "players wait")} for a seat` : ""}`;
}

/** The tournament's own seating settings as stored (null: the default), which setup re-reads at the seats chosen. */
export type StoredSeating = Pick<TournamentDetailDto, "startingTables" | "openTableAt">;

/**
 * The tables setup would put out for `players` at `seats` seats per table (the starting tables, or more
 * when those cannot take them), worked out as the server does when it is sent none: from the stored
 * settings re-read at those seats, so an unset "start with" follows them (2 tables of 6 for 9 players
 * at most, where 9 seats would take them at 1). R5REV3-CQ-12.
 */
export function defaultTableCount(stored: StoredSeating, maxPlayers: number, seats: number, players: number): number {
  const atSeats = resolveSeatingSettings({ tournament: { maxPlayers, seatsPerTable: seats, startingTables: stored.startingTables, openTableAt: stored.openTableAt }, club: null });
  return setupTableCount(atSeats, players);
}

interface SeatingSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: SeatingDto["stats"];
  /** The tournament's seating settings: what the form starts from. */
  settings: SeatingSettings;
  stored: StoredSeating;
  perform: (change: SeatingChange) => Promise<SeatingMutationDto>;
}

/**
 * One tap from no tables to everyone seated (round 5: start small, open more as players arrive): how
 * many seats each table has, how many tables to start with (the tournament's starting tables, 2 by
 * default, or more when those cannot take everyone registered), their shape, and whether players who
 * have not paid yet are seated too (on by default: entries made at the desk are often not marked
 * paid). Anyone the tables cannot take waits, and the advisor then offers to open the next table.
 */
export function SeatingSetupDialog({ open, onOpenChange, stats, settings, stored, perform }: SeatingSetupDialogProps) {
  const formId = useId();
  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Set up tables & draw seats"
      description={`Puts out the first tables for the ${plural(stats.activePlayers, "player")} still in and draws everyone a random seat.`}
      footer={
        <>
          <Button type="button" variant="ghost" className="min-h-11 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} className="min-h-11 flex-1" data-testid="setup-seating-submit">
            Set up & draw seats
          </Button>
        </>
      }
    >
      {open ? <SetupForm formId={formId} stats={stats} settings={settings} stored={stored} perform={perform} onDone={() => onOpenChange(false)} /> : null}
    </PhoneSheet>
  );
}

interface SetupFormProps {
  formId: string;
  stats: SeatingDto["stats"];
  settings: SeatingSettings;
  stored: StoredSeating;
  perform: SeatingSetupDialogProps["perform"];
  onDone: () => void;
}

function SetupForm({ formId, stats, settings, stored, perform, onDone }: SetupFormProps) {
  const { toast } = useToast();
  const switchId = useId();
  const shapeLabel = useId();
  const unpaid = stats.unconfirmedUnseated;
  const playersFor = (includeUnconfirmed: boolean) => (includeUnconfirmed ? stats.activePlayers : stats.activePlayers - unpaid);
  const form = useForm<SetupValues>({
    resolver: formResolver(setupFormSchema),
    defaultValues: {
      seatCount: String(settings.seatsPerTable),
      tableCount: String(defaultTableCount(stored, settings.maxPlayers, settings.seatsPerTable, playersFor(true))),
      shape: settings.tableShape,
      includeUnconfirmed: true,
    },
  });
  const [seatsText, tablesText, includeUnconfirmed] = useWatch({ control: form.control, name: ["seatCount", "tableCount", "includeUnconfirmed"] });
  const players = playersFor(includeUnconfirmed);
  const preview = setupPreview(players, seatsText, tablesText);

  /** Until the TD picks a number of tables, it follows the seats and the players (a 6-handed setup needs more tables). */
  const followTables = (seats: string, include: boolean) => {
    const count = whole(seats, SEATING_LIMITS.minSeats, SEATING_LIMITS.maxSeats);
    if (count !== null && !form.getFieldState("tableCount").isDirty) {
      form.setValue("tableCount", String(defaultTableCount(stored, settings.maxPlayers, count, playersFor(include))));
    }
  };

  const submit = form.handleSubmit(async (values) => {
    const parsed = setupFormSchema.parse(values);
    // Seats or a shape other than the settings' become the tournament's own (the server stores them).
    const input: SeatingSetupInput = seatingSetupSchema.parse({
      tableCount: parsed.tableCount ?? undefined,
      includeUnconfirmed: parsed.includeUnconfirmed,
      ...(parsed.seatCount !== null && parsed.seatCount !== undefined && parsed.seatCount !== settings.seatsPerTable ? { seatCount: parsed.seatCount } : {}),
      ...(parsed.shape && parsed.shape !== settings.tableShape ? { shape: parsed.shape } : {}),
    });
    try {
      await perform({ kind: "setup", input });
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["seatCount", "tableCount"] })) {
        toast({ title: FAILED.setup, description: seatingRefusal(error), variant: "destructive" });
      }
      return;
    }
    onDone();
  });

  return (
    <Form {...form}>
      <form id={formId} onSubmit={submit} noValidate className="space-y-6">
        <FormField
          control={form.control}
          name="seatCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seats per table</FormLabel>
              <FormNumberStepper
                field={{
                  ...field,
                  onChange: (next: string) => {
                    field.onChange(next);
                    followTables(next, includeUnconfirmed);
                  },
                }}
                min={SEATING_LIMITS.minSeats}
                max={SEATING_LIMITS.maxSeats}
                noun="seat"
                quickPicks={[6, 8, 9, 10]}
                testId="setup-seat-count"
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tableCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Start with</FormLabel>
              <FormNumberStepper field={field} min={1} max={SEATING_LIMITS.maxActiveTables} noun="table" quickPicks={[1, 2, 3]} testId="setup-table-count" />
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="space-y-2">
          <Label id={shapeLabel}>Table shape</Label>
          <Controller control={form.control} name="shape" render={({ field }) => <ShapePicker value={field.value} onChange={field.onChange} labelledBy={shapeLabel} testId="setup-shape" />} />
        </div>
        {unpaid > 0 ? (
          <FormField
            control={form.control}
            name="includeUnconfirmed"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <Label htmlFor={switchId}>Include {plural(unpaid, "unpaid player")}</Label>
                  <p id={`${switchId}-hint`} className="text-xs text-muted-foreground">
                    Off: they are seated once they have paid.
                  </p>
                </div>
                <Switch
                  id={switchId}
                  aria-describedby={`${switchId}-hint`}
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    followTables(seatsText, checked);
                  }}
                />
              </div>
            )}
          />
        ) : null}
        <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" aria-live="polite" data-testid="setup-preview">
          {preview ?? `Choose ${SEATING_LIMITS.minSeats} to ${SEATING_LIMITS.maxSeats} seats per table`}
        </p>
        <p className="text-sm text-muted-foreground">More tables open as players arrive: the Seats tab says when.</p>
      </form>
    </Form>
  );
}
