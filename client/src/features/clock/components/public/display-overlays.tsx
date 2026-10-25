import type { ReactNode } from "react";
import type { ClockDisplaySettings } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { usePublicSeating } from "@/features/seating/hooks";
import { formatMoney, ordinal } from "@/lib/format";
import { unpaidNote } from "./display-money";

interface OverlayProps {
  title: string;
  /** The clock in one line, so the room still sees the time while the layer is up. */
  strip: ReactNode;
  children: ReactNode;
}

function Overlay({ title, strip, children }: OverlayProps) {
  return (
    <section aria-label={title} className="fixed inset-0 z-30 overflow-y-auto bg-background/95 px-[4vw] py-[3vh]" data-testid="display-overlay">
      <div className="mb-[2vh] text-center text-[clamp(1.25rem,2.6vw,2.5rem)] font-semibold tabular-nums text-muted-foreground" data-testid="overlay-strip">
        {strip}
      </div>
      <h2 className="mb-[3vh] text-center font-display text-[clamp(2rem,5vw,4.5rem)] font-bold uppercase tracking-wide text-foreground">{title}</h2>
      {children}
    </section>
  );
}

const overlayNote = "text-center text-[clamp(1.25rem,2.5vw,2.5rem)] text-muted-foreground";

/**
 * Everyone's seat, by name, in columns the room can read from across it; asked for only while shown,
 * through the seat finder's own read (it stops once the tournament is over, and here keeps trying a
 * failed first load: nobody stands at the TV to tap Try again).
 */
export function SeatingOverlay({ tournamentId, strip }: { tournamentId: string; strip: ReactNode }) {
  const seating = usePublicSeating(tournamentId, { keepTrying: true });
  const players = seating.data?.players ?? [];
  return (
    <Overlay title="Seats" strip={strip}>
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
        <ul role="list" className="columns-1 gap-[3vw] text-[clamp(1.1rem,2vw,2rem)] sm:columns-2 xl:columns-3">
          {players.map((seat) => (
            <li key={seat.player.id} className="flex break-inside-avoid justify-between gap-4 border-b border-border/60 py-1">
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
