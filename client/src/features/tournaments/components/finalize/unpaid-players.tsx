import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import type { UnpaidPlayerDto } from "@shared/api/finalize";
import { useConfirmPayment } from "../../staff-hooks";
import { highHandLeftText } from "../desk/high-hand-left";

interface UnpaidPlayersProps {
  tournamentId: string;
  /** The preview's players in the field whose payment is not confirmed. */
  unpaid: readonly UnpaidPlayerDto[];
  /** Whether the plan leaves them out (excludeUnpaid). */
  leftOut: boolean;
  onLeaveOut: (leftOut: boolean) => void;
  /** After a payment is confirmed (that player's registration id): the plan must be worked out again (the preview is not a tournament query). */
  onConfirmed: (registrationId: string) => void;
  disabled: boolean;
}

const playersWho = (count: number) => (count === 1 ? "1 player has" : `${count} players have`);

/**
 * Before the payouts (round 6: only paid players are in the prize pool): who in the field has not paid
 * and what each owes, with Confirm payment for each, or Leave them out, which finalizes without them
 * (not ranked, paid or scored). Finalize is refused until one or the other.
 */
export function UnpaidPlayers({ tournamentId, unpaid, leftOut, onLeaveOut, onConfirmed, disabled }: UnpaidPlayersProps) {
  const { toast } = useToast();
  const confirmPayment = useConfirmPayment(tournamentId);
  const rows = useBusyRows();
  if (unpaid.length === 0) return null;

  const confirm = async (player: UnpaidPlayerDto) => {
    try {
      const paid = await rows.run(player.registrationId, () => confirmPayment.mutateAsync(player.registrationId));
      onConfirmed(player.registrationId);
      const confirmed = `${player.playerName} has paid: ${formatMoney(player.amountDueCents)} is in the prize pool.`;
      const left = highHandLeftText(paid.highHandUnawardedCents);
      toast({ title: "Payment Confirmed", description: left ? `${confirmed} ${left}` : confirmed });
    } catch (error) {
      toast({
        title: hasErrorCode(error, "TOURNAMENT_FULL") ? "Tournament full" : "Could not confirm the payment",
        description: errorMessage(error, "Failed to confirm payment. Please try again."),
        variant: "destructive",
      });
    }
  };

  return (
    <Alert variant={leftOut ? "default" : "destructive"} data-testid="finalize-unpaid">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{leftOut ? `Left out: ${unpaid.length} not paid` : `${playersWho(unpaid.length)} not paid`}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {leftOut
            ? "They are not ranked, paid or scored. Confirm a payment to put that player back in."
            : "Their money is not in the prize pool. Confirm each payment, or leave them out: they are then not ranked, paid or scored."}
        </p>
        <ul role="list" className="divide-y divide-border rounded-md border border-border bg-background text-foreground">
          {unpaid.map((player) => (
            <li key={player.registrationId} className="flex items-center gap-3 p-2" data-testid={`unpaid-${player.registrationId}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{player.playerName}</span>
                <span className="block text-xs text-muted-foreground">Owes {formatMoney(player.amountDueCents)}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0"
                onClick={() => void confirm(player)}
                disabled={disabled}
                busy={rows.busy.has(player.registrationId)}
                aria-label={`Confirm ${player.playerName}'s payment`}
              >
                Confirm payment
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          onClick={() => onLeaveOut(!leftOut)}
          disabled={disabled}
          data-testid={leftOut ? "keep-unpaid" : "leave-out-unpaid"}
        >
          {leftOut ? "Don't leave them out" : unpaid.length === 1 ? "Leave them out" : `Leave all ${unpaid.length} out`}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
