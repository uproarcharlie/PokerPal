import { Plus } from "lucide-react";
import type { TableDto, TableSeatDto } from "@shared/api/seating";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { describeSeat } from "./public/table-plan";
import { emptySeat, planSeats, TableMenu, type TableAction } from "./table-card";
import { UnpaidDot } from "./unpaid-dot";

interface TableListProps {
  /** The tables in play, by number. */
  tables: readonly TableDto[];
  /** The player picked up (their seat is pressed), and their name for what an empty seat does. */
  selected: { tableId: string; seatNumber: number } | null;
  moverName: string | null;
  /** Seats new arrivals have just sat down in, by table. */
  freshSeats: ReadonlyMap<string, ReadonlySet<number>>;
  readOnly: boolean;
  busy: boolean;
  actionsOf: (table: TableDto) => readonly TableAction[];
  onSeatPress: (table: TableDto, seat: TableSeatDto) => void;
  onAction: (table: TableDto, action: TableAction, menu: HTMLButtonElement | null) => void;
}

/**
 * The tables as a list, seat by seat (the Seats tab's "List" view, the plan's accessible twin): each
 * table's seats in order, each a 44 px row with the seat number, the player's photo and name (an amber
 * dot when unpaid); tap a player, then a seat, to move them (another player's seat asks to swap).
 */
export function TableList({ tables, selected, moverName, freshSeats, readOnly, busy, actionsOf, onSeatPress, onAction }: TableListProps) {
  return (
    <ul role="list" className="space-y-4" data-testid="table-list">
      {tables.map((table) => (
        <li key={table.id}>
          <Card id={`seating-list-${table.tableNumber}`} data-testid={`table-list-${table.tableNumber}`}>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 p-3 pb-1">
              <CardTitle as="h3" className="min-w-0 truncate text-base">
                {table.displayName} · {table.occupied}/{table.seatCount}
                <span className="sr-only"> seats taken</span>
              </CardTitle>
              {readOnly ? null : <TableMenu table={table} actions={actionsOf(table)} busy={busy} onAction={onAction} />}
            </CardHeader>
            <CardContent className="p-1 pt-0">
              <ol role="list" aria-label={`${table.displayName} seats`} className="divide-y divide-border">
                {planSeats(table).map((seat) => {
                  const pressed = selected?.tableId === table.id && selected.seatNumber === seat.seatNumber;
                  const fresh = freshSeats.get(table.id)?.has(seat.seatNumber) ?? false;
                  const label = seat.player === null && moverName !== null ? `${describeSeat(seat)}: move ${moverName} here` : describeSeat(seat);
                  const face = (
                    <>
                      <span className="w-14 shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">Seat {seat.seatNumber}</span>
                      {seat.player ? (
                        <>
                          <PlayerAvatar name={seat.player.name} imageUrl={seat.player.imageUrl} size="sm" />
                          <span className="min-w-0 flex-1 break-words text-left text-sm font-medium text-foreground">{seat.player.name}</span>
                          {seat.unpaid ? <UnpaidDot /> : null}
                          {fresh ? <span className="shrink-0 rounded-full bg-status-live px-2 text-xs font-semibold text-status-live-foreground">New</span> : null}
                        </>
                      ) : (
                        <span className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
                          {readOnly ? null : <Plus className="h-4 w-4" aria-hidden="true" />}
                          Empty
                        </span>
                      )}
                    </>
                  );
                  return (
                    <li key={seat.seatNumber}>
                      {readOnly ? (
                        <div className="flex min-h-11 items-center gap-3 px-2 py-1.5">{face}</div>
                      ) : (
                        <button
                          type="button"
                          aria-label={label}
                          aria-pressed={pressed}
                          aria-disabled={busy || undefined}
                          onClick={() => (busy ? undefined : onSeatPress(table, table.seats.find((candidate) => candidate.seatNumber === seat.seatNumber) ?? emptySeat(seat.seatNumber)))}
                          className={cn(
                            "flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            pressed && "bg-primary/10 ring-2 ring-primary",
                            busy && "cursor-wait",
                          )}
                        >
                          {face}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
