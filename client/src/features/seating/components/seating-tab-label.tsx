import type { PublicRegistration } from "@shared/api/public";
import type { SeatingDto } from "@shared/api/seating";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { usePaidOnly, waitingToSeat } from "../paid-only";
import { useFollowedSeating } from "../staff-hooks";

/**
 * What the seating asks of the TD next, in a word or two: the table advisor's first piece of advice
 * (round 5) — a table to open, players to seat, the final table, a table to break, uneven tables —
 * else players still in without a seat while tables are in play ("2 waiting": a late walk-in left
 * waiting, a restored bust whose seat was taken), who are missing from the seat finder and the TV's
 * seats (TDN2-WAITING-NOT-FLAGGED); null for nothing. With "Paid players only" on, the unpaid ones the
 * TD is holding back are not counted: the badge does not nag about them all night (TDN3-PAIDONLY-RESET).
 */
export function seatingAlert(seating: Pick<SeatingDto, "readOnly" | "stats" | "advisor"> | undefined, { paidOnly = false }: { paidOnly?: boolean } = {}): string | null {
  if (!seating || seating.readOnly) return null;
  const waiting = waitingToSeat(seating.stats, paidOnly);
  for (const advice of seating.advisor.advice) {
    if (advice.kind === "open_table") return "Open a table";
    if (advice.kind === "final_table") return "Final table";
    if (advice.kind === "break_table") return "Break a table";
    if (advice.kind === "seat_waiting" && waiting > 0) return `${String(waiting)} waiting`;
    if (advice.kind === "balance") return "Uneven";
  }
  if (seating.stats.activeTables > 0 && waiting > 0) return `${String(waiting)} waiting`;
  return null;
}

interface SeatingTabAlertInput {
  tournament: TournamentDetailDto;
  /** The tournament's registrations as the page follows them (polled while it is open). */
  registrations: readonly PublicRegistration[];
  /** The seating tab is the one shown: its panel follows the seating itself. */
  panelOpen: boolean;
}

/**
 * What the seating tab's name says beside it (seatingAlert), following the seating while another tab
 * is open, where most busts and entries are recorded (P4REV0-BUST-FROM-SEAT): asked again whenever
 * someone comes in or goes out (the page's registrations, which follow the door and the floor on every
 * device), every SEATING_BADGE_REFRESH_MS while tables are in play, and with every change this device
 * makes; so a change made on another phone reaches it too (TDN3-BADGE-STALE-OTHER-DEVICE). Null for
 * nothing, and always for a viewer who does not run the tournament or once it is closed.
 */
export function useSeatingTabAlert({ tournament, registrations, panelOpen }: SeatingTabAlertInput): string | null {
  const followed = tournament.viewer.canManage && !isClosedStatus(tournament.status);
  const seating = useFollowedSeating(tournament.id, { registrations, enabled: followed, poll: panelOpen ? undefined : "badge" });
  const [paidOnly] = usePaidOnly(tournament.id);
  return followed ? seatingAlert(seating.data, { paidOnly }) : null;
}

/**
 * The Tables & Seating tab's name, with what the seating needs beside it ("Uneven" once a bust has left
 * a table short, "1 waiting" after a late registration): the TD sees it from the other tabs.
 */
export function SeatingTabLabel(props: SeatingTabAlertInput) {
  const alert = useSeatingTabAlert(props);
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
