import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { createTablesSchema, type SeatingMutationDto } from "@shared/api/seating";
import { SEATING_LIMITS } from "@shared/domain/seating";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { FAILED, seatingRefusal } from "../seating-text";
import type { SeatingChange } from "../staff-hooks";
import { NumberStepper } from "./number-stepper";

const shape = createTablesSchema.shape;
const addTablesFormSchema = z.object({ count: typedNumber(shape.count), seatCount: typedNumber(shape.seatCount) });

/** The most tables one tap adds (createTablesSchema's own limit). */
const MAX_TABLES_PER_ADD = shape.count.removeDefault().maxValue ?? 20;

interface AddTablesValues {
  count: string;
  seatCount: string;
}

/** "Adds Table 4 (9 seats)" / "Adds Tables 4 to 6 (9 seats each)", for what is typed so far. */
export function addTablesPreview(nextNumber: number, countText: string, seatsText: string): string | null {
  const tables = Number(countText.trim());
  const seats = Number(seatsText.trim());
  const whole = (text: string, value: number, min: number, max: number) => text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
  if (!whole(countText, tables, 1, MAX_TABLES_PER_ADD) || !whole(seatsText, seats, SEATING_LIMITS.minSeats, SEATING_LIMITS.maxSeats)) return null;
  return tables === 1 ? `Adds Table ${nextNumber} (${seats} seats)` : `Adds Tables ${nextNumber} to ${nextNumber + tables - 1} (${seats} seats each)`;
}

interface AddTablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The number the first new table gets: one past the highest so far (archived tables count). */
  nextNumber: number;
  /** The seats a new table starts with: what most tables have. */
  defaultSeats: number;
  perform: (change: SeatingChange) => Promise<SeatingMutationDto>;
}

/** More tables for a tournament that has outgrown its seats (late registrations, re-entries). */
export function AddTablesDialog({ open, onOpenChange, nextNumber, defaultSeats, perform }: AddTablesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tables</DialogTitle>
          <DialogDescription>New tables start empty: seat the players waiting, or balance the tables, once they are out.</DialogDescription>
        </DialogHeader>
        {open ? <AddTablesForm nextNumber={nextNumber} defaultSeats={defaultSeats} perform={perform} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddTablesForm({ nextNumber, defaultSeats, perform, onDone }: Omit<AddTablesDialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const { toast } = useToast();
  const form = useForm<AddTablesValues>({
    resolver: formResolver(addTablesFormSchema),
    defaultValues: { count: "1", seatCount: String(defaultSeats) },
  });
  const [countText, seatsText] = useWatch({ control: form.control, name: ["count", "seatCount"] });
  const preview = addTablesPreview(nextNumber, countText, seatsText);

  const submit = form.handleSubmit(async (values) => {
    try {
      await perform({ kind: "addTables", input: createTablesSchema.parse(addTablesFormSchema.parse(values)) });
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["count", "seatCount"] })) {
        toast({ title: FAILED.addTables, description: seatingRefusal(error), variant: "destructive" });
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
          name="count"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tables</FormLabel>
              <NumberStepper field={field} min={1} max={MAX_TABLES_PER_ADD} unit="table" testId="add-tables-count" />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="seatCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seats per table</FormLabel>
              <NumberStepper field={field} min={SEATING_LIMITS.minSeats} max={SEATING_LIMITS.maxSeats} unit="seat" quickPicks={[6, 8, 9, 10]} testId="add-tables-seats" />
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" aria-live="polite">
          {preview ?? `Choose 1 to ${MAX_TABLES_PER_ADD} tables of ${SEATING_LIMITS.minSeats} to ${SEATING_LIMITS.maxSeats} seats`}
        </p>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" busy={form.formState.isSubmitting} data-testid="add-tables-submit">
            {form.formState.isSubmitting ? "Adding…" : "Add tables"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
