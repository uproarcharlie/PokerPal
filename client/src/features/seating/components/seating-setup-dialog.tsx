import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { seatingSetupSchema, type SeatingDto, type SeatingMutationDto } from "@shared/api/seating";
import { SEATING_LIMITS, suggestTables } from "@shared/domain/seating";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { plural } from "@/lib/format";
import { FAILED, seatingRefusal } from "../seating-text";
import type { SeatingChange } from "../staff-hooks";
import { NumberStepper } from "./number-stepper";

const shape = seatingSetupSchema.shape;
const setupFormSchema = z.object({ seatCount: typedNumber(shape.seatCount), includeUnconfirmed: shape.includeUnconfirmed });

interface SetupValues {
  seatCount: string;
  includeUnconfirmed: boolean;
}

/** "3 tables: 8 / 7 / 7", for the seats per table typed so far (null while it is not a size a table can be). */
export function setupPreview(players: number, seatsText: string): string | null {
  const seats = Number(seatsText.trim());
  if (seatsText.trim() === "" || !Number.isInteger(seats) || seats < SEATING_LIMITS.minSeats || seats > SEATING_LIMITS.maxSeats) return null;
  const { tableCount, perTable } = suggestTables(players, seats);
  return players === 0 ? `${plural(tableCount, "table")} (nobody to seat yet)` : `${plural(tableCount, "table")}: ${perTable.join(" / ")}`;
}

interface SeatingSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: SeatingDto["stats"];
  perform: (change: SeatingChange) => Promise<SeatingMutationDto>;
}

/**
 * One tap from no tables to everyone seated: how many seats each table has (6, 8, 9 or 10, or any
 * size from 2 to 10), the tables that makes for the players still in, and whether players who have not
 * paid yet are seated too (on by default: entries the TD made at the desk are often not marked paid).
 */
export function SeatingSetupDialog({ open, onOpenChange, stats, perform }: SeatingSetupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up tables & draw seats</DialogTitle>
          <DialogDescription>
            Puts out enough tables for the {plural(stats.activePlayers, "player")} still in and draws everyone a random seat.
          </DialogDescription>
        </DialogHeader>
        {open ? <SetupForm stats={stats} perform={perform} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SetupForm({ stats, perform, onDone }: { stats: SeatingDto["stats"]; perform: SeatingSetupDialogProps["perform"]; onDone: () => void }) {
  const { toast } = useToast();
  const switchId = useId();
  const form = useForm<SetupValues>({
    resolver: formResolver(setupFormSchema),
    defaultValues: { seatCount: String(SEATING_LIMITS.defaultSeats), includeUnconfirmed: true },
  });
  const [seatsText, includeUnconfirmed] = useWatch({ control: form.control, name: ["seatCount", "includeUnconfirmed"] });
  const unpaid = stats.unconfirmedUnseated;
  const players = includeUnconfirmed ? stats.activePlayers : stats.activePlayers - unpaid;
  const preview = setupPreview(players, seatsText);

  const submit = form.handleSubmit(async (values) => {
    try {
      await perform({ kind: "setup", input: seatingSetupSchema.parse(setupFormSchema.parse(values)) });
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["seatCount"] })) {
        toast({ title: FAILED.setup, description: seatingRefusal(error), variant: "destructive" });
      }
      return;
    }
    onDone();
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormField
          control={form.control}
          name="seatCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seats per table</FormLabel>
              <NumberStepper field={field} min={SEATING_LIMITS.minSeats} max={SEATING_LIMITS.maxSeats} unit="seat" quickPicks={[6, 8, 9, 10]} testId="setup-seat-count" />
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" aria-live="polite" data-testid="setup-preview">
          {preview ?? `Choose ${SEATING_LIMITS.minSeats} to ${SEATING_LIMITS.maxSeats} seats per table`}
        </p>
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
                <Switch id={switchId} aria-describedby={`${switchId}-hint`} checked={field.value} onCheckedChange={field.onChange} />
              </div>
            )}
          />
        ) : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" busy={form.formState.isSubmitting} data-testid="setup-seating-submit">
            {form.formState.isSubmitting ? "Drawing seats…" : "Set up & draw seats"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
