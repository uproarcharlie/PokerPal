import { useId } from "react";
import { RotateCcw } from "lucide-react";
import type { TableDto } from "@shared/api/seating";
import { Button } from "@/components/ui/button";

interface ArchivedTablesProps {
  tables: readonly TableDto[];
  readOnly: boolean;
  busy: boolean;
  onReopen: (table: TableDto) => void;
}

/** Tables broken or removed after seating players: kept (with their history), and can be put out again. */
export function ArchivedTables({ tables, readOnly, busy, onReopen }: ArchivedTablesProps) {
  const headingId = useId();
  if (tables.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold text-muted-foreground">
        Archived tables
      </h2>
      <ul role="list" className="flex flex-wrap gap-2" data-testid="archived-tables">
        {tables.map((table) => (
          <li key={table.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1">
            <span className="text-sm text-foreground">
              {table.displayName} <span className="text-muted-foreground">({table.seatCount} seats)</span>
            </span>
            {readOnly ? null : (
              <Button type="button" variant="ghost" size="sm" busy={busy} aria-label={`Reopen ${table.displayName}`} onClick={() => onReopen(table)}>
                <RotateCcw aria-hidden="true" />
                Reopen
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
