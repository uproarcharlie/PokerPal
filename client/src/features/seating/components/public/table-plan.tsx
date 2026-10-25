import { Plus } from "lucide-react";
import type { PublicPlayer } from "@shared/api/public";
import { DEFAULT_TABLE_SHAPE, PLAN, tableLayout, type FeltOutline, type TableShape } from "@shared/domain/table-layout";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { seatLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  /** How the table is drawn (round 5): an oval, a rectangle (the dealer mid long side) or a round table. */
  shape?: TableShape;
  /** The seats, by number; a number missing here is an empty seat. */
  seats: readonly PlanSeat[];
  /** Seats to ring (the seat finder's matches). */
  highlighted?: ReadonlySet<number>;
  /** Seats a player has just sat down in or moved to: briefly marked, so the room sees who is new. */
  fresh?: ReadonlySet<number>;
  /** The seat of the player the TD has picked up. */
  selectedSeat?: number | null;
  /** Makes every seat a button (the TD's plan); without it the plan only shows. */
  onSeatPress?: (seat: PlanSeat) => void;
  /** A seat button's accessible name (default "Seat 3: Alice Smith" / "Seat 4, empty"). */
  seatLabel?: (seat: PlanSeat) => string;
  /** A change is being saved: the seats ignore presses until it lands. */
  busy?: boolean;
  /** Tighter margins, for a phone's column of tables. */
  compact?: boolean;
  className?: string;
}

export const describeSeat = (seat: PlanSeat): string =>
  seat.player ? `Seat ${seat.seatNumber}: ${seat.player.name}${seat.unpaid ? ", not paid" : ""}` : `Seat ${seat.seatNumber}, empty`;

/** The felt or its rail, as the layout gives it: an ellipse, or a rounded rectangle. */
function Outline({ outline, className, strokeWidth }: { outline: FeltOutline; className: string; strokeWidth?: number }) {
  return outline.kind === "ellipse" ? (
    <ellipse cx={outline.cx} cy={outline.cy} rx={outline.rx} ry={outline.ry} strokeWidth={strokeWidth} className={className} />
  ) : (
    <rect x={outline.x} y={outline.y} width={outline.width} height={outline.height} rx={outline.radius} strokeWidth={strokeWidth} className={className} />
  );
}

/**
 * A table from above, in its real shape (shared/domain/table-layout): the felt, the dealer in the
 * middle of the bottom edge (a long side on a rectangle) and the seats round it, seat 1 on the dealer's
 * left, clockwise, each with the player's photo or initials, the seat number and their first name. The
 * TD's plan makes each seat a button (tap a player, then a seat); the players' plan is a list read in
 * seat order. Drawn in the theme's colours, so it reads in light and dark alike, and in a club's own.
 */
export function TablePlan({
  name,
  seatCount,
  shape = DEFAULT_TABLE_SHAPE,
  seats,
  highlighted,
  fresh,
  selectedSeat = null,
  onSeatPress,
  seatLabel = describeSeat,
  busy = false,
  compact = false,
  className,
}: TablePlanProps) {
  const bySeat = new Map(seats.map((seat) => [seat.seatNumber, seat]));
  const occupied = seats.filter((seat) => seat.player !== null).length;
  const layout = tableLayout(shape, seatCount);

  return (
    <div className={cn(compact ? "px-4 pb-8 pt-5" : "px-5 pb-9 pt-6", className)}>
      {/* The box's shape is PLAN's (400 × 300), so the felt and the seats placed over it line up. */}
      <div role="group" aria-label={`${name}: ${occupied} of ${seatCount} seats taken`} data-shape={shape} className="relative mx-auto aspect-[4/3] w-full max-w-md">
        <svg viewBox={`0 0 ${PLAN.width} ${PLAN.height}`} aria-hidden="true" className="absolute inset-0 h-full w-full">
          <Outline outline={layout.rail} className="fill-primary/30" />
          <Outline outline={layout.felt} strokeWidth={2} className="fill-primary/10 stroke-primary/40" />
          <circle cx={layout.dealer.x} cy={layout.dealer.y} r={10} strokeWidth={1.5} className="fill-card stroke-primary/50" />
          <text x={layout.dealer.x} y={layout.dealer.y + 4} textAnchor="middle" className="fill-foreground text-[11px] font-bold">
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
          {layout.seats.map((point) => {
            const { seatNumber } = point;
            const seat = bySeat.get(seatNumber) ?? { seatNumber, player: null };
            const marks = { highlighted: highlighted?.has(seatNumber) ?? false, fresh: fresh?.has(seatNumber) ?? false };
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
                    <SeatFace seat={seat} interactive selected={selectedSeat === seatNumber} {...marks} />
                  </button>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="sr-only">{describeSeat(seat)}</span>
                    <SeatFace seat={seat} interactive={false} selected={false} {...marks} />
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
  fresh: boolean;
}

/** What a seat looks like: the photo (or "+" for an empty seat the TD can fill), its number, the first name. */
function SeatFace({ seat, interactive, selected, highlighted, fresh }: SeatFaceProps) {
  const { player } = seat;
  return (
    <span aria-hidden="true" className="flex flex-col items-center">
      <span
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-full border-2 bg-card",
          player ? "border-primary/60" : "border-dashed border-control text-muted-foreground",
          fresh && "ring-4 ring-status-live-foreground/70 ring-offset-1 ring-offset-card motion-safe:animate-pulse",
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
      {player ? <span className="mt-0.5 h-4 max-w-[3.5rem] truncate rounded bg-card/90 px-1 text-[11px] font-medium leading-4 text-foreground">{seatLabel(player.name)}</span> : <span className="mt-0.5 h-4" />}
    </span>
  );
}
