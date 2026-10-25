import { useId, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import type { PublicSeatingDto } from "@shared/api/seating";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TablePlan } from "./table-plan";

type PublicTable = PublicSeatingDto["tables"][number];

/** The key of a seat in `highlighted`: "3:7" for Table 3, Seat 7. */
export const seatKey = (tableNumber: number, seatNumber: number): string => `${tableNumber}:${seatNumber}`;

/** The id of a table's card, for "Show my seat" to scroll to. */
export const tableCardId = (tableNumber: number): string => `seat-finder-table-${tableNumber}`;

interface PublicTablesProps {
  tables: PublicSeatingDto["tables"];
  /** Seats to point out (the seat finder's matches), by seatKey. */
  highlighted: ReadonlySet<string>;
}

/**
 * Every table in play and who sits at it (round 5, item 18): drawn in its real shape, with each
 * player's photo or initials and first name at their seat, on a phone as on a wide screen; a found
 * player's seat is ringed. A plain list, seat by seat, is one tap away for whoever reads it better so.
 */
export function PublicTables({ tables, highlighted }: PublicTablesProps) {
  const headingId = useId();
  const [asList, setAsList] = useState(false);
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-foreground">
          Tables
        </h2>
        <div role="group" aria-label="Show the tables as" className="inline-flex rounded-md border border-input p-0.5">
          {[
            { list: false, label: "Plan", icon: LayoutGrid },
            { list: true, label: "List", icon: List },
          ].map(({ list, label, icon: Icon }) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant={asList === list ? "secondary" : "ghost"}
              aria-pressed={asList === list}
              className={cn("h-10 min-w-20", asList === list && "font-semibold")}
              onClick={() => setAsList(list)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>
      </div>
      <ul role="list" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => {
          const occupied = table.seats.filter((seat) => seat.player !== null).length;
          const marked = new Set(table.seats.filter((seat) => highlighted.has(seatKey(table.tableNumber, seat.seatNumber))).map((seat) => seat.seatNumber));
          return (
            <li key={table.tableNumber}>
              <Card id={tableCardId(table.tableNumber)} tabIndex={-1} className={cn("scroll-mt-4 focus:outline-none", marked.size > 0 && "ring-2 ring-accent")}>
                <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 p-4 pb-2">
                  <CardTitle as="h3" className="min-w-0 truncate text-base">
                    {table.displayName}
                  </CardTitle>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {occupied}/{table.seatCount}
                    <span className="sr-only"> seats taken</span>
                  </span>
                </CardHeader>
                <CardContent className="p-2 pt-0 sm:p-4 sm:pt-0">
                  {asList ? (
                    <SeatList table={table} marked={marked} />
                  ) : (
                    <TablePlan name={table.displayName} seatCount={table.seatCount} shape={table.shape} seats={table.seats} highlighted={marked} compact />
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A table's seats in order: number, photo and name. */
function SeatList({ table, marked }: { table: PublicTable; marked: ReadonlySet<number> }) {
  return (
    <ol role="list" aria-label={`${table.displayName} seats`} className="divide-y divide-border">
      {table.seats.map((seat) => (
        <li key={seat.seatNumber} className={cn("flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5", marked.has(seat.seatNumber) && "bg-accent/20")}>
          <span className="w-16 shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">Seat {seat.seatNumber}</span>
          {seat.player ? (
            <>
              <PlayerAvatar name={seat.player.name} imageUrl={seat.player.imageUrl} size="md" />
              <span className="min-w-0 break-words text-sm font-medium text-foreground">{seat.player.name}</span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Empty</span>
          )}
        </li>
      ))}
    </ol>
  );
}
