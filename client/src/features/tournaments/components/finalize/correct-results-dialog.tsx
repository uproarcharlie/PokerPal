import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PhoneSheet, PhoneSheetBody, PhoneSheetFooter, PhoneSheetHeader } from "@/components/shared/phone-sheet";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formatMoney, ordinal } from "@/lib/format";
import type { FinalizePreviewDto, FinalizePreviewInput } from "@shared/api/finalize";
import { useTournament } from "../../hooks";
import { tournamentDeskQueries } from "../../staff-api";
import { useFinalizeTournament } from "../../staff-hooks";
import { useDealDraft } from "./deal";
import { DealPendingNote, DealSection } from "./deal-editor";
import { FinishOrderList, PLAN_CHANGED_NOTICE, PlanTable, PlanWarnings, refusalText } from "./finalize-plan";
import { UnpaidPlayers } from "./unpaid-players";

export interface Finisher {
  registrationId: string;
  playerName: string;
  /** Whether finalize stored a place for them (assumed when not said): it leaves a player out only for not paying. */
  placed?: boolean;
  /** Whether their payment is confirmed (assumed when not said), until the server's plan says who has not paid. */
  paid?: boolean;
}

interface CorrectResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  /** Everyone in the field: the finishing order finalize stored, best first, then anyone it left out (correctionOrderOf). */
  finishers: readonly Finisher[];
}

/**
 * Correct Results, for a finalized tournament (D19): eliminations can no longer be edited, so a
 * mis-tapped bust is fixed by giving the whole finishing order again. The server previews it (forced),
 * shows what was paid before, and pays the new plan only with that preview's hash. A tournament
 * finalized with a deal starts from that deal again (without it the players still in would be paid
 * their places' payouts); it can be changed or dropped. Only paid players are in the pool (round 6): a
 * player whose payment is not confirmed is confirmed here or left out of the order. It starts as the
 * stored results are: anyone they left out for not paying, and still unpaid, left out again; a payment
 * confirmed here puts that player back in the order, at its foot when they had no place
 * (R6REV1-PHONE-01). Full screen on a phone, like End Tournament, its Finalize Again button kept in view.
 */
export function CorrectResultsDialog({ open, onOpenChange, tournamentId, finishers }: CorrectResultsDialogProps) {
  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} width="wide" testId="correct-results-sheet">
      <PhoneSheetHeader
        title="Correct Results"
        description="Put every player in the order they really finished, winner at the top. Finalizing again replaces the stored positions, prizes and points."
      />
      {open ? <CorrectResultsBody tournamentId={tournamentId} finishers={finishers} onClose={() => onOpenChange(false)} /> : null}
    </PhoneSheet>
  );
}

function CorrectResultsBody({ tournamentId, finishers, onClose }: { tournamentId: string; finishers: readonly Finisher[]; onClose: () => void }) {
  const { toast } = useToast();
  // The whole field, so the order sent always names everyone; the players left out for not paying are kept in it, out of sight.
  const [order, setOrder] = useState<string[]>(() => finishers.map((finisher) => finisher.registrationId));
  const [notice, setNotice] = useState<string | null>(null);
  // Left out again when the stored results left out a player who still has not paid.
  const [leaveOutUnpaid, setLeaveOutUnpaid] = useState(() => finishers.some((finisher) => finisher.placed === false && finisher.paid === false));
  // Who has not paid: as the registrations say until the first plan, then as each plan says.
  const [unpaidIds, setUnpaidIds] = useState<ReadonlySet<string>>(
    () => new Set(finishers.filter((finisher) => finisher.paid === false).map((finisher) => finisher.registrationId)),
  );
  // The player a payment just put back at the foot of the order, to be moved to where they finished.
  const [backIn, setBackIn] = useState<string | null>(null);
  const nameOf = new Map(finishers.map((finisher) => [finisher.registrationId, finisher.playerName]));
  const unplaced = new Set(finishers.filter((finisher) => finisher.placed === false).map((finisher) => finisher.registrationId));
  const tournament = useTournament(tournamentId);
  // A tournament finalized with a deal starts its correction from that deal, once the first plan says who is still in.
  const deal = useDealDraft({ previous: tournament.data ? (tournament.data.prizePoolSnapshot?.deal ?? null) : undefined });
  const shownOrder = leaveOutUnpaid ? order.filter((id) => !unpaidIds.has(id)) : order;
  const input: FinalizePreviewInput = {
    finishOrder: shownOrder,
    force: true,
    ...(deal.deal ? { deal: deal.deal } : {}),
    ...(leaveOutUnpaid ? { excludeUnpaid: true } : {}),
  };

  const preview = useQuery({ ...tournamentDeskQueries.finalizePreview(tournamentId, input), placeholderData: keepPreviousData });
  const plan = preview.data;
  const current = plan && !preview.isPlaceholderData ? plan : undefined;

  deal.follow(current);
  // Who has not paid, as the latest plan says (a payment confirmed here puts that player back in the order).
  const [seen, setSeen] = useState<FinalizePreviewDto | undefined>(undefined);
  if (current !== seen) {
    setSeen(current);
    if (current) setUnpaidIds(new Set(current.unpaid.map((player) => player.registrationId)));
  }

  // Swaps the shown player with the one `delta` places away; the players out of sight keep their places.
  const move = (index: number, delta: -1 | 1) => {
    const other = shownOrder[index + delta];
    if (other === undefined) return;
    setNotice(null);
    setBackIn(null);
    const [a, b] = [order.indexOf(shownOrder[index]), order.indexOf(other)];
    const next = [...order];
    [next[a], next[b]] = [next[b], next[a]];
    setOrder(next);
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
        onError: (error) => {
          if (hasErrorCode(error, "DEAL_INVALID", "UNPAID_PLAYERS")) void preview.refetch();
          setNotice(hasErrorCode(error, "PLAN_CHANGED") ? PLAN_CHANGED_NOTICE : errorMessage(error));
        },
      },
    );

  const canConfirm = current !== undefined && current.ok && !!current.planHash && !preview.isFetching && deal.ready;

  // A payment confirmed in the panel: a player left out is back in the order shown (the next plan is
  // worked out with them); otherwise the plan is worked out again for the same order.
  const confirmed = (registrationId: string) => {
    setNotice(null);
    if (!leaveOutUnpaid || !unpaidIds.has(registrationId)) {
      void preview.refetch();
      return;
    }
    setUnpaidIds(new Set(Array.from(unpaidIds).filter((id) => id !== registrationId)));
    if (unplaced.has(registrationId)) setBackIn(nameOf.get(registrationId) ?? null);
  };

  return (
    <>
      <PhoneSheetBody atFoot={false} className="space-y-4">
        {plan ? (
          <UnpaidPlayers
            tournamentId={tournamentId}
            unpaid={plan.unpaid}
            leftOut={leaveOutUnpaid}
            onLeaveOut={(leftOut) => {
              setNotice(null);
              setBackIn(null);
              setLeaveOutUnpaid(leftOut);
            }}
            onConfirmed={confirmed}
            disabled={correct.isPending}
          />
        ) : null}
        {backIn ? (
          <p role="status" className="text-sm text-foreground" data-testid="back-in-order">
            {backIn} has paid and is back in the order, last: move them up to where they finished.
          </p>
        ) : null}
        <FinishOrderList order={shownOrder} nameOf={nameOf} onMove={move} disabled={correct.isPending} />
        <DealSection deal={deal} order={shownOrder} onEdit={() => setNotice(null)} disabled={correct.isPending} />
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
            <PlanTable plan={plan} deal={current && deal.deal ? current.dealable : null} />
            {/* Unpaid players have their own panel above. */}
            {current && !current.ok && current.code !== "UNPAID_PLAYERS" && refusalText(current) ? (
              <Alert variant="destructive">
                <AlertDescription>{refusalText(current)}</AlertDescription>
              </Alert>
            ) : null}
            <DealPendingNote deal={deal} />
          </>
        ) : null}
        {notice ? (
          <Alert variant="destructive">
            <AlertDescription data-testid="finalize-notice">{notice}</AlertDescription>
          </Alert>
        ) : null}
      </PhoneSheetBody>

      <PhoneSheetFooter>
        <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onClose} disabled={correct.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-11 flex-1 sm:flex-none"
          disabled={!canConfirm}
          busy={correct.isPending}
          onClick={() => current?.planHash && confirm(current.planHash)}
          data-testid="confirm-correction"
        >
          {correct.isPending ? "Finalizing…" : "Finalize Again"}
        </Button>
      </PhoneSheetFooter>
    </>
  );
}
