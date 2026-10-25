import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatMoney, ordinal } from "@/lib/format";
import { undistributedNote, type TournamentMoney } from "@/lib/prize-pool";
import { carryTargetName, differenceSentence } from "@shared/domain/prize-difference";

/** How many places the preview names before "+N more". */
const PLACES_SHOWN = 4;

interface PoolPreviewProps {
  /** The money after the change, or null while what is typed is not an amount yet. */
  after: TournamentMoney | null;
  /** The money as it is now. */
  before: TournamentMoney;
  /** The club's name for its AP. */
  label: string;
  /** How many players are entered: places beyond them are not paid while the game runs. */
  entrants: number;
  /** The pool is locked: its payouts have been published to the players. */
  locked: boolean;
  /** What to say while `after` is null. */
  waiting?: string;
  /** Where money carried over goes (PrizePoolDto.carryTarget). */
  carryTarget?: string;
}

/**
 * Why no place would be paid: nobody has entered yet, or the pool is $0 or less (an AP total equal to
 * what came in, a manual pool of $0), which finalize also says (P4REV2R3-MONEY-01).
 */
function noPlacesText(after: TournamentMoney, entrants: number): string {
  if (entrants === 0) return "No places are paid until players enter.";
  return after.breakdown.net <= 0 ? "The prize pool is $0 or less, so no places are paid." : "No places are paid.";
}

/**
 * What a change would pay before it is saved: the pool, the AP taken, where any difference between the
 * prizes as set (a pool fixed by hand, fixed prizes) and the money available goes, in one sentence
 * (round 5, item 16), and the places, as finalize will pay them (shared/domain). The pool sentence is
 * announced as it changes. A locked pool warns that its published payouts change only when the change
 * moves the pool.
 */
export function PoolPreview({ after, before, label, entrants, locked, waiting = "Enter an amount to see the prize pool.", carryTarget }: PoolPreviewProps) {
  const places = after?.display.rows ?? [];
  const undistributed = after ? undistributedNote(after.display, entrants) : null;
  const changed = after !== null && after.breakdown.net !== before.breakdown.net;
  const difference = after ? differenceSentence(after.breakdown.difference, carryTarget ?? carryTargetName(null)) : null;
  return (
    <section aria-label="What will be paid" className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm" data-testid="pool-preview">
      <p aria-live="polite" className="font-medium text-foreground" data-testid="preview-pool">
        {after === null
          ? waiting
          : changed
            ? `Prize pool ${formatMoney(after.breakdown.net)} (now ${formatMoney(before.breakdown.net)})`
            : `Prize pool ${formatMoney(after.breakdown.net)} (unchanged)`}
      </p>
      {after ? (
        <>
          <p className="text-muted-foreground" data-testid="preview-ap">
            {label} {formatMoney(after.breakdown.rake.applied)}
          </p>
          {difference ? (
            <p className="text-foreground" data-testid="preview-difference">
              {difference}
            </p>
          ) : null}
          {places.length > 0 ? (
            <p className="text-muted-foreground" data-testid="preview-places">
              {places
                .slice(0, PLACES_SHOWN)
                .map((place) => `${ordinal(place.position)} ${formatMoney(place.amountCents)}`)
                .join(" · ")}
              {places.length > PLACES_SHOWN ? ` · +${places.length - PLACES_SHOWN} more` : ""}
            </p>
          ) : (
            <p className="text-muted-foreground" data-testid="preview-no-places">
              {noPlacesText(after, entrants)}
            </p>
          )}
          {undistributed ? <p className="text-muted-foreground">{undistributed}</p> : null}
        </>
      ) : null}
      {locked && changed ? (
        <Alert className="p-3">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription data-testid="locked-warning">Prize pool is locked — published payouts will change.</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
