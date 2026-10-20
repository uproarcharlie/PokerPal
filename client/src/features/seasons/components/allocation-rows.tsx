import { useEffect, useId, useRef, type ReactNode } from "react";
import { useFieldArray, type Control } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EMPTY_ALLOCATION, type PointsSystemFormValues } from "../points-system-values";

/** A row's field label, naming the row for screen readers ("Points, row 2"). */
function RowLabel({ children, row }: { children: ReactNode; row: number }) {
  return (
    <FormLabel className="text-xs text-muted-foreground">
      {children}
      <span className="sr-only">, row {row}</span>
    </FormLabel>
  );
}

/**
 * "Position-Based Points": one row per finishing position or range of positions. Overlapping rows
 * are refused by the shared schema, here and again on the server.
 */
export function AllocationRows({ control }: { control: Control<PointsSystemFormValues> }) {
  const headingId = useId();
  const { fields, append, remove } = useFieldArray({ control, name: "allocations" });
  // A row's Remove takes its own button away: focus goes to the row now in its place, the one before
  // it, or Add Position (P3REV-MA-FOCUS-AFTER-REMOVE).
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const removedAt = useRef<number | null>(null);
  useEffect(() => {
    const index = removedAt.current;
    if (index === null) return;
    removedAt.current = null;
    const neighbour = fields[index] ?? fields[index - 1];
    (neighbour ? removeButtons.current.get(neighbour.id) : addButton.current)?.focus();
  }, [fields]);
  const removeRow = (index: number) => {
    removedAt.current = index;
    remove(index);
  };

  return (
    <div role="group" aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          Position-Based Points
        </h3>
        <Button ref={addButton} type="button" variant="outline" size="sm" onClick={() => append({ ...EMPTY_ALLOCATION })}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add Position
        </Button>
      </div>

      {fields.length > 0 ? (
        <ol role="list" className="space-y-3">
          {fields.map((row, index) => (
            <li
              key={row.id}
              className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 sm:grid-cols-12 sm:items-start sm:border-0 sm:p-0"
              data-testid={`allocation-row-${index}`}
            >
              <FormField
                control={control}
                name={`allocations.${index}.position`}
                render={({ field }) => (
                  <FormItem className="sm:col-span-3">
                    <RowLabel row={index + 1}>Position</RowLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`allocations.${index}.positionEnd`}
                render={({ field }) => (
                  <FormItem className="sm:col-span-3">
                    <RowLabel row={index + 1}>End (optional)</RowLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="3" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`allocations.${index}.points`}
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <RowLabel row={index + 1}>Points</RowLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`allocations.${index}.description`}
                render={({ field }) => (
                  <FormItem className="sm:col-span-3">
                    <RowLabel row={index + 1}>Label</RowLabel>
                    <FormControl>
                      <Input placeholder="e.g. Winner" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="col-span-2 flex justify-end sm:col-span-1 sm:pt-6">
                <Button
                  ref={(button) => {
                    if (button) removeButtons.current.set(row.id, button);
                    else removeButtons.current.delete(row.id);
                  }}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove row ${index + 1}`}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
