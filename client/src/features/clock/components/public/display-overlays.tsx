import { useEffect, useState, type ReactNode } from "react";
import type { ClockDisplaySettings } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { useMediaQuery } from "@/components/shared/use-media-query";
import { usePublicSeating } from "@/features/seating/hooks";
import { formatMoney, ordinal } from "@/lib/format";
import { unpaidNote } from "./display-money";

interface OverlayProps {
  title: string;
  /** The clock in one line, so the room still sees the time while the layer is up. */
  strip: ReactNode;
  /** Beside the title and the clock: which page of the layer is up ("1/3"). */
  marker?: ReactNode;
  children: ReactNode;
}

/** A layer over the whole screen: its title and the clock in one line, then what it shows in the rest. */
function Overlay({ title, strip, marker, children }: OverlayProps) {
  return (
    <section aria-label={title} className="fixed inset-0 z-30 flex flex-col bg-background/95 px-[4vw] py-[3vh]" data-testid="display-overlay">
      <div className="mb-[2vh] flex flex-wrap items-center justify-center gap-x-[2vw] gap-y-1">
        <h2 className="font-display text-[clamp(1.5rem,3vw,3rem)] font-bold uppercase tracking-wide text-foreground">{title}</h2>
        <div className="text-center text-[clamp(1.25rem,2.6vw,2.5rem)] font-semibold tabular-nums text-muted-foreground" data-testid="overlay-strip">
          {strip}
        </div>
        {marker}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

const overlayNote = "text-center text-[clamp(1.25rem,2.5vw,2.5rem)] text-muted-foreground";

/** How long each page of seats stays up when they do not all fit on the screen (TDN4-TV-SEATS-OVERFLOW). */
export const SEATS_PAGE_MS = 8000;

/** Rows per column: never so few that the names are huge, never so many that they cannot be read across the room. */
const MIN_ROWS = 8;
const MAX_ROWS = 15;

/**
 * How `count` seats are laid out in `columns` columns: as many rows as it takes to show them all, up to
 * MAX_ROWS, then pages of `perPage` that the screen turns through by itself.
 */
export function seatPages(count: number, columns: number): { rows: number; perPage: number; pages: number } {
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.ceil(count / columns)));
  const perPage = rows * columns;
  return { rows, perPage, pages: Math.max(1, Math.ceil(count / perPage)) };
}

/** Columns for the screen's width: one on a phone, two on a tablet, three on a TV. */
function useSeatColumns(): number {
  const wide = useMediaQuery("(min-width: 1280px)");
  const medium = useMediaQuery("(min-width: 640px)");
  return wide ? 3 : medium ? 2 : 1;
}

/** Which page is up: the next one every SEATS_PAGE_MS while there are several. */
function usePage(pages: number): number {
  const [turned, setTurned] = useState(0);
  useEffect(() => {
    if (pages < 2) return;
    const timer = setInterval(() => setTurned((page) => page + 1), SEATS_PAGE_MS);
    return () => clearInterval(timer);
  }, [pages]);
  return turned % pages;
}

/**
 * Everyone's seat, by name, in columns the room can read from across it, sized to fill the screen and
 * never past it: a wall TV cannot be scrolled, so a field too big for one screen is shown a page at a
 * time, turning by itself (TDN4-TV-SEATS-OVERFLOW). Asked for only while shown, through the seat
 * finder's own read (it stops once the tournament is over, and here keeps trying a failed first load:
 * nobody stands at the TV to tap Try again).
 */
export function SeatingOverlay({ tournamentId, strip }: { tournamentId: string; strip: ReactNode }) {
  const seating = usePublicSeating(tournamentId, { keepTrying: true });
  const players = seating.data?.players ?? [];
  const columns = useSeatColumns();
  const { rows, perPage, pages } = seatPages(players.length, columns);
  const page = usePage(pages);
  const shown = players.slice(page * perPage, (page + 1) * perPage);
  const marker =
    pages > 1 ? (
      <p className="text-[clamp(1.25rem,2.6vw,2.5rem)] font-semibold tabular-nums text-muted-foreground" data-testid="seats-page">
        <span className="sr-only">Page </span>
        {page + 1}/{pages}
      </p>
    ) : null;
  return (
    <Overlay title="Seats" strip={strip} marker={marker}>
      {seating.isPending ? (
        <p role="status" className={overlayNote}>
          Loading the seats…
        </p>
      ) : seating.isError && !seating.data ? (
        <p role="alert" className={overlayNote}>
          The seats could not be loaded
        </p>
      ) : players.length === 0 ? (
        <p className={overlayNote}>Seats haven&apos;t been drawn yet</p>
      ) : (
        <ul
          role="list"
          className="grid h-full grid-flow-col gap-x-[3vw]"
          style={{
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            // As large as a row of the screen's height, and as a column of its width, allow.
            fontSize: `clamp(1rem, min(${(6.6 / columns).toFixed(2)}vw, calc(48dvh / ${rows})), 2.75rem)`,
          }}
          data-testid="seat-list"
        >
          {shown.map((seat) => (
            <li key={seat.player.id} className="flex min-w-0 items-center justify-between gap-4 border-b border-border/60 leading-tight">
              <span className="truncate font-semibold text-foreground">{seat.player.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                T{seat.tableNumber} · S{seat.seatNumber}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Overlay>
  );
}

type PayoutSettings = Pick<ClockDisplaySettings, "showPrizePool" | "showPayouts">;

/**
 * What the room is told when the payouts overlay lists no places, for the reason there are none: the
 * pool is not locked yet; the TD chose not to show the pool or the payouts here (no promise of an
 * announcement that will never come); or nobody has entered yet.
 */
export function noPayoutsNote(money: Pick<LiveDisplayDto["money"], "show">, settings: PayoutSettings): string {
  if (!money.show) return settings.showPrizePool === "never" ? "Payouts are not shown on this screen" : "Payouts are announced when the prize pool is locked";
  return settings.showPayouts ? "No places are paid yet" : "Payouts are not shown on this screen";
}

interface PayoutsOverlayProps {
  money: LiveDisplayDto["money"];
  /** Players entered, for what of the pool no place is paid yet. */
  entrants: number;
  /** The clock's display settings: why no places may be listed. */
  settings: PayoutSettings;
  strip: ReactNode;
}

/** Every paid place, or why none are listed. */
export function PayoutsOverlay({ money, entrants, settings, strip }: PayoutsOverlayProps) {
  const unpaid = unpaidNote(money, entrants);
  return (
    <Overlay title="Payouts" strip={strip}>
      {money.payouts && money.payouts.length > 0 ? (
        <ol role="list" className="mx-auto max-w-3xl columns-1 gap-[4vw] text-[clamp(1.25rem,2.6vw,2.75rem)] md:columns-2">
          {money.payouts.map((payout) => (
            <li key={payout.position} className="flex break-inside-avoid justify-between gap-6 border-b border-border/60 py-1 tabular-nums">
              <span className="text-muted-foreground">{ordinal(payout.position)}</span>
              <span className="font-bold text-foreground">{formatMoney(payout.amountCents)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={overlayNote}>{noPayoutsNote(money, settings)}</p>
      )}
      {unpaid && money.payouts && money.payouts.length > 0 ? <p className={`mt-[3vh] ${overlayNote}`}>{unpaid}</p> : null}
      {money.estimated && money.payouts ? <p className={`mt-[3vh] ${overlayNote}`}>Estimated: the pool can still change</p> : null}
    </Overlay>
  );
}
