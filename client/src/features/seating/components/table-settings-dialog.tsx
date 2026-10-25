import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { updateTableSchema, type SeatingMutationDto, type TableDto, type UpdateTableInput } from "@shared/api/seating";
import { SEATING_LIMITS } from "@shared/domain/seating";
import type { TableShape } from "@shared/domain/table-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errorDetails, hasErrorCode } from "@/lib/api/http";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { FAILED, seatingRefusal } from "../seating-text";
import type { SeatingChange } from "../staff-hooks";
import { FormNumberStepper } from "@/components/shared/number-stepper";
import { ShapePicker } from "./shape-picker";

const fields = updateTableSchema.innerType().shape;
const tableFormSchema = z.object({ name: fields.name, seatCount: typedNumber(fields.seatCount.unwrap()), shape: fields.shape.unwrap() });

interface TableValues {
  name: string;
  seatCount: string;
  shape: TableShape;
}

/** "Seat 9 is taken" / "Seats 9 and 10 are taken", from a SEATS_OCCUPIED refusal's seat numbers. */
export function occupiedSeatsMessage(seatNumbers: readonly number[]): string {
  if (seatNumbers.length === 1) return `Seat ${seatNumbers[0]} is taken: move that player first`;
  const list = `${seatNumbers.slice(0, -1).join(", ")} and ${seatNumbers[seatNumbers.length - 1]}`;
  return `Seats ${list} are taken: move those players first`;
}

function seatNumbersOf(error: unknown): number[] {
  const numbers = errorDetails(error, "SEATS_OCCUPIED")?.seatNumbers;
  return Array.isArray(numbers) ? numbers.filter((n): n is number => Number.isInteger(n)) : [];
}

interface TableSettingsDialogProps {
  /** The table being changed; the dialog is open while one is given. */
  table: TableDto | null;
  onClose: () => void;
  perform: (change: SeatingChange) => Promise<SeatingMutationDto>;
}

/** A table's name ("Feature table"; blank for "Table 3"), its number of seats (2 to 10) and how it is drawn. */
export function TableSettingsDialog({ table, onClose, perform }: TableSettingsDialogProps) {
  return (
    <Dialog open={table !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{table ? `${table.displayName} settings` : "Table settings"}</DialogTitle>
          <DialogDescription>Rename the table, change how many seats it has or its shape. Taking seats away needs them empty.</DialogDescription>
        </DialogHeader>
        {table ? <TableForm key={table.id} table={table} perform={perform} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TableForm({ table, perform, onDone }: { table: TableDto; perform: TableSettingsDialogProps["perform"]; onDone: () => void }) {
  const { toast } = useToast();
  const shapeLabel = useId();
  const form = useForm<TableValues>({
    resolver: formResolver(tableFormSchema),
    defaultValues: { name: table.name ?? "", seatCount: String(table.seatCount), shape: table.shape },
  });

  const submit = form.handleSubmit(async (values) => {
    const parsed = tableFormSchema.parse(values);
    // Only what changed: a rename never resizes the table under a player the poll has not shown yet.
    const changes: UpdateTableInput = {};
    if ((parsed.name ?? null) !== table.name) changes.name = parsed.name ?? null;
    if (parsed.seatCount !== table.seatCount) changes.seatCount = parsed.seatCount;
    if (parsed.shape !== table.shape) changes.shape = parsed.shape;
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    try {
      await perform({ kind: "updateTable", tableId: table.id, input: updateTableSchema.parse(changes) });
    } catch (error) {
      if (hasErrorCode(error, "SEATS_OCCUPIED")) {
        const taken = seatNumbersOf(error);
        form.setError("seatCount", { message: taken.length > 0 ? occupiedSeatsMessage(taken) : error.message });
      } else if (!showServerFieldErrors(form.setError, error, { fields: ["name", "seatCount", "shape"] })) {
        toast({ title: FAILED.updateTable, description: seatingRefusal(error), variant: "destructive" });
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
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder={`Table ${table.tableNumber}`} autoComplete="off" maxLength={40} data-testid="table-name" />
              </FormControl>
              <FormDescription>Leave it blank to call it Table {table.tableNumber}.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="seatCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seats</FormLabel>
              <FormNumberStepper field={field} min={SEATING_LIMITS.minSeats} max={SEATING_LIMITS.maxSeats} noun="seat" quickPicks={[6, 8, 9, 10]} testId="table-seat-count" />
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="space-y-2">
          <Label id={shapeLabel}>Shape</Label>
          <Controller control={form.control} name="shape" render={({ field }) => <ShapePicker value={field.value} onChange={field.onChange} labelledBy={shapeLabel} testId="table-shape" />} />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" busy={form.formState.isSubmitting} data-testid="table-settings-submit">
            {form.formState.isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
