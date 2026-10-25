import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { plural } from "@/lib/format";
import { movesByName, seatText, type AnnouncedMoves } from "../seating-text";

interface SeatMovesDialogProps {
  announced: AnnouncedMoves | null;
  onClose: () => void;
}

/**
 * Who goes where, in large type and by name, so the TD can call the moves out (or show the phone), and
 * who is still waiting for a seat after a break, a balance or the final table.
 */
export function SeatMovesDialog({ announced, onClose }: SeatMovesDialogProps) {
  const moves = announced ? movesByName(announced.moves) : [];
  const excluded = announced?.excludedUnconfirmed ?? 0;
  const waiting = announced?.waiting;
  return (
    <Dialog open={announced !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{announced?.title}</DialogTitle>
          <DialogDescription>{plural(moves.length, "player")} to move. Call them out:</DialogDescription>
        </DialogHeader>
        <ol role="list" className="max-h-[55dvh] divide-y divide-border overflow-y-auto rounded-md border border-border" data-testid="seat-moves">
          {moves.map((move) => (
            <li key={move.registrationId} className="px-3 py-2">
              <p className="text-lg leading-snug text-foreground">
                <span className="font-semibold">{move.playerName}</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> to </span>
                <span>{move.to ? seatText(move.to) : "no seat"}</span>
              </p>
              {move.from ? <p className="text-sm text-muted-foreground">from {seatText(move.from)}</p> : null}
            </li>
          ))}
        </ol>
        {excluded > 0 ? (
          <p className="text-sm text-muted-foreground">
            {plural(excluded, "unpaid player was", "unpaid players were")} left out: seat them once they have paid.
          </p>
        ) : null}
        {waiting ? (
          <p className="text-sm text-foreground" data-testid="still-waiting">
            {waiting.text}: <span className="font-medium">{waiting.names.join(", ")}</span>. {plural(waiting.openSeats, "open seat")} left.
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
