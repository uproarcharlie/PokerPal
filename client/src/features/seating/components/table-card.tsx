import { useRef } from "react";
import { MoreVertical, Settings2, Split, Trash2, Trophy } from "lucide-react";
import type { TableDto, TableSeatDto } from "@shared/api/seating";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { describeSeat, TablePlan, type PlanSeat } from "./public/table-plan";

/** What can be done with a table from its menu (each opens its own dialog). */
export type TableAction = "settings" | "finalTable" | "break" | "remove";

const ACTION_ITEMS: Record<TableAction, { label: string; icon: typeof Settings2 }> = {
  settings: { label: "Table settings…", icon: Settings2 },
  finalTable: { label: "Final table here…", icon: Trophy },
  break: { label: "Break table…", icon: Split },
  remove: { label: "Remove table…", icon: Trash2 },
};

interface TableMenuProps {
  table: TableDto;
  actions: readonly TableAction[];
  busy: boolean;
  onAction: (table: TableDto, action: TableAction, menu: HTMLButtonElement | null) => void;
}

/** A table's ⋮ menu: its name, seats and shape, the final table, breaking or removing it. */
export function TableMenu({ table, actions, busy, onAction }: TableMenuProps) {
  const menu = useRef<HTMLButtonElement>(null);
  if (actions.length === 0) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={menu} variant="ghost" size="icon" className="h-11 w-11" aria-label={`${table.displayName} options`}>
          <MoreVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => {
          const { label, icon: Icon } = ACTION_ITEMS[action];
          return (
            <DropdownMenuItem key={action} disabled={busy} onSelect={() => onAction(table, action, menu.current)}>
              <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
              {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An empty seat of `table`, as the panel's seat presses name it. */
export const emptySeat = (seatNumber: number): TableSeatDto => ({ seatNumber, registrationId: null, player: null, paymentConfirmed: null });

export const planSeats = (table: TableDto): PlanSeat[] =>
  table.seats.map((seat) => ({ seatNumber: seat.seatNumber, player: seat.player, unpaid: seat.registrationId !== null && seat.paymentConfirmed === false }));

interface TableCardProps {
  table: TableDto;
  /** The seat of the player the TD has picked up, when it is at this table. */
  selectedSeat: number | null;
  /** The player picked up, to say what tapping an empty seat does ("move Alice here"). */
  moverName: string | null;
  /** Seats players have just sat down in (new arrivals), marked on the plan. */
  freshSeats?: ReadonlySet<number>;
  readOnly: boolean;
  busy: boolean;
  /** Which menu actions this table offers now. */
  actions: readonly TableAction[];
  /** A phone's column of tables: tighter margins. */
  compact?: boolean;
  onSeatPress: (table: TableDto, seat: TableSeatDto) => void;
  onAction: (table: TableDto, action: TableAction, menu: HTMLButtonElement | null) => void;
}

/** One table on the TD's plan, in its real shape: its seats to tap, and a menu to change, break or remove it. */
export function TableCard({ table, selectedSeat, moverName, freshSeats, readOnly, busy, actions, compact = false, onSeatPress, onAction }: TableCardProps) {
  const seatsByNumber = new Map(table.seats.map((seat) => [seat.seatNumber, seat]));
  const label = (seat: PlanSeat) => (seat.player === null && moverName !== null ? `${describeSeat(seat)}: move ${moverName} here` : describeSeat(seat));

  return (
    <Card id={`seating-table-${table.tableNumber}`} data-testid={`table-${table.tableNumber}`} className="scroll-mt-24">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 p-4 pb-0">
        <CardTitle className="min-w-0 truncate text-base">{table.displayName}</CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-sm tabular-nums text-muted-foreground">
            {table.occupied}/{table.seatCount}
            <span className="sr-only"> seats taken</span>
          </span>
          {readOnly ? null : <TableMenu table={table} actions={actions} busy={busy} onAction={onAction} />}
        </div>
      </CardHeader>
      <CardContent className="p-2 sm:p-4">
        <TablePlan
          name={table.displayName}
          seatCount={table.seatCount}
          shape={table.shape}
          seats={planSeats(table)}
          selectedSeat={selectedSeat}
          fresh={freshSeats}
          busy={busy}
          compact={compact}
          seatLabel={label}
          onSeatPress={readOnly ? undefined : (seat) => onSeatPress(table, seatsByNumber.get(seat.seatNumber) ?? emptySeat(seat.seatNumber))}
        />
      </CardContent>
    </Card>
  );
}
