import { useId } from "react";
import type { PublicSeatingDto } from "@shared/api/seating";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { PHONE_QUERY, useMediaQuery } from "@/components/shared/use-media-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TablePlan } from "./table-plan";

type PublicTable = PublicSeatingDto["tables"][number];

/** The key of a seat in `highlighted`: "3:7" for Table 3, Seat 7. */
export const seatKey = (tableNumber: number, seatNumber: number): string => `${tableNumber}:${seatNumber}`;

interface PublicTablesProps {
  tables: PublicSeatingDto["tables"];
  /** Seats to point out (the seat finder's matches), by seatKey. */
  highlighted: ReadonlySet<string>;
}

/**
 * Every table in play and who sits at it: on a phone a list per table, seat by seat; from the `md`
 * breakpoint the table plan, seats round the felt as at the venue.
 */
export function PublicTables({ tables, highlighted }: PublicTablesProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Tables
      </h2>
      <ul role="list" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => {
          const occupied = table.seats.filter((seat) => seat.player !== null).length;
          const marked = new Set(table.seats.filter((seat) => highlighted.has(seatKey(table.tableNumber, seat.seatNumber))).map((seat) => seat.seatNumber));
          return (
            <li key={table.tableNumber}>
              <Card>
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
                  {phone ? <SeatList table={table} marked={marked} /> : <TablePlan name={table.displayName} seatCount={table.seatCount} seats={table.seats} highlighted={marked} />}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A table's seats in order, for a phone: number, photo and name. */
function SeatList({ table, marked }: { table: PublicTable; marked: ReadonlySet<number> }) {
  return (
    <ol role="list" aria-label={`${table.displayName} seats`} className="divide-y divide-border">
      {table.seats.map((seat) => (
        <li key={seat.seatNumber} className={cn("flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5", marked.has(seat.seatNumber) && "bg-accent/20")}>
          <span className="w-16 shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">Seat {seat.seatNumber}</span>
          {seat.player ? (
            <>
              <PlayerAvatar name={seat.player.name} imageUrl={seat.player.imageUrl} size="sm" />
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
