import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import type { FinalizePreviewDto, FinalizePreviewInput } from "@shared/api/finalize";
import { tournamentDeskQueries } from "../../staff-api";
import { useFinalizeTournament } from "../../staff-hooks";
import { FinishOrderList, moved, PLAN_CHANGED_NOTICE, PlanTable, PlanWarnings, sameOrder } from "./finalize-plan";

interface FinalizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
}

/**
 * End Tournament: previews the plan on the server (the same one finalize writes), asks for the
 * finishing order of the players still in, then finalizes with the preview's plan hash so nothing
 * that changed in between is paid by surprise (409 PLAN_CHANGED shows the new plan instead).
 */
export function FinalizeDialog({ open, onOpenChange, tournamentId }: FinalizeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? <FinalizeDialogBody tournamentId={tournamentId} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const needsOrder = (plan: FinalizePreviewDto | undefined) =>
  plan?.code === "ACTIVE_PLAYERS_NEED_ORDER" || plan?.code === "INVALID_FINISH_ORDER";

function FinalizeDialogBody({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const { toast } = useToast();
  // Registration ids of the players still in, best first; null until the server suggests one.
  const [order, setOrder] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const input: FinalizePreviewInput = order ? { finishOrder: order } : {};
  const preview = useQuery({ ...tournamentDeskQueries.finalizePreview(tournamentId, input), placeholderData: keepPreviousData });
  const plan = preview.data;
  const current = plan && !preview.isPlaceholderData ? plan : undefined;

  // Two or more players still in: start from the server's suggested order (as given, else as last
  // finalized, else by id), and again whenever the players still in change. When another device busts
  // players until fewer than two are left, the order sent is stale and no longer needed: drop it, so
  // the next preview goes without one (P2REV1-06). Adjusted while rendering, when a new plan arrives.
  const [seen, setSeen] = useState<FinalizePreviewDto | undefined>(undefined);
  if (current !== seen) {
    setSeen(current);
    if (needsOrder(current)) {
      const suggested = (current?.activePlayers ?? []).map((player) => player.registrationId);
      if (suggested.length >= 2) {
        if (!sameOrder(order, suggested)) setOrder(suggested);
      } else if (order !== null) {
        setOrder(null);
      }
    }
  }

  const activePlayers = plan?.activePlayers ?? [];
  const picking = activePlayers.length >= 2;
  const nameOf = new Map(activePlayers.map((player) => [player.registrationId, player.playerName]));
  const shownOrder = order ?? activePlayers.map((player) => player.registrationId);

  const move = (index: number, delta: -1 | 1) => {
    setNotice(null);
    setOrder(moved(shownOrder, index, delta));
  };

  const finalize = useFinalizeTournament(tournamentId, input);
  const confirm = (planHash: string) =>
    finalize.mutate(
      { finishOrder: picking ? shownOrder : undefined, expectedPlanHash: planHash },
      {
        onSuccess: (result) => {
          onClose();
          toast({ title: "Tournament finalized", description: result.message });
        },
        onError: (error) => {
          if (hasErrorCode(error, "PLAN_CHANGED")) {
            setNotice(PLAN_CHANGED_NOTICE);
            return;
          }
          if (hasErrorCode(error, "ACTIVE_PLAYERS_NEED_ORDER", "INVALID_FINISH_ORDER")) void preview.refetch();
          setNotice(errorMessage(error));
        },
      },
    );

  const alreadyFinalized = plan?.requiresForce === true;
  // A missing or stale finishing order is fixed above as soon as it arrives; anything else is shown.
  const refusal = current && !current.ok && !alreadyFinalized && !(picking && needsOrder(current)) ? current.message : undefined;
  const canConfirm = current !== undefined && current.ok && !!current.planHash && !alreadyFinalized && !preview.isFetching;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Square className="h-5 w-5 text-destructive" aria-hidden="true" />
          End Tournament
        </DialogTitle>
        <DialogDescription>
          Check the finishing order and the payouts. Finalizing records every player&apos;s position, prize and points and
          completes the tournament.
        </DialogDescription>
      </DialogHeader>

      {preview.isPending ? (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Working out the payouts...
        </div>
      ) : preview.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(preview.error)}</AlertDescription>
        </Alert>
      ) : plan ? (
        <div className="space-y-4">
          {alreadyFinalized ? (
            <Alert>
              <AlertDescription data-testid="already-finalized">This tournament has already been finalized.</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Prize pool</p>
              <p className="text-xl font-bold tabular-nums" data-testid="finalize-pool">
                {formatMoney(plan.prizePool.breakdown.net)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{plan.prizePool.rakeLabel}</p>
              <p className="text-xl font-bold tabular-nums">{formatMoney(plan.prizePool.breakdown.rake.applied)}</p>
            </div>
          </div>

          {picking && !alreadyFinalized ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Finishing order of the players still in</p>
              <p className="text-xs text-muted-foreground">Put the winner at the top. Use the arrows to move a player.</p>
              <FinishOrderList order={shownOrder} nameOf={nameOf} onMove={move} disabled={finalize.isPending} />
            </div>
          ) : null}

          <PlanWarnings warnings={plan.warnings} />
          <PlanTable plan={plan} />

          {refusal ? (
            <Alert variant="destructive">
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="finalize-notice">{notice}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={finalize.isPending}>
          {alreadyFinalized ? "Close" : "Cancel"}
        </Button>
        {!alreadyFinalized ? (
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            busy={finalize.isPending}
            onClick={() => current?.planHash && confirm(current.planHash)}
            data-testid="confirm-finalize"
          >
            {finalize.isPending ? "Finalizing…" : "Finalize & Pay Out"}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
