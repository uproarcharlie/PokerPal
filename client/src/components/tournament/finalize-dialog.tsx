import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiJson, isApiRequestError } from "@/lib/queryClient";
import { ordinal } from "@/lib/prize-pool";
import { formatMoney } from "@shared/domain/money";
import type { FinalizeInput, FinalizePreviewDto, FinalizeResultDto } from "@shared/api/finalize";

interface FinalizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
}

const PLAN_CHANGED_NOTICE =
  "The results changed since this plan was worked out (for example a late re-buy or an elimination). Check the new payouts and confirm again.";

function sameOrder(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * End Tournament: previews the plan on the server (the same one finalize writes), asks for the
 * finishing order of the players still in, then finalizes with the preview's plan hash so nothing
 * that changed in between is paid by surprise (409 PLAN_CHANGED shows the new plan instead).
 */
export function FinalizeDialog({ open, onOpenChange, tournamentId }: FinalizeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {open && <FinalizeDialogBody tournamentId={tournamentId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FinalizeDialogBody({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Registration ids of the players still in, best first; null until the server suggests one.
  const [order, setOrder] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const previewKey = ["/api/tournaments", tournamentId, "finalize-preview", order] as const;
  const preview = useQuery<FinalizePreviewDto>({
    queryKey: previewKey,
    queryFn: () =>
      apiJson<FinalizePreviewDto>("POST", `/api/tournaments/${tournamentId}/finalize/preview`, order ? { finishOrder: order } : {}),
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
  });
  const plan = preview.data;
  const current = plan && !preview.isPlaceholderData ? plan : undefined;

  // Two or more players still in: start from the server's suggested order (as given, else as last
  // finalized, else by id), and again whenever the players still in change. When another device busts
  // players until fewer than two are left, the order sent is stale and no longer needed: drop it, so
  // the next preview goes without one (P2REV1-06).
  useEffect(() => {
    if (!current) return;
    const needsOrder = current.code === "ACTIVE_PLAYERS_NEED_ORDER" || current.code === "INVALID_FINISH_ORDER";
    const suggested = current.activePlayers.map((player) => player.registrationId);
    if (!needsOrder) return;
    if (suggested.length >= 2) {
      if (!sameOrder(order, suggested)) setOrder(suggested);
    } else if (order !== null) {
      setOrder(null);
    }
  }, [current, order]);

  const activePlayers = plan?.activePlayers ?? [];
  const picking = activePlayers.length >= 2;
  const nameOf = new Map(activePlayers.map((player) => [player.registrationId, player.playerName]));
  const shownOrder = order ?? activePlayers.map((player) => player.registrationId);

  const move = (index: number, delta: -1 | 1) => {
    const next = [...shownOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setNotice(null);
    setOrder(next);
  };

  const finalize = useMutation({
    mutationFn: (planHash: string) =>
      apiJson<FinalizeResultDto>("POST", `/api/tournaments/${tournamentId}/finalize`, {
        finishOrder: picking ? shownOrder : undefined,
        expectedPlanHash: planHash,
      }),
    onSuccess: (result) => {
      onClose();
      void queryClient.invalidateQueries({
        queryKey: ["/api/tournaments"],
        predicate: (query) => query.queryKey[2] !== "finalize-preview",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Tournament finalized", description: result.message });
    },
    onError: (error) => {
      if (isApiRequestError(error) && error.code === "PLAN_CHANGED") {
        const fresh = (error.details as { preview?: FinalizePreviewDto } | undefined)?.preview;
        if (fresh) queryClient.setQueryData(previewKey, fresh);
        else void preview.refetch();
        setNotice(PLAN_CHANGED_NOTICE);
        return;
      }
      if (isApiRequestError(error) && (error.code === "ACTIVE_PLAYERS_NEED_ORDER" || error.code === "INVALID_FINISH_ORDER")) {
        void preview.refetch();
      }
      setNotice(error.message);
    },
  });

  const alreadyFinalized = plan?.requiresForce === true;
  // A missing or stale finishing order is fixed above as soon as it arrives; anything else is shown.
  const orderProblem = current?.code === "ACTIVE_PLAYERS_NEED_ORDER" || current?.code === "INVALID_FINISH_ORDER";
  const refusal = current && !current.ok && !alreadyFinalized && !(picking && orderProblem) ? current.message : undefined;
  const canConfirm =
    current !== undefined && current.ok && !!current.planHash && !alreadyFinalized && !preview.isFetching && !finalize.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Square className="w-5 h-5 text-destructive" />
          End Tournament
        </DialogTitle>
        <DialogDescription>
          Check the finishing order and the payouts. Finalizing records every player's position, prize and points and
          completes the tournament.
        </DialogDescription>
      </DialogHeader>

      {preview.isPending ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Working out the payouts...
        </div>
      ) : preview.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{preview.error.message}</AlertDescription>
        </Alert>
      ) : plan ? (
        <div className="space-y-4">
          {alreadyFinalized && (
            <Alert>
              <AlertDescription data-testid="already-finalized">This tournament has already been finalized.</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Prize pool</p>
              <p className="text-xl font-bold" data-testid="finalize-pool">
                {formatMoney(plan.prizePool.breakdown.net)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{plan.prizePool.rakeLabel}</p>
              <p className="text-xl font-bold">{formatMoney(plan.prizePool.breakdown.rake.applied)}</p>
            </div>
          </div>

          {picking && !alreadyFinalized && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Finishing order of the players still in</p>
              <p className="text-xs text-muted-foreground">Put the winner at the top. Use the arrows to move a player.</p>
              <FinishOrderList order={shownOrder} nameOf={nameOf} onMove={move} disabled={finalize.isPending} />
            </div>
          )}

          <PlanWarnings warnings={plan.warnings} />

          <PlanTable plan={plan} />

          {refusal && (
            <Alert variant="destructive">
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <Alert variant="destructive">
              <AlertDescription data-testid="finalize-notice">{notice}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={finalize.isPending}>
          {alreadyFinalized ? "Close" : "Cancel"}
        </Button>
        {!alreadyFinalized && (
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => current?.planHash && finalize.mutate(current.planHash)}
            data-testid="confirm-finalize"
          >
            {finalize.isPending ? "Finalizing..." : "Finalize & Pay Out"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** An up/down list of players, best first. */
function FinishOrderList({
  order,
  nameOf,
  onMove,
  disabled,
}: {
  order: readonly string[];
  nameOf: ReadonlyMap<string, string>;
  onMove: (index: number, delta: -1 | 1) => void;
  disabled: boolean;
}) {
  return (
    <ol className="divide-y divide-border rounded-md border border-border" aria-label="Finishing order">
      {order.map((registrationId, index) => {
        const name = nameOf.get(registrationId) ?? "Unknown player";
        return (
          <li key={registrationId} className="flex items-center gap-3 p-2" data-testid={`finish-order-${index + 1}`}>
            <span className="w-10 text-sm font-semibold text-muted-foreground">{ordinal(index + 1)}</span>
            <span className="flex-1 font-medium">{name}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onMove(index, -1)}
              disabled={index === 0 || disabled}
              aria-label={`Move ${name} up`}
            >
              <ArrowUp className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onMove(index, 1)}
              disabled={index === order.length - 1 || disabled}
              aria-label={`Move ${name} down`}
            >
              <ArrowDown className="w-4 h-4" />
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

/** The preview's warnings (pool not locked, requests that will be discarded, points that change, ...). */
function PlanWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Alert>
      <AlertTriangle className="w-4 h-4" />
      <AlertDescription>
        <ul className="list-disc pl-4 space-y-1" data-testid="finalize-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/**
 * What finalize will write: every place, prize and points. On a correction each row's points sit
 * beside the points stored before, and the column stays whenever either has points, so points that
 * would go away are never hidden (P2REV1-01).
 */
function PlanTable({ plan }: { plan: FinalizePreviewDto }) {
  if (plan.rows.length === 0) return null;
  const before = new Map((plan.previous?.results ?? []).map((result) => [result.registrationId, result.pointsAwarded]));
  const correcting = plan.previous !== null;
  const showPoints = plan.rows.some((row) => row.pointsAwarded !== null || (before.get(row.registrationId) ?? null) !== null);
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-border">
      <table className="w-full text-sm" data-testid="finalize-plan">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-3 py-2 text-left">Place</th>
            <th className="px-3 py-2 text-left">Player</th>
            <th className="px-3 py-2 text-right">Prize</th>
            {showPoints && <th className="px-3 py-2 text-right">Points</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {plan.rows.map((row) => (
            <tr key={row.registrationId}>
              <td className="px-3 py-2">{ordinal(row.finalPosition)}</td>
              <td className="px-3 py-2">{row.playerName}</td>
              <td className="px-3 py-2 text-right font-semibold">{row.amountCents > 0 ? formatMoney(row.amountCents) : "-"}</td>
              {showPoints && (
                <td className="px-3 py-2 text-right" data-testid={`plan-points-${row.registrationId}`}>
                  {row.pointsAwarded ?? "-"}
                  {correcting && (before.get(row.registrationId) ?? null) !== row.pointsAwarded && (
                    <span className="ml-1 text-xs text-muted-foreground">(was {before.get(row.registrationId) ?? "-"})</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {open && <CorrectResultsBody tournamentId={tournamentId} finishers={finishers} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CorrectResultsBody({ tournamentId, finishers, onClose }: { tournamentId: string; finishers: readonly Finisher[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [order, setOrder] = useState<string[]>(() => finishers.map((finisher) => finisher.registrationId));
  const [notice, setNotice] = useState<string | null>(null);
  const nameOf = new Map(finishers.map((finisher) => [finisher.registrationId, finisher.playerName]));
  const request: FinalizeInput = { finishOrder: order, force: true };

  const previewKey = ["/api/tournaments", tournamentId, "finalize-preview", "correct", order] as const;
  const preview = useQuery<FinalizePreviewDto>({
    queryKey: previewKey,
    queryFn: () => apiJson<FinalizePreviewDto>("POST", `/api/tournaments/${tournamentId}/finalize/preview`, request),
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
  });
  const plan = preview.data;
  const current = plan && !preview.isPlaceholderData ? plan : undefined;

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setNotice(null);
    setOrder(next);
  };

  const correct = useMutation({
    mutationFn: (planHash: string) =>
      apiJson<FinalizeResultDto>("POST", `/api/tournaments/${tournamentId}/finalize`, { ...request, expectedPlanHash: planHash }),
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({
        queryKey: ["/api/tournaments"],
        predicate: (query) => query.queryKey[2] !== "finalize-preview",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Results corrected", description: "The positions, prizes and points have been finalized again." });
    },
    onError: (error) => {
      if (isApiRequestError(error) && error.code === "PLAN_CHANGED") {
        const fresh = (error.details as { preview?: FinalizePreviewDto } | undefined)?.preview;
        if (fresh) queryClient.setQueryData(previewKey, fresh);
        else void preview.refetch();
        setNotice(PLAN_CHANGED_NOTICE);
        return;
      }
      setNotice(error.message);
    },
  });

  const canConfirm = current !== undefined && current.ok && !!current.planHash && !preview.isFetching && !correct.isPending;

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
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        ) : plan ? (
          <>
            {plan.previous && plan.previous.rows.length > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="previous-payouts">
                Paid before: {plan.previous.rows.map((row) => `${ordinal(row.position)} ${row.playerName} ${formatMoney(row.amountCents)}`).join(", ")}
              </p>
            )}
            <PlanWarnings warnings={plan.warnings} />
            <PlanTable plan={plan} />
            {current && !current.ok && current.message && (
              <Alert variant="destructive">
                <AlertDescription>{current.message}</AlertDescription>
              </Alert>
            )}
          </>
        ) : null}
        {notice && (
          <Alert variant="destructive">
            <AlertDescription data-testid="finalize-notice">{notice}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={correct.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!canConfirm}
          onClick={() => current?.planHash && correct.mutate(current.planHash)}
          data-testid="confirm-correction"
        >
          {correct.isPending ? "Finalizing..." : "Finalize Again"}
        </Button>
      </DialogFooter>
    </>
  );
}
