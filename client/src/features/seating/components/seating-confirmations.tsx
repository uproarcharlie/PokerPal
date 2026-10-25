import { useState } from "react";
import type { SeatingDto, TableDto } from "@shared/api/seating";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { SeatedEntry, SeatSpotText } from "../seat-selection";
import { plural } from "@/lib/format";
import { seatText } from "../seating-text";
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

/** The question for `request`, worded from the seating as it is now (a poll may have moved players meanwhile). */
function contentOf(request: ConfirmRequest, seating: SeatingDto, paidOnly: boolean): ConfirmContent {
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
        return {
          title: `Break ${name}?`,
          description: `Its ${plural(table.occupied, "player")} move to random empty seats at the other tables, and ${name} is archived (it can be reopened).`,
          confirmLabel: "Break table",
          pendingLabel: "Breaking…",
          change: { kind: "breakTable", tableId: table.id, input: { expectedVersion: seating.version } },
        };
      }
      if (request.kind === "finalTable") {
        return {
          title: `Draw the final table at ${name}?`,
          description: `Everyone still in (${plural(seating.stats.activePlayers, "player")}) gets a new random seat at ${name}, and the other tables are archived.`,
          confirmLabel: "Draw the final table",
          pendingLabel: "Drawing…",
          change: { kind: "finalTable", input: { tableId: table.id } },
        };
      }
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

/** The one "are you sure?" of the seating panel, for whichever change asked. */
export function SeatingConfirmations({ request, seating, paidOnly, onClose, run }: SeatingConfirmationsProps) {
  // The question last asked stays worded while the dialog closes.
  const [shown, setShown] = useState(request);
  if (request !== null && request !== shown) setShown(request);
  const content = shown ? contentOf(shown, seating, paidOnly) : null;
  const returnFocusTo = shown && "returnFocusTo" in shown && shown.returnFocusTo ? { current: shown.returnFocusTo } : undefined;

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
    />
  );
}
