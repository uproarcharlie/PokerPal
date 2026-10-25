import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PhoneSheet, PhoneSheetBody, PhoneSheetFooter, PhoneSheetHeader } from "@/components/shared/phone-sheet";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import { clubTake } from "@/lib/prize-pool";
import { liveSummary, PoolSummary } from "@/features/prize-pool/components/pool-summary";
import type { FinalizePreviewDto, FinalizePreviewInput } from "@shared/api/finalize";
import { tournamentDeskQueries } from "../../staff-api";
import { useFinalizeTournament } from "../../staff-hooks";
import { useDealDraft } from "./deal";
import { DealPendingNote, DealSection } from "./deal-editor";
import { FinishOrderList, moved, PLAN_CHANGED_NOTICE, PlanTable, PlanWarnings, refusalText, sameOrder } from "./finalize-plan";
import { UnpaidPlayers } from "./unpaid-players";

interface FinalizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
}

/**
 * End Tournament: previews the plan on the server (the same one finalize writes), asks for the
 * finishing order of the players still in and, if they made one, their deal, then finalizes with the
 * preview's plan hash so nothing that changed in between is paid by surprise (409 PLAN_CHANGED shows
 * the new plan instead). A deal is previewed once it adds up, so the plan shown is the one paid. Only
 * paid players are in the pool (round 6): anyone in the field who has not paid is named first, to
 * confirm or leave out, and Finalize waits for that. Full screen on a phone, its Finalize button kept
 * in view under the plan.
 */
export function FinalizeDialog({ open, onOpenChange, tournamentId }: FinalizeDialogProps) {
  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} width="wide" testId="finalize-sheet">
      <PhoneSheetHeader
        icon={<Square className="h-5 w-5 text-destructive" aria-hidden="true" />}
        title="End Tournament"
        description="Check the finishing order and the payouts. Finalizing records every player's position, prize and points and completes the tournament."
      />
      {open ? <FinalizeDialogBody tournamentId={tournamentId} onClose={() => onOpenChange(false)} /> : null}
    </PhoneSheet>
  );
}

const needsOrder = (plan: FinalizePreviewDto | undefined) =>
  plan?.code === "ACTIVE_PLAYERS_NEED_ORDER" || plan?.code === "INVALID_FINISH_ORDER";

function FinalizeDialogBody({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const { toast } = useToast();
  // Registration ids of the players still in, best first; null until the server suggests one.
  const [order, setOrder] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Leave the players who have not paid out of the results (round 6), once the TD says so.
  const [leaveOutUnpaid, setLeaveOutUnpaid] = useState(false);
  const deal = useDealDraft();

  const input: FinalizePreviewInput = {
    ...(order ? { finishOrder: order, ...(deal.deal ? { deal: deal.deal } : {}) } : {}),
    ...(leaveOutUnpaid ? { excludeUnpaid: true } : {}),
  };
  const preview = useQuery({ ...tournamentDeskQueries.finalizePreview(tournamentId, input), placeholderData: keepPreviousData });
  const plan = preview.data;
  const current = plan && !preview.isPlaceholderData ? plan : undefined;

  // Two or more players still in: start from the server's suggested order (as given, else as last
  // finalized, else by id), and again whenever the players still in change. When another device busts
  // players until fewer than two are left, the order sent is stale and no longer needed: drop it, so
  // the next preview goes without one (P2REV1-06). Adjusted while rendering, when a new plan arrives.
  deal.follow(current);
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
      {
        finishOrder: picking ? shownOrder : undefined,
        expectedPlanHash: planHash,
        ...(deal.deal ? { deal: deal.deal } : {}),
        ...(leaveOutUnpaid ? { excludeUnpaid: true } : {}),
      },
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
          if (hasErrorCode(error, "ACTIVE_PLAYERS_NEED_ORDER", "INVALID_FINISH_ORDER", "DEAL_INVALID", "UNPAID_PLAYERS")) void preview.refetch();
          setNotice(errorMessage(error));
        },
      },
    );

  const alreadyFinalized = plan?.requiresForce === true;
  // A missing or stale finishing order is fixed above as soon as it arrives, and unpaid players have their
  // own panel; anything else is shown.
  const refusal =
    current && !current.ok && !alreadyFinalized && !(picking && needsOrder(current)) && current.code !== "UNPAID_PLAYERS" ? refusalText(current) : undefined;
  const canConfirm = current !== undefined && current.ok && !!current.planHash && !alreadyFinalized && !preview.isFetching && deal.ready;

  return (
    <>
      <PhoneSheetBody atFoot={false} className="space-y-4">
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
              <ClubTakeTile prizePool={plan.prizePool} />
            </div>
            {/* Where the money the prizes leave (or need) goes: kept, carried over, added (round 5, item 16). */}
            <PoolSummary figures={liveSummary(plan.prizePool.breakdown, plan.prizePool.rakeLabel, plan.prizePool.carryTarget)} testId="finalize-summary" />

            {!alreadyFinalized ? (
              <UnpaidPlayers
                tournamentId={tournamentId}
                unpaid={plan.unpaid}
                leftOut={leaveOutUnpaid}
                onLeaveOut={(leftOut) => {
                  setNotice(null);
                  setLeaveOutUnpaid(leftOut);
                }}
                onConfirmed={() => void preview.refetch()}
                disabled={finalize.isPending}
              />
            ) : null}

            {picking && !alreadyFinalized ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Finishing order of the players still in</p>
                <p className="text-xs text-muted-foreground">Put the winner at the top. Use the arrows to move a player.</p>
                <FinishOrderList order={shownOrder} nameOf={nameOf} onMove={move} disabled={finalize.isPending} />
              </div>
            ) : null}

            {picking && !alreadyFinalized ? <DealSection deal={deal} order={shownOrder} onEdit={() => setNotice(null)} disabled={finalize.isPending} /> : null}

            <PlanWarnings warnings={plan.warnings} />
            <PlanTable plan={plan} deal={current && deal.deal ? current.dealable : null} />
            <DealPendingNote deal={deal} />

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
      </PhoneSheetBody>

      <PhoneSheetFooter>
        <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onClose} disabled={finalize.isPending}>
          {alreadyFinalized ? "Close" : "Cancel"}
        </Button>
        {!alreadyFinalized ? (
          <Button
            type="button"
            variant="destructive"
            className="h-11 flex-1 sm:flex-none"
            disabled={!canConfirm}
            busy={finalize.isPending}
            onClick={() => current?.planHash && confirm(current.planHash)}
            data-testid="confirm-finalize"
          >
            {finalize.isPending ? "Finalizing…" : "Finalize & Pay Out"}
          </Button>
        ) : null}
      </PhoneSheetFooter>
    </>
  );
}

/** Beside the pool: what the club keeps (or adds), so the two tiles add up to what came in, as the AP panel and the snapshot say. */
function ClubTakeTile({ prizePool }: { prizePool: FinalizePreviewDto["prizePool"] }) {
  const { breakdown } = prizePool;
  const take = clubTake({ impliedCents: breakdown.impliedRake, netSource: breakdown.netSource }, prizePool.rakeLabel);
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{take.label}</p>
      <p className="text-xl font-bold tabular-nums" data-testid="finalize-ap">
        {formatMoney(take.cents)}
      </p>
    </div>
  );
}
