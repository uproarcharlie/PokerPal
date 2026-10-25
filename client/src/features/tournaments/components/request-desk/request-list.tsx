import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { returnSeatAction, returnSeatText, useReturnSeat } from "@/features/seating/waiting-seat";
import type { RebuyBeforeEliminationDetails } from "@shared/api/pending-actions";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { rebuyBeforeEliminationDetails } from "../../staff-api";
import { useConfirmPendingAction, useDismissPendingAction, usePendingActions } from "../../staff-hooks";
import { PendingActionsTable } from "./pending-actions-table";
import { ReentryDialog } from "./reentry-dialog";

/** A confirmation the server sent back for the TD to decide: a re-buy asked for before the player went out. */
interface ReentryQuestion {
  actionId: string;
  details: RebuyBeforeEliminationDetails;
}

interface RequestListProps {
  tournament: Pick<TournamentDetailDto, "id" | "rebuyAmount" | "addonAmount">;
  timeZone: string;
}

/**
 * The player requests waiting (re-buys, add-ons and knockouts asked for from the players' phones),
 * each confirmed (applied once, on the server) or dismissed, followed every DESK_REFRESH_MS while shown.
 * The request desk's list, for the phone's "Approve requests" sheet: a refused request stays with the
 * reason beside it, and a re-buy asked for before the player went out asks the TD what it was.
 */
export function RequestList({ tournament, timeZone }: RequestListProps) {
  const { toast } = useToast();
  const actions = usePendingActions(tournament.id);
  const confirmAction = useConfirmPendingAction(tournament.id);
  const dismissAction = useDismissPendingAction(tournament.id);
  const returnSeat = useReturnSeat(tournament.id);
  // Each request's buttons wait for its own answer, and each answer is handled for its own request.
  const rows = useBusyRows();
  // Why the server last refused to confirm each request: shown beside it until it is confirmed or dismissed.
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [question, setQuestion] = useState<ReentryQuestion | null>(null);
  const forget = (actionId: string) => setRefusals(({ [actionId]: _gone, ...rest }) => rest);

  // One call: the server applies the action and removes it in one transaction, exactly once.
  const confirm = async (actionId: string, reenter?: boolean) => {
    try {
      const data = await rows.run(actionId, () => confirmAction.mutateAsync({ actionId, reenter }));
      forget(actionId);
      setQuestion((open) => (open?.actionId === actionId ? null : open));
      const name = data.registration.player?.name ?? "The player";
      // A re-entry gets their old seat back while it is free, else another one or a wait: the toast says which (R5REV-HOST-04).
      const outcome = data.reentered ? await returnSeat(data.registration.id, name) : null;
      toast({
        title: "Action Confirmed",
        description: data.reentered ? returnSeatText(`${name} is back in with the re-buy`, outcome) : "Player action has been confirmed.",
        action: returnSeatAction(outcome),
      });
    } catch (error) {
      const details = rebuyBeforeEliminationDetails(error);
      if (details) {
        setQuestion({ actionId, details });
        return;
      }
      setQuestion((open) => (open?.actionId === actionId ? null : open));
      setRefusals((current) => ({ ...current, [actionId]: errorMessage(error, "The request could not be confirmed") }));
      toast({ title: "Could not confirm", description: errorMessage(error, "Failed to confirm action. Please try again."), variant: "destructive" });
    }
  };

  // Takes a request off the list without applying it (TN2-02).
  const dismiss = async (actionId: string) => {
    try {
      await rows.run(actionId, () => dismissAction.mutateAsync(actionId));
    } catch (error) {
      toast({ title: "Could not dismiss", description: errorMessage(error, "Please try again."), variant: "destructive" });
    } finally {
      forget(actionId);
    }
  };

  return (
    <>
      <QueryState
        query={actions}
        loading={<LoadingRows rows={3} />}
        errorTitle="The player requests could not be loaded"
        empty={<EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="No pending actions" />}
      >
        {(list) => (
          <PendingActionsTable
            actions={list}
            tournament={tournament}
            timeZone={timeZone}
            refusals={refusals}
            busyIds={rows.busy}
            onConfirm={(actionId) => void confirm(actionId)}
            onDismiss={(actionId) => void dismiss(actionId)}
          />
        )}
      </QueryState>
      <ReentryDialog
        question={question?.details ?? null}
        timeZone={timeZone}
        busy={question !== null && rows.busy.has(question.actionId)}
        onAnswer={(reenter) => question && void confirm(question.actionId, reenter)}
        onCancel={() => setQuestion(null)}
      />
    </>
  );
}
