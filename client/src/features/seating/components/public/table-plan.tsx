import { Plus } from "lucide-react";
import type { PublicPlayer } from "@shared/api/public";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { cn } from "@/lib/utils";
import { PLAN, seatName, seatPositions } from "./seat-geometry";

/** One seat as a plan draws it. */
export interface PlanSeat {
  seatNumber: number;
  player: PublicPlayer | null;
  /** Staff only: the entry has not paid yet (an amber dot). */
  unpaid?: boolean;
}

interface TablePlanProps {
  /** The table's name as people say it: "Table 3", "Feature table". */
  name: string;
  seatCount: number;
  /** The seats, by number; a number missing here is an empty seat. */
  seats: readonly PlanSeat[];
  /** Seats to ring (the seat finder's matches). */
  highlighted?: ReadonlySet<number>;
  /** The seat of the player the TD has picked up. */
  selectedSeat?: number | null;
  /** Makes every seat a button (the TD's plan); without it the plan only shows. */
  onSeatPress?: (seat: PlanSeat) => void;
  /** A seat button's accessible name (default "Seat 3: Alice Smith" / "Seat 4, empty"). */
  seatLabel?: (seat: PlanSeat) => string;
  /** A change is being saved: the seats ignore presses until it lands. */
  busy?: boolean;
  className?: string;
}

export const describeSeat = (seat: PlanSeat): string =>
  seat.player ? `Seat ${seat.seatNumber}: ${seat.player.name}${seat.unpaid ? ", not paid" : ""}` : `Seat ${seat.seatNumber}, empty`;

/**
 * A table from above: the felt, the dealer at the bottom and the seats round it, each with the
 * player's photo or initials, the seat number and their first name. The TD's plan makes each seat a
 * button (tap a player, then a seat); the players' plan is a list read in seat order. Drawn in the
 * theme's colours, so it reads in light and dark alike.
 */
export function TablePlan({ name, seatCount, seats, highlighted, selectedSeat = null, onSeatPress, seatLabel = describeSeat, busy = false, className }: TablePlanProps) {
  const bySeat = new Map(seats.map((seat) => [seat.seatNumber, seat]));
  const occupied = seats.filter((seat) => seat.player !== null).length;
  const positions = seatPositions(seatCount);
  const railRx = PLAN.feltRx + PLAN.railWidth;
  const railRy = PLAN.feltRy + PLAN.railWidth;

  return (
    <div className={cn("px-5 pb-9 pt-6", className)}>
      {/* The box's shape is PLAN's (400 × 300), so the felt and the seats placed over it line up. */}
      <div role="group" aria-label={`${name}: ${occupied} of ${seatCount} seats taken`} className="relative mx-auto aspect-[4/3] w-full max-w-md">
        <svg viewBox={`0 0 ${PLAN.width} ${PLAN.height}`} aria-hidden="true" className="absolute inset-0 h-full w-full">
          <ellipse cx={PLAN.cx} cy={PLAN.cy} rx={railRx} ry={railRy} className="fill-primary/30" />
          <ellipse cx={PLAN.cx} cy={PLAN.cy} rx={PLAN.feltRx} ry={PLAN.feltRy} strokeWidth={2} className="fill-primary/10 stroke-primary/40" />
          <circle cx={PLAN.cx} cy={PLAN.cy + PLAN.feltRy - 16} r={10} strokeWidth={1.5} className="fill-card stroke-primary/50" />
          <text x={PLAN.cx} y={PLAN.cy + PLAN.feltRy - 12} textAnchor="middle" className="fill-foreground text-[11px] font-bold">
            D
          </text>
        </svg>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6 text-center">
          <span className="max-w-[45%] truncate text-sm font-semibold text-foreground">{name}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {occupied}/{seatCount}
          </span>
        </div>
        <ol role="list" className="absolute inset-0">
          {positions.map((point, index) => {
            const seatNumber = index + 1;
            const seat = bySeat.get(seatNumber) ?? { seatNumber, player: null };
            return (
              // Centred on its point by the photo's middle (20 px down), the name hanging below.
              <li key={seatNumber} className="absolute -translate-x-1/2 -translate-y-5" style={{ left: `${point.left}%`, top: `${point.top}%` }}>
                {onSeatPress ? (
                  <button
                    type="button"
                    aria-label={seatLabel(seat)}
                    aria-pressed={selectedSeat === seatNumber}
                    aria-disabled={busy || undefined}
                    onClick={() => (busy ? undefined : onSeatPress(seat))}
                    className={cn(
                      "flex min-h-11 min-w-11 flex-col items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                      busy && "cursor-wait",
                    )}
                  >
                    <SeatFace seat={seat} interactive selected={selectedSeat === seatNumber} highlighted={highlighted?.has(seatNumber) ?? false} />
                  </button>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="sr-only">{describeSeat(seat)}</span>
                    <SeatFace seat={seat} interactive={false} selected={false} highlighted={highlighted?.has(seatNumber) ?? false} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

interface SeatFaceProps {
  seat: PlanSeat;
  interactive: boolean;
  selected: boolean;
  highlighted: boolean;
}

/** What a seat looks like: the photo (or "+" for an empty seat the TD can fill), its number, the first name. */
function SeatFace({ seat, interactive, selected, highlighted }: SeatFaceProps) {
  const { player } = seat;
  return (
    <span aria-hidden="true" className="flex flex-col items-center">
      <span
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-full border-2 bg-card",
          player ? "border-primary/60" : "border-dashed border-control text-muted-foreground",
          highlighted && "ring-4 ring-accent ring-offset-1 ring-offset-card",
          selected && "ring-4 ring-primary ring-offset-2 ring-offset-card",
        )}
      >
        {player ? (
          <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="sm" />
        ) : interactive ? (
          <Plus className="h-4 w-4" />
        ) : (
          <span className="text-xs tabular-nums">{seat.seatNumber}</span>
        )}
        {player || interactive ? (
          <span className="absolute -left-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold tabular-nums text-background">
            {seat.seatNumber}
          </span>
        ) : null}
        {seat.unpaid ? <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-status-scheduled-foreground ring-2 ring-card" /> : null}
      </span>
      {player ? <span className="mt-0.5 h-4 max-w-[3.5rem] truncate rounded bg-card/90 px-1 text-[11px] font-medium leading-4 text-foreground">{seatName(player.name)}</span> : <span className="mt-0.5 h-4" />}
    </span>
  );
}
