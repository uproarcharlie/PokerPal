import { UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { arrivalText, type Arrival } from "../auto-seat-notices";

interface ArrivalsBannerProps {
  arrivals: readonly Arrival[];
  onDismiss: () => void;
}

/**
 * New arrivals since the Seats tab opened (round 5, item 9): who auto-seat sat down where ("Test
 * Player 16 → Table 2, Seat 7", their seats marked on the plan), and who is waiting for a seat.
 */
export function ArrivalsBanner({ arrivals, onDismiss }: ArrivalsBannerProps) {
  if (arrivals.length === 0) return null;
  return (
    <section aria-label="New arrivals" className="flex items-start gap-3 rounded-lg border border-status-live-foreground/40 bg-status-live/40 p-3" data-testid="seat-arrivals">
      <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-status-live-foreground" aria-hidden="true" />
      <ul role="list" aria-live="polite" className="min-w-0 flex-1 space-y-0.5 text-sm text-foreground">
        {arrivals.map((arrival) => (
          <li key={arrival.registrationId} className="break-words">
            {arrival.seat ? arrivalText({ ...arrival, seat: arrival.seat }) : `${arrival.name} is waiting for a seat`}
          </li>
        ))}
      </ul>
      <Button type="button" variant="ghost" size="icon" className="-my-1 h-11 w-11 shrink-0" aria-label="Dismiss new arrivals" onClick={onDismiss}>
        <X aria-hidden="true" />
      </Button>
    </section>
  );
}
