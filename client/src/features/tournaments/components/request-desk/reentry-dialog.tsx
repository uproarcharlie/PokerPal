import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { RebuyBeforeEliminationDetails } from "@shared/api/pending-actions";

interface ReentryDialogProps {
  /** The server's question (409 REBUY_BEFORE_ELIMINATION), or null when there is none. */
  question: RebuyBeforeEliminationDetails | null;
  timeZone: string;
  busy: boolean;
  onAnswer: (reenter: boolean) => void;
  onCancel: () => void;
}

/**
 * A re-buy asked for while the player was still in, who has been knocked out since: the TD says
 * whether it is their buy-back (they go back in) or chips they had before going out (TN-RV2-01).
 */
export function ReentryDialog({ question, timeZone, busy, onAnswer, onCancel }: ReentryDialogProps) {
  const askedAt = question?.requestedAt ? formatTime(question.requestedAt, timeZone) : null;
  const outAt = question?.eliminatedAt ? formatTime(question.eliminatedAt, timeZone) : null;
  return (
    <AlertDialog open={question !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent data-testid="reentry-question">
        <AlertDialogHeader>
          <AlertDialogTitle>Put {question?.playerName} back in?</AlertDialogTitle>
          <AlertDialogDescription>
            {question?.playerName} asked for this re-buy{askedAt ? ` at ${askedAt}` : ""} while still in, and was knocked out
            {outAt ? ` at ${outAt}` : " after that"}. If this re-buy is their buy-back, they go back in. If they had the chips before
            going out, it is only recorded and they stay out.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel aria-disabled={busy || undefined}>Cancel</AlertDialogCancel>
          <Button variant="outline" busy={busy} onClick={() => onAnswer(false)} data-testid="reentry-record-only">
            Record the re-buy only
          </Button>
          <Button busy={busy} onClick={() => onAnswer(true)} data-testid="reentry-back-in">
            Put them back in
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
