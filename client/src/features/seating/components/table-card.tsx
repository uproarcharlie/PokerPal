import { useRef } from "react";
import { MoreVertical, Settings2, Split, Trash2, Trophy } from "lucide-react";
import type { TableDto, TableSeatDto } from "@shared/api/seating";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { describeSeat, TablePlan, type PlanSeat } from "./public/table-plan";

/** What can be done with a table from its menu (each opens its own dialog). */
export type TableAction = "settings" | "finalTable" | "break" | "remove";

interface TableCardProps {
  table: TableDto;
  /** The seat of the player the TD has picked up, when it is at this table. */
  selectedSeat: number | null;
  /** The player picked up, to say what tapping an empty seat does ("move Alice here"). */
  moverName: string | null;
  readOnly: boolean;
  busy: boolean;
  /** Which menu actions this table offers now. */
  actions: readonly TableAction[];
  onSeatPress: (table: TableDto, seat: TableSeatDto) => void;
  onAction: (table: TableDto, action: TableAction, menu: HTMLButtonElement | null) => void;
}

const ACTION_ITEMS: Record<TableAction, { label: string; icon: typeof Settings2 }> = {
  settings: { label: "Rename or resize…", icon: Settings2 },
  finalTable: { label: "Final table here…", icon: Trophy },
  break: { label: "Break table…", icon: Split },
  remove: { label: "Remove table…", icon: Trash2 },
};

const planSeats = (table: TableDto): PlanSeat[] =>
  table.seats.map((seat) => ({ seatNumber: seat.seatNumber, player: seat.player, unpaid: seat.registrationId !== null && seat.paymentConfirmed === false }));

/** One table on the TD's plan: its seats to tap, and a menu to rename, resize, break or remove it. */
export function TableCard({ table, selectedSeat, moverName, readOnly, busy, actions, onSeatPress, onAction }: TableCardProps) {
  const menu = useRef<HTMLButtonElement>(null);
  const seatsByNumber = new Map(table.seats.map((seat) => [seat.seatNumber, seat]));
  const label = (seat: PlanSeat) => (seat.player === null && moverName !== null ? `${describeSeat(seat)}: move ${moverName} here` : describeSeat(seat));

  return (
    <Card data-testid={`table-${table.tableNumber}`}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 p-4 pb-0">
        <CardTitle className="min-w-0 truncate text-base">{table.displayName}</CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-sm tabular-nums text-muted-foreground">
            {table.occupied}/{table.seatCount}
            <span className="sr-only"> seats taken</span>
          </span>
          {!readOnly && actions.length > 0 ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button ref={menu} variant="ghost" size="icon" aria-label={`${table.displayName} options`}>
                  <MoreVertical aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((action) => {
                  const { label: itemLabel, icon: Icon } = ACTION_ITEMS[action];
                  return (
                    <DropdownMenuItem key={action} disabled={busy} onSelect={() => onAction(table, action, menu.current)}>
                      <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                      {itemLabel}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-2 sm:p-4">
        <TablePlan
          name={table.displayName}
          seatCount={table.seatCount}
          seats={planSeats(table)}
          selectedSeat={selectedSeat}
          busy={busy}
          seatLabel={label}
          onSeatPress={
            readOnly
              ? undefined
              : (seat) => onSeatPress(table, seatsByNumber.get(seat.seatNumber) ?? { seatNumber: seat.seatNumber, registrationId: null, player: null, paymentConfirmed: null })
          }
        />
      </CardContent>
    </Card>
  );
}
