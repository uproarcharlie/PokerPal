import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ClockDisplaySettings } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import type { PublicSeatingDto } from "@shared/api/seating";
import { tableLayout, PLAN, type FeltOutline } from "@shared/domain/table-layout";
import { usePublicSeating } from "@/features/seating/hooks";
import { formatMoney, ordinal, seatLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { unpaidNote } from "./display-money";
import { px, textEm } from "./screen-plan";
import type { StageSize } from "./use-screen";


interface OverlayProps {
  title: string;
  /** The clock in one line, so the room still sees the time while the layer is up. */
  strip: ReactNode;
  /** Beside the title and the clock: which page of the layer is up ("1/3"). */
  marker?: ReactNode;
  size: StageSize;
  /** The screen's edge margin (the same as the clock's). */
  padding: CSSProperties;
  children: ReactNode;
}

/** How tall a layer's title line is, as a share of the screen's height. */
const OVERLAY_HEAD = 0.1;

/** A layer over the whole screen: its title and the clock in one line, then what it shows in the rest, never scrolling. */
function Overlay({ title, strip, marker, size, padding, children }: OverlayProps) {
  const head = Math.max(16, 0.045 * size.height);
  return (
    <section aria-label={title} className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-background" style={padding} data-testid="display-overlay">
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-[2vw] overflow-hidden" style={{ height: px(OVERLAY_HEAD * size.height) }}>
        <h2 className="font-display font-black uppercase tracking-wide text-foreground" style={{ fontSize: px(head), lineHeight: 1.1 }}>
          {title}
        </h2>
        <div className="truncate text-center font-bold tabular-nums text-muted-foreground" style={{ fontSize: px(head * 0.8), lineHeight: 1.2 }} data-testid="overlay-strip">
          {strip}
        </div>
        {marker}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

const overlayNote = (size: StageSize): CSSProperties => ({ fontSize: px(Math.max(16, 0.04 * size.height)), lineHeight: 1.3 });

/** How long each page of tables stays up when they do not all fit on the screen (TDN4-TV-SEATS-OVERFLOW). */
export const SEATS_PAGE_MS = 8000;

/** How long a player just seated or moved stays highlighted on the TV. */
export const NEW_SEAT_MS = 20_000;

/** A table's drawing box in plan units: the plan, room either side for the names, and its caption above. */
const BOX = { width: PLAN.width + 100, height: PLAN.height, caption: 44 } as const;

/** The names' size in plan units (18 is 1.6% of a 1080-line TV's height at the smallest scale allowed). */
const NAME_UNITS = 19;

export interface TableGrid {
  columns: number;
  rows: number;
  perPage: number;
  pages: number;
  /** Pixels per plan unit. */
  scale: number;
}

/**
 * How `count` tables are laid out on an area `width` × `height`: as large as they can be drawn, all
 * on one page when their names can still be read from across the room (at least 2.2% of the height,
 * and 14 px), else as many a page as can be read, the screen turning the pages by itself.
 */
export function tableGrid(count: number, width: number, height: number): TableGrid {
  const gap = 0.02 * Math.min(width, height);
  const minScale = Math.max(14, 0.022 * height) / NAME_UNITS;
  const candidates: TableGrid[] = [];
  for (let rows = 1; rows <= 3; rows++) {
    for (let columns = 1; columns <= 5; columns++) {
      const cellWidth = (width - gap * (columns - 1)) / columns;
      const cellHeight = (height - gap * (rows - 1)) / rows;
      const scale = Math.min(cellWidth / BOX.width, cellHeight / (BOX.height + BOX.caption));
      const perPage = Math.min(Math.max(1, count), rows * columns);
      candidates.push({ columns, rows, perPage, pages: Math.max(1, Math.ceil(count / perPage)), scale });
    }
  }
  const readable = candidates.filter((candidate) => candidate.scale >= minScale);
  // Readable: the fewest pages, then the largest. A screen too small for any (a phone): the largest it can draw.
  const ranked = readable.length > 0 ? readable.sort((a, b) => a.pages - b.pages || b.scale - a.scale) : candidates.sort((a, b) => b.scale - a.scale || a.pages - b.pages);
  return ranked[0];
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

type SeatedPlayer = PublicSeatingDto["players"][number];

/** The highlights not yet over at `now`. */
const stillLit = (lit: ReadonlyMap<string, number>, now: number): Array<[string, number]> => Array.from(lit.entries()).filter(([, until]) => until > now);

/**
 * The players seated or moved since the TV last looked (never on its first look), each for
 * NEW_SEAT_MS: the room sees who just sat down where.
 */
export function useRecentSeats(players: readonly SeatedPlayer[] | undefined): ReadonlySet<string> {
  const previous = useRef<Map<string, string> | null>(null);
  const [recent, setRecent] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    if (!players) return;
    const now = Date.now();
    const seats = new Map(players.map((seat) => [seat.player.id, `${String(seat.tableNumber)}:${String(seat.seatNumber)}`]));
    const before = previous.current;
    previous.current = seats;
    if (!before) return;
    const moved = Array.from(seats.entries())
      .filter(([id, seat]) => before.get(id) !== seat)
      .map(([id]) => id);
    if (moved.length === 0) return;
    setRecent((current) => new Map([...stillLit(current, now), ...moved.map((id): [string, number] => [id, now + NEW_SEAT_MS])]));
  }, [players]);
  useEffect(() => {
    if (recent.size === 0) return;
    const next = Math.min(...Array.from(recent.values()));
    const timer = setTimeout(() => setRecent((current) => new Map(stillLit(current, Date.now()))), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [recent]);
  return new Set(Array.from(recent.keys()));
}

function Felt({ outline, className }: { outline: FeltOutline; className: string }) {
  return outline.kind === "ellipse" ? (
    <ellipse cx={outline.cx} cy={outline.cy} rx={outline.rx} ry={outline.ry} className={className} />
  ) : (
    <rect x={outline.x} y={outline.y} width={outline.width} height={outline.height} rx={outline.radius} className={className} />
  );
}

type SeatingTable = PublicSeatingDto["tables"][number];

/** One table as the room sees it: its shape, the dealer, and each seat's number and player, the newly seated lit up. */
function TvTable({ table, scale, recent }: { table: SeatingTable; scale: number; recent: ReadonlySet<string> }) {
  const layout = tableLayout(table.shape, table.seatCount);
  const byNumber = new Map(table.seats.map((seat) => [seat.seatNumber, seat.player]));
  const side = (BOX.width - PLAN.width) / 2;
  return (
    <figure className="flex flex-col items-center" style={{ width: px(BOX.width * scale) }} aria-hidden="true" data-testid="tv-table">
      <figcaption className="font-display font-black uppercase tracking-wide text-foreground" style={{ fontSize: px(30 * scale), lineHeight: px(BOX.caption * scale) }}>
        {table.displayName}
      </figcaption>
      <div className="relative" style={{ width: px(BOX.width * scale), height: px(BOX.height * scale) }}>
        <svg viewBox={`${String(-side)} 0 ${String(BOX.width)} ${String(BOX.height)}`} className="absolute inset-0 h-full w-full">
          <Felt outline={layout.rail} className="fill-muted stroke-border" />
          <Felt outline={layout.felt} className="fill-primary/20 stroke-primary/40" />
          <circle cx={layout.dealer.x} cy={layout.dealer.y} r={13} className="fill-foreground" />
          <text x={layout.dealer.x} y={layout.dealer.y} dy="0.35em" textAnchor="middle" className="fill-background text-[15px] font-black">
            D
          </text>
        </svg>
        {layout.seats.map((seat) => {
          const player = byNumber.get(seat.seatNumber) ?? null;
          const lit = player !== null && recent.has(player.id);
          return (
            <div
              key={seat.seatNumber}
              className={cn(
                "absolute flex max-w-[30%] -translate-x-1/2 -translate-y-1/2 items-center gap-[0.35em] whitespace-nowrap rounded-full border-2 px-[0.5em] py-[0.15em] font-bold",
                player ? "border-border bg-card text-foreground" : "border-dashed border-border/60 bg-background/60 text-muted-foreground",
                lit && "border-primary bg-primary text-primary-foreground motion-safe:animate-pulse",
              )}
              style={{ left: `${(((seat.x + side) / BOX.width) * 100).toFixed(2)}%`, top: `${seat.top.toFixed(2)}%`, fontSize: px(NAME_UNITS * scale) }}
              data-new={lit || undefined}
            >
              <span className={cn("tabular-nums", lit ? "text-primary-foreground" : "text-muted-foreground")}>{seat.seatNumber}</span>
              {player ? <span className="truncate">{seatLabel(player.name)}</span> : null}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/**
 * Everyone's seat as the tables themselves (round 5, item 18): each table drawn in its shape with the
 * players at their seats, as large as the screen allows and never past it. A wall TV cannot be
 * scrolled, so a room too big for one screen is shown a page of tables at a time, turning by itself;
 * a player just seated or moved is lit up for a while. Screen readers get the list by name. Asked for
 * only while shown, through the seat finder's own read (it stops once the tournament is over, and here
 * keeps trying a failed first load: nobody stands at the TV to tap Try again).
 */
export function SeatingOverlay({ tournamentId, strip, size, padding }: { tournamentId: string; strip: ReactNode; size: StageSize; padding: CSSProperties }) {
  const seating = usePublicSeating(tournamentId, { keepTrying: true });
  const tables = seating.data?.tables ?? [];
  const players = seating.data?.players;
  const recent = useRecentSeats(players);
  const area = { width: size.width, height: size.height * (1 - OVERLAY_HEAD) };
  const grid = tableGrid(tables.length, area.width, area.height);
  const page = usePage(grid.pages);
  const shown = tables.slice(page * grid.perPage, (page + 1) * grid.perPage);
  const marker =
    grid.pages > 1 ? (
      <p className="font-bold tabular-nums text-muted-foreground" style={{ fontSize: px(Math.max(16, 0.036 * size.height)) }} data-testid="seats-page">
        <span className="sr-only">Page </span>
        {page + 1}/{grid.pages}
      </p>
    ) : null;
  return (
    <Overlay title="Seats" strip={strip} marker={marker} size={size} padding={padding}>
      {seating.isPending ? (
        <p role="status" className="text-center text-muted-foreground" style={overlayNote(size)}>
          Loading the seats…
        </p>
      ) : seating.isError && !seating.data ? (
        <p role="alert" className="text-center text-muted-foreground" style={overlayNote(size)}>
          The seats could not be loaded
        </p>
      ) : tables.length === 0 || !players || players.length === 0 ? (
        <p className="text-center text-muted-foreground" style={overlayNote(size)}>
          Seats haven&apos;t been drawn yet
        </p>
      ) : (
        <>
          <div
            className="grid h-full place-content-center justify-items-center"
            style={{ gridTemplateColumns: `repeat(${String(Math.min(grid.columns, shown.length))}, auto)`, gap: px(0.02 * Math.min(area.width, area.height)) }}
            data-testid="seat-tables"
          >
            {shown.map((table) => (
              <TvTable key={table.tableNumber} table={table} scale={grid.scale} recent={recent} />
            ))}
          </div>
          <ul role="list" className="sr-only" data-testid="seat-list">
            {players.map((seat) => (
              <li key={seat.player.id}>
                <span>{seat.player.name}</span>
                <span>
                  {seat.tableName}, Seat {seat.seatNumber}
                </span>
              </li>
            ))}
          </ul>
        </>
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

/** The payouts' columns and size: every place on the one screen, as large as fits. */
export function payoutsLayout(places: readonly string[], width: number, height: number): { columns: number; size: number } {
  const columns = places.length > 10 && width > height ? 2 : 1;
  const rows = Math.max(1, Math.ceil(places.length / columns));
  const widest = places.reduce((wide, place) => Math.max(wide, textEm(place)), 1);
  const columnWidth = width * (columns === 2 ? 0.45 : 0.7);
  return { columns, size: Math.min(0.08 * height, (height * 0.8) / (rows * 1.45), columnWidth / widest) };
}

interface PayoutsOverlayProps {
  money: LiveDisplayDto["money"];
  /** Players entered, for what of the pool no place is paid yet. */
  entrants: number;
  /** The clock's display settings: why no places may be listed. */
  settings: PayoutSettings;
  strip: ReactNode;
  size: StageSize;
  padding: CSSProperties;
}

/** Every paid place, sized to fit the one screen, or why none are listed. */
export function PayoutsOverlay({ money, entrants, settings, strip, size, padding }: PayoutsOverlayProps) {
  const unpaid = unpaidNote(money, entrants);
  const payouts = money.payouts ?? [];
  const area = { width: size.width, height: size.height * (1 - OVERLAY_HEAD) * (unpaid || money.estimated ? 0.82 : 1) };
  const layout = payoutsLayout(payouts.map((payout) => `${ordinal(payout.position)}  ${formatMoney(payout.amountCents)}`), area.width, area.height);
  return (
    <Overlay title="Payouts" strip={strip} size={size} padding={padding}>
      <div className="flex h-full flex-col items-center justify-center" style={{ gap: px(0.02 * size.height) }}>
        {payouts.length > 0 ? (
          <ol role="list" className="grid w-full max-w-5xl gap-x-[4vw]" style={{ gridTemplateColumns: `repeat(${String(layout.columns)}, minmax(0, 1fr))`, fontSize: px(layout.size), lineHeight: 1.45 }}>
            {payouts.map((payout) => (
              <li key={payout.position} className="flex justify-between gap-6 border-b border-border/60 tabular-nums">
                <span className="font-semibold text-muted-foreground">{ordinal(payout.position)}</span>
                <span className="font-extrabold text-foreground">{formatMoney(payout.amountCents)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-center text-muted-foreground" style={overlayNote(size)}>
            {noPayoutsNote(money, settings)}
          </p>
        )}
        {unpaid && payouts.length > 0 ? (
          <p className="text-center text-muted-foreground" style={overlayNote(size)}>
            {unpaid}
          </p>
        ) : null}
        {money.estimated && money.payouts ? (
          <p className="text-center text-muted-foreground" style={overlayNote(size)}>
            Estimated: the pool can still change
          </p>
        ) : null}
      </div>
    </Overlay>
  );
}
