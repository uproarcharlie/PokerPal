import { UserMinus, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SeatedEntry } from "../seat-selection";
import { seatText } from "../seating-text";

interface SelectionBarProps {
  selected: SeatedEntry;
  busy: boolean;
  onUnseat: () => void;
  /** Records their bust (none while their registration is not in the page's list yet). */
  onEliminate?: () => void;
  onCancel: () => void;
}

/**
 * Stays at the bottom of the screen while a player is picked up: who, where they sit, what to tap
 * next, and the ways out (eliminate them, unseat them, or put them down).
 */
export function SelectionBar({ selected, busy, onUnseat, onEliminate, onCancel }: SelectionBarProps) {
  return (
    <div
      role="region"
      aria-label="Selected player"
      className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-lg border border-primary bg-card p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between"
      data-testid="selection-bar"
    >
      <p className="text-sm text-foreground" aria-live="polite">
        <span className="font-semibold">{selected.name}</span>
        {selected.seat ? ` · ${seatText(selected.seat)}` : " · waiting for a seat"}
        <span className="block text-muted-foreground">
          {selected.seat ? "Tap an empty seat to move them, or another player to swap seats." : "Tap an empty seat to seat them there."}
        </span>
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        {onEliminate ? (
          <Button type="button" variant="outline" className="text-destructive" busy={busy} onClick={onEliminate} data-testid="selection-eliminate">
            <UserX aria-hidden="true" />
            Eliminate
          </Button>
        ) : null}
        {selected.seat ? (
          <Button type="button" variant="outline" busy={busy} onClick={onUnseat}>
            <UserMinus aria-hidden="true" />
            Unseat
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel}>
          <X aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
