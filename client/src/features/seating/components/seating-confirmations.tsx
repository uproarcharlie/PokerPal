import { useId, useState } from "react";
import type { SeatingDto, TableDto } from "@shared/api/seating";
import { waitingText } from "@shared/domain/seating";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { SeatedEntry, SeatSpotText } from "../seat-selection";
import { plural } from "@/lib/format";
import { leftWaitingText, seatText } from "../seating-text";
import type { SeatingChange } from "../staff-hooks";

type Seated = SeatedEntry & { seat: SeatSpotText };

/** A seating change that asks first: it moves many players, archives a table, or trades two seats. */
export type ConfirmRequest =
  | { kind: "redraw" }
  | { kind: "break" | "remove" | "finalTable"; table: TableDto; returnFocusTo: HTMLElement | null }
  | { kind: "swap"; mover: Seated; occupant: Seated };

interface ConfirmContent {
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  change: SeatingChange;
}

/**
 * Whether the final table at `table` can also seat the players waiting for one ("Include them in the
 * draw"): there are some, and it has a seat for everyone still in.
 */
const canIncludeWaiting = (table: TableDto, stats: SeatingDto["stats"]) => stats.unseated > 0 && table.seatCount >= stats.activePlayers;

/** The final table's question: who it draws (everyone seated, or everyone still in), and who it leaves waiting. */
function finalTableContent(table: TableDto, seating: SeatingDto, includeWaiting: boolean): ConfirmContent {
  const { stats } = seating;
  const including = includeWaiting && canIncludeWaiting(table, stats);
  const drawn = including ? `Everyone still in (${plural(stats.activePlayers, "player")})` : `Everyone seated (${plural(stats.seated, "player")})`;
  const waiting = including ? null : waitingText(stats.unseated, stats.unconfirmedUnseated);
  const unless = canIncludeWaiting(table, stats) ? "unless you include them" : `(${table.displayName} has ${plural(table.seatCount, "seat")})`;
  const left = waiting ? ` ${waiting}: they keep waiting ${unless}.` : "";
  return {
    title: `Draw the final table at ${table.displayName}?`,
    description: `${drawn} gets a new random seat at ${table.displayName}, and the other tables are archived.${left}`,
    confirmLabel: "Draw the final table",
    pendingLabel: "Drawing…",
    change: { kind: "finalTable", input: including ? { tableId: table.id, includeWaiting: true } : { tableId: table.id } },
  };
}

/** The question for `request`, worded from the seating as it is now (a poll may have moved players meanwhile). */
function contentOf(request: ConfirmRequest, seating: SeatingDto, paidOnly: boolean, includeWaiting: boolean): ConfirmContent {
  switch (request.kind) {
    case "redraw":
      return {
        title: "Redraw every seat?",
        description: `Everyone still in (${plural(seating.stats.activePlayers, "player")}) gets a new random seat${
          paidOnly ? "; players who have not paid keep the seats they have" : ""
        }. Use it to start again, not in the middle of play.`,
        confirmLabel: "Redraw seats",
        pendingLabel: "Redrawing…",
        change: { kind: "draw", input: { scope: "all", includeUnconfirmed: !paidOnly } },
      };
    case "swap":
      return {
        title: `Swap ${request.mover.name} and ${request.occupant.name}?`,
        description: `${request.mover.name} goes to ${seatText(request.occupant.seat)} and ${request.occupant.name} to ${seatText(request.mover.seat)}.`,
        confirmLabel: "Swap seats",
        pendingLabel: "Swapping…",
        change: {
          kind: "assign",
          input: { registrationId: request.mover.registrationId, tableId: request.occupant.seat.tableId, seatNumber: request.occupant.seat.seatNumber, swap: true },
        },
      };
    default: {
      const table = seating.tables.find((candidate) => candidate.id === request.table.id) ?? request.table;
      const name = table.displayName;
      if (request.kind === "break") {
        const leftWaiting = leftWaitingText(seating.stats);
        return {
          title: `Break ${name}?`,
          description: `Its ${plural(table.occupied, "player")} move to random empty seats at the other tables, and ${name} is archived (it can be reopened).${leftWaiting ? ` ${leftWaiting}` : ""}`,
          confirmLabel: "Break table",
          pendingLabel: "Breaking…",
          change: { kind: "breakTable", tableId: table.id, input: { expectedVersion: seating.version } },
        };
      }
      if (request.kind === "finalTable") return finalTableContent(table, seating, includeWaiting);
      return {
        title: `Remove ${name}?`,
        description: "Nobody sits at it. A table that has seated players before is archived instead, so its history is kept.",
        confirmLabel: "Remove table",
        pendingLabel: "Removing…",
        destructive: true,
        change: { kind: "removeTable", tableId: table.id },
      };
    }
  }
}

interface SeatingConfirmationsProps {
  request: ConfirmRequest | null;
  seating: SeatingDto;
  paidOnly: boolean;
  onClose: () => void;
  /** Saves the change and reports a refusal itself (it never rejects), so the dialog closes either way. */
  run: (change: SeatingChange) => Promise<void>;
}

/**
 * The one "are you sure?" of the seating panel, for whichever change asked. The final table can also
 * draw the players waiting for a seat, when its table has room for them (TDN4-FINAL-TABLE-WORDS).
 */
export function SeatingConfirmations({ request, seating, paidOnly, onClose, run }: SeatingConfirmationsProps) {
  // The question last asked stays worded while the dialog closes; each new one starts without the waiting players.
  const [shown, setShown] = useState(request);
  const [includeWaiting, setIncludeWaiting] = useState(false);
  if (request !== null && request !== shown) {
    setShown(request);
    setIncludeWaiting(false);
  }
  const includeId = useId();
  const content = shown ? contentOf(shown, seating, paidOnly, includeWaiting) : null;
  const returnFocusTo = shown && "returnFocusTo" in shown && shown.returnFocusTo ? { current: shown.returnFocusTo } : undefined;
  const finalAt = shown?.kind === "finalTable" ? (seating.tables.find((table) => table.id === shown.table.id) ?? shown.table) : null;
  const waiting = waitingText(seating.stats.unseated, seating.stats.unconfirmedUnseated);

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title={content?.title ?? ""}
      description={content?.description ?? ""}
      confirmLabel={content?.confirmLabel ?? "Confirm"}
      pendingLabel={content?.pendingLabel}
      destructive={content?.destructive}
      returnFocusTo={returnFocusTo}
      contentTestId="seating-confirm"
      confirmTestId="seating-confirm-action"
      onConfirm={() => (content ? run(content.change) : undefined)}
    >
      {finalAt && waiting && canIncludeWaiting(finalAt, seating.stats) ? (
        <div className="flex items-start gap-3">
          <Checkbox id={includeId} checked={includeWaiting} onCheckedChange={(checked) => setIncludeWaiting(checked === true)} />
          <Label htmlFor={includeId} className="font-normal leading-snug">
            Include them in the draw
            <span className="block text-muted-foreground">{waiting}.</span>
          </Label>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
