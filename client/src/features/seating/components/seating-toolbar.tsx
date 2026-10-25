import { useId } from "react";
import { ExternalLink, Plus, Shuffle, UserPlus } from "lucide-react";
import type { SeatingDto } from "@shared/api/seating";
import { absoluteUrl, routes } from "@/app/routes";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { waitingToSeat } from "../paid-only";
import { seatingSummary } from "../seating-text";

interface SeatingToolbarProps {
  tournamentId: string;
  seating: SeatingDto;
  readOnly: boolean;
  /** Which of the toolbar's own changes is being saved, if one is. */
  pending: "seatWaiting" | null;
  /** A change of any kind is being saved: the buttons hold until it lands. */
  busy: boolean;
  paidOnly: boolean;
  onPaidOnlyChange: (paidOnly: boolean) => void;
  onSeatWaiting: () => void;
  onAddTables: () => void;
  onRedraw: () => void;
}

/** Whether anyone still in has not paid (seated, or waiting): only then does "Paid players only" mean anything. */
export const anyUnpaid = (seating: SeatingDto): boolean =>
  seating.stats.unconfirmedUnseated > 0 ||
  seating.tables.some((table) => table.status === "active" && table.seats.some((seat) => seat.registrationId !== null && seat.paymentConfirmed === false));


/**
 * The seating's everyday actions and figures: seat everyone waiting, add tables, redraw everyone, the
 * seat finder's link, whether draws leave out players who have not paid, and "17/27 seats · 10 open · 3
 * waiting".
 */
export function SeatingToolbar({ tournamentId, seating, readOnly, pending, busy, paidOnly, onPaidOnlyChange, onSeatWaiting, onAddTables, onRedraw }: SeatingToolbarProps) {
  const switchId = useId();
  const waiting = waitingToSeat(seating.stats, paidOnly);
  const finderPath = routes.publicSeats(tournamentId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && waiting > 0 ? (
          <Button type="button" busy={busy} onClick={onSeatWaiting} data-testid="seat-waiting">
            <UserPlus aria-hidden="true" />
            {pending === "seatWaiting" ? "Seating…" : `Seat ${waiting} waiting`}
          </Button>
        ) : null}
        {!readOnly ? (
          <>
            <Button type="button" variant="outline" busy={busy} onClick={onAddTables}>
              <Plus aria-hidden="true" />
              Add tables
            </Button>
            <Button type="button" variant="outline" busy={busy} disabled={seating.stats.activePlayers === 0} onClick={onRedraw}>
              <Shuffle aria-hidden="true" />
              Redraw everyone
            </Button>
          </>
        ) : null}
        <CopyLinkButton value={absoluteUrl(finderPath)} label="Copy seat-finder link" />
        <Button variant="ghost" asChild>
          <a href={finderPath} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Open seat finder
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm tabular-nums text-muted-foreground" data-testid="seating-summary">
          {seatingSummary(seating.stats)}
        </p>
        {!readOnly && anyUnpaid(seating) ? (
          <div className="flex items-center gap-2">
            <Switch id={switchId} checked={paidOnly} onCheckedChange={onPaidOnlyChange} />
            <Label htmlFor={switchId}>Paid players only</Label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
