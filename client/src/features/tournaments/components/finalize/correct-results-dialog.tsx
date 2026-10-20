import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formatMoney, ordinal } from "@/lib/format";
import type { FinalizePreviewInput } from "@shared/api/finalize";
import { tournamentDeskQueries } from "../../staff-api";
import { useFinalizeTournament } from "../../staff-hooks";
import { FinishOrderList, moved, PLAN_CHANGED_NOTICE, PlanTable, PlanWarnings } from "./finalize-plan";

export interface Finisher {
  registrationId: string;
  playerName: string;
}

interface CorrectResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  /** Every registration in the finishing order finalize stored, best first. */
  finishers: readonly Finisher[];
}

/**
 * Correct Results, for a finalized tournament (D19): eliminations can no longer be edited, so a
 * mis-tapped bust is fixed by giving the whole finishing order again. The server previews it (forced),
 * shows what was paid before, and pays the new plan only with that preview's hash.
 */
export function CorrectResultsDialog({ open, onOpenChange, tournamentId, finishers }: CorrectResultsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? <CorrectResultsBody tournamentId={tournamentId} finishers={finishers} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CorrectResultsBody({ tournamentId, finishers, onClose }: { tournamentId: string; finishers: readonly Finisher[]; onClose: () => void }) {
  const { toast } = useToast();
  const [order, setOrder] = useState<string[]>(() => finishers.map((finisher) => finisher.registrationId));
  const [notice, setNotice] = useState<string | null>(null);
  const nameOf = new Map(finishers.map((finisher) => [finisher.registrationId, finisher.playerName]));
  const input: FinalizePreviewInput = { finishOrder: order, force: true };

  const preview = useQuery({ ...tournamentDeskQueries.finalizePreview(tournamentId, input), placeholderData: keepPreviousData });
  const plan = preview.data;
  const current = plan && !preview.isPlaceholderData ? plan : undefined;

  const move = (index: number, delta: -1 | 1) => {
    setNotice(null);
    setOrder(moved(order, index, delta));
  };

  const correct = useFinalizeTournament(tournamentId, input);
  const confirm = (planHash: string) =>
    correct.mutate(
      { ...input, expectedPlanHash: planHash },
      {
        onSuccess: () => {
          onClose();
          toast({ title: "Results corrected", description: "The positions, prizes and points have been finalized again." });
        },
        onError: (error) => setNotice(hasErrorCode(error, "PLAN_CHANGED") ? PLAN_CHANGED_NOTICE : errorMessage(error)),
      },
    );

  const canConfirm = current !== undefined && current.ok && !!current.planHash && !preview.isFetching;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Correct Results</DialogTitle>
        <DialogDescription>
          Put every player in the order they really finished, winner at the top. Finalizing again replaces the stored
          positions, prizes and points.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <FinishOrderList order={order} nameOf={nameOf} onMove={move} disabled={correct.isPending} />
        {preview.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(preview.error)}</AlertDescription>
          </Alert>
        ) : plan ? (
          <>
            {plan.previous && plan.previous.rows.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="previous-payouts">
                Paid before:{" "}
                {plan.previous.rows.map((row) => `${ordinal(row.position)} ${row.playerName} ${formatMoney(row.amountCents)}`).join(", ")}
              </p>
            ) : null}
            <PlanWarnings warnings={plan.warnings} />
            <PlanTable plan={plan} />
            {current && !current.ok && current.message ? (
              <Alert variant="destructive">
                <AlertDescription>{current.message}</AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}
        {notice ? (
          <Alert variant="destructive">
            <AlertDescription data-testid="finalize-notice">{notice}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={correct.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!canConfirm}
          busy={correct.isPending}
          onClick={() => current?.planHash && confirm(current.planHash)}
          data-testid="confirm-correction"
        >
          {correct.isPending ? "Finalizing…" : "Finalize Again"}
        </Button>
      </DialogFooter>
    </>
  );
}
