import { useEffect, useRef } from "react";
import type { PublicRegistration } from "@shared/api/public";
import type { SeatingDto } from "@shared/api/seating";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { usePaidOnly, waitingToSeat } from "../paid-only";
import { useSeating } from "../staff-hooks";

/**
 * What the seating asks of the TD next, in a word or two, in the order the panel's advice puts it; null
 * for nothing. Players still in without a seat while tables are in play ("2 waiting": a late walk-in, a
 * restored bust whose seat was taken) come before an uneven table: they are missing from the seat
 * finder and the TV's seats (TDN2-WAITING-NOT-FLAGGED). With "Paid players only" on, the unpaid ones
 * the TD is holding back are not counted: the badge does not nag about them all night (TDN3-PAIDONLY-RESET).
 */
export function seatingAlert(seating: Pick<SeatingDto, "readOnly" | "suggestions" | "stats"> | undefined, { paidOnly = false }: { paidOnly?: boolean } = {}): string | null {
  if (!seating || seating.readOnly) return null;
  const { finalTable, breakTable, balance } = seating.suggestions;
  if (finalTable) return "Final table";
  if (breakTable) return "Break a table";
  const waiting = waitingToSeat(seating.stats, paidOnly);
  if (seating.stats.activeTables > 0 && waiting > 0) return `${String(waiting)} waiting`;
  return balance.length > 0 ? "Uneven" : null;
}

/** Who is still in, in one string: it changes with an entry, a bust, a restore or a removal. */
const stillIn = (registrations: readonly PublicRegistration[]) =>
  registrations
    .filter((registration) => !registration.isEliminated)
    .map((registration) => registration.id)
    .join(",");

interface SeatingTabLabelProps {
  tournament: TournamentDetailDto;
  /** The tournament's registrations as the page follows them (polled while it is open). */
  registrations: readonly PublicRegistration[];
  /** The Tables & Seating tab is the one shown: its panel follows the seating itself. */
  panelOpen: boolean;
}

/**
 * The Tables & Seating tab's name, with what the seating needs beside it ("Uneven" once a bust has left
 * a table short, "1 waiting" after a late registration): the TD sees it from the other tabs, where most
 * busts and entries are recorded (P4REV0-BUST-FROM-SEAT). It follows the seating itself while another
 * tab is open: asked again whenever someone comes in or goes out (the page's registrations, which follow
 * the door and the floor on every device), every SEATING_BADGE_REFRESH_MS while tables are in play, and
 * with every change this device makes; so a change made on another phone reaches it too
 * (TDN3-BADGE-STALE-OTHER-DEVICE).
 */
export function SeatingTabLabel({ tournament, registrations, panelOpen }: SeatingTabLabelProps) {
  const followed = tournament.viewer.canManage && !isClosedStatus(tournament.status);
  const seating = useSeating(tournament.id, { enabled: followed, poll: panelOpen ? undefined : "badge" });
  const [paidOnly] = usePaidOnly(tournament.id);
  const { refetch } = seating;
  const players = stillIn(registrations);
  const seen = useRef(players);
  useEffect(() => {
    if (!followed || seen.current === players) return;
    seen.current = players;
    // Alongside a refresh this device's own change started, not instead of it.
    void refetch({ cancelRefetch: false });
  }, [followed, players, refetch]);

  const alert = followed ? seatingAlert(seating.data, { paidOnly }) : null;
  return (
    <span className="inline-flex items-center gap-2">
      Tables & Seating
      {alert ? (
        <span className="rounded-full border border-current px-1.5 text-xs font-semibold leading-5" data-testid="seating-tab-alert">
          <span className="sr-only">, </span>
          {alert}
        </span>
      ) : null}
    </span>
  );
}
