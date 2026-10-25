import { useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { useAdjustPrizePool } from "../staff-hooks";

/** The reason "No AP tonight" stores: the staff's feed says "AP set manually to $0 (the rates give $230) - No AP tonight". */
const NO_AP_REASON = "No AP tonight";

/** Whether the AP is taken off for tonight: a manual AP total of $0 (and no pool fixed by hand, which would replace it). */
const isNoApTonight = ({ breakdown }: Pick<PrizePoolDto, "breakdown">) => breakdown.netSource === "ap_override" && breakdown.rake.override === 0;

interface NoApTonightProps {
  tournament: TournamentDetailDto;
  prizePool: PrizePoolDto;
  /** The club's name for its AP, e.g. "AP". */
  label: string;
  /** The viewer runs the club and the tournament is open. */
  canEdit: boolean;
}

/**
 * Item 5: taking the AP off for a night in one tap (a manual AP total of $0, PUT …/adjustment), shown
 * as "AP: none tonight" with "Back to calculated" until the TD puts it back. While the pool is locked
 * its published payouts change, and a prize pool set by hand is replaced by everything collected, so
 * the TD confirms first (R5REV1-AP-01). Nothing for a tournament whose rates take no AP at all, nor for
 * a pool set by hand at or above what came in: it takes no AP already (the club adds the difference),
 * and taking the AP off would only lower a guarantee.
 */
export function NoApTonight({ tournament, prizePool, label, canEdit }: NoApTonightProps) {
  const { toast } = useToast();
  const adjust = useAdjustPrizePool(tournament.id);
  const [confirming, setConfirming] = useState(false);
  const { breakdown } = prizePool;
  const none = isNoApTonight(prizePool);

  const takeOff = async () => {
    const response = await adjust.mutateAsync({ mode: "ap_override", amount: "0.00", reason: NO_AP_REASON });
    toast({ title: `No ${label} tonight`, description: `The prize pool is ${formatMoney(response.prizePool.breakdown.net)}.` });
  };
  const takeOffNow = () =>
    takeOff().catch((error: unknown) => toast({ title: `Could not take the ${label} off`, description: errorMessage(error), variant: "destructive" }));
  const putBack = () =>
    adjust.mutate(
      { mode: "calculated" },
      {
        onSuccess: (response) =>
          toast({ title: `${label} back to the calculated ${formatMoney(response.prizePool.breakdown.rake.calculated)}` }),
        onError: (error) => toast({ title: `Could not put the ${label} back`, description: errorMessage(error), variant: "destructive" }),
      },
    );

  if (none) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2 pl-3" data-testid="no-ap-tonight">
        <span className="flex-1 text-sm font-semibold text-foreground">{label}: none tonight</span>
        {canEdit ? (
          <Button type="button" variant="outline" className="h-11" busy={adjust.isPending} onClick={putBack} data-testid="ap-back-to-calculated">
            <RotateCcw aria-hidden="true" />
            Back to calculated
          </Button>
        ) : null}
      </div>
    );
  }
  const manualPool = breakdown.netSource === "manual_pool";
  // The rates take nothing and nothing is fixed by hand, or the pool fixed by hand takes nothing: there is no AP to take off.
  if (!canEdit || (breakdown.netSource === "calculated" && breakdown.rake.calculated === 0) || (manualPool && breakdown.impliedRake <= 0)) return null;
  const gross = formatMoney(breakdown.gross.total);
  const lockedNote = tournament.prizePoolLocked ? " The prize pool is locked: its published payouts change." : "";
  return (
    <>
      <Button
        type="button"
        className="h-11 w-full sm:w-auto"
        busy={adjust.isPending}
        onClick={() => (tournament.prizePoolLocked || manualPool ? setConfirming(true) : void takeOffNow())}
        data-testid="no-ap"
      >
        <Ban aria-hidden="true" />
        No {label} tonight
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`No ${label} tonight?`}
        description={
          manualPool
            ? `The prize pool is set by hand to ${formatMoney(breakdown.net)}. No ${label} tonight replaces it with everything collected: ${gross}.${lockedNote}`
            : `The prize pool is locked: its published payouts change, to a pool of ${gross} with no ${label}.`
        }
        confirmLabel={`No ${label} tonight`}
        pendingLabel="Saving…"
        confirmTestId="confirm-no-ap"
        onConfirm={takeOff}
      />
    </>
  );
}
