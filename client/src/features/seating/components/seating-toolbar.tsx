import { useId } from "react";
import { ExternalLink, LayoutGrid, List, Plus, Settings2, Shuffle, UserPlus } from "lucide-react";
import type { SeatingDto } from "@shared/api/seating";
import { absoluteUrl, routes } from "@/app/routes";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { waitingToSeat } from "../paid-only";
import { seatingSummary } from "../seating-text";

/** How the Seats tab shows the tables: drawn in their shape (the default), or listed seat by seat. */
export type SeatingView = "tables" | "list";

interface SeatingToolbarProps {
  tournamentId: string;
  seating: SeatingDto;
  readOnly: boolean;
  /** Which of the toolbar's own changes is being saved, if one is. */
  pending: "seatWaiting" | null;
  /** A change of any kind is being saved: the buttons hold until it lands. */
  busy: boolean;
  paidOnly: boolean;
  /** The advice above already offers to seat the waiting (or to open a table for them): the toolbar does not repeat it. */
  advisedSeating: boolean;
  view: SeatingView;
  onViewChange: (view: SeatingView) => void;
  onPaidOnlyChange: (paidOnly: boolean) => void;
  onSeatWaiting: () => void;
  onAddTables: () => void;
  onRedraw: () => void;
  onSettings: () => void;
}

/** Whether anyone still in has not paid (seated, or waiting): only then does "Paid players only" mean anything. */
export const anyUnpaid = (seating: SeatingDto): boolean =>
  seating.stats.unconfirmedUnseated > 0 ||
  seating.tables.some((table) => table.status === "active" && table.seats.some((seat) => seat.registrationId !== null && seat.paymentConfirmed === false));

const VIEWS: ReadonlyArray<{ view: SeatingView; label: string; icon: typeof List }> = [
  { view: "tables", label: "Tables", icon: LayoutGrid },
  { view: "list", label: "List", icon: List },
];

/**
 * The seating's everyday actions and figures: seat everyone waiting, add tables, redraw everyone, the
 * seat finder's link, the seating settings, whether draws leave out players who have not paid, "17/27
 * seats · 10 open · 3 waiting", and whether the tables are drawn or listed.
 */
export function SeatingToolbar(props: SeatingToolbarProps) {
  const { tournamentId, seating, readOnly, pending, busy, paidOnly, advisedSeating, view, onViewChange, onPaidOnlyChange, onSeatWaiting, onAddTables, onRedraw, onSettings } = props;
  const switchId = useId();
  const waiting = waitingToSeat(seating.stats, paidOnly);
  const finderPath = routes.publicSeats(tournamentId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 [&>*]:min-h-11">
        {!readOnly && waiting > 0 && !advisedSeating ? (
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
            <Button type="button" variant="outline" onClick={onSettings} data-testid="open-seating-settings">
              <Settings2 aria-hidden="true" />
              Settings
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
        <div className="flex flex-wrap items-center gap-3">
          {!readOnly && anyUnpaid(seating) ? (
            <div className="flex items-center gap-2">
              <Switch id={switchId} checked={paidOnly} onCheckedChange={onPaidOnlyChange} />
              <Label htmlFor={switchId}>Paid players only</Label>
            </div>
          ) : null}
          <div role="group" aria-label="Show the tables as" className="inline-flex rounded-md border border-input p-0.5">
            {VIEWS.map(({ view: option, label, icon: Icon }) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={view === option ? "secondary" : "ghost"}
                aria-pressed={view === option}
                className={cn("h-11 min-w-20", view === option && "font-semibold")}
                onClick={() => onViewChange(option)}
                data-testid={`seating-view-${option}`}
              >
                <Icon aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
