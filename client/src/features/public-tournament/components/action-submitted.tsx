import { ArrowLeft, CheckCircle2 } from "lucide-react";
import type { PublicPlayer } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { PlayerActionType } from "@shared/domain/player-actions";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { MoneyText } from "@/components/shared/money-text";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription } from "@/components/ui/card";
import type { SubmittedRequest } from "./action-request-form";

const SUBMITTED: Readonly<Record<PlayerActionType, string>> = {
  rebuy: "Re-buy request submitted",
  addon: "Add-on request submitted",
  knockout: "Knockout submitted",
};

/** A player's photo (or initials) over their name. */
function Pictured({ player, testId }: { player: PublicPlayer; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2" data-testid={testId}>
      {/* On the muted panel, initials need the card behind them to show. */}
      <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="lg" className="bg-card" />
      <p className="break-words text-center text-sm font-semibold text-foreground">{player.name}</p>
    </div>
  );
}

interface ActionSubmittedProps extends SubmittedRequest {
  tournament: TournamentDetailDto;
  actionType: PlayerActionType;
  onDone: () => void;
}

/**
 * The request is waiting for the TD: who it is for, with their photo (and, for a knockout, who went
 * out, with theirs: round 5, item 14), and what to pay at the desk for a re-buy or an add-on.
 */
export function ActionSubmitted({ tournament, actionType, player, target, onDone }: ActionSubmittedProps) {
  const paid = actionType === "rebuy" || actionType === "addon";
  return (
    <CardContent className="space-y-4">
      <div className="pt-4 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-foreground">Action Submitted!</h1>
        <CardDescription className="mt-2">{SUBMITTED[actionType]}</CardDescription>
      </div>
      {actionType === "knockout" && player && target ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg bg-muted p-4">
          <Pictured player={player} testId="knockout-by" />
          <p className="text-sm text-muted-foreground">knocked out</p>
          <Pictured player={target} testId="knockout-target" />
        </div>
      ) : null}
      {paid ? (
        <div className="space-y-3 rounded-lg bg-muted p-4">
          <p className="text-sm font-medium text-foreground">Please proceed to the payment desk for confirmation</p>
          {player ? (
            <div className="flex items-center gap-3">
              <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="lg" className="bg-card" />
              <div className="min-w-0">
                <p className="text-3xl font-bold text-primary">
                  <MoneyText amount={actionType === "rebuy" ? tournament.rebuyAmount : tournament.addonAmount} forceCents />
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {actionType === "rebuy" ? "Re-buy" : "Add-on"} for {player.name}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg bg-muted p-4 text-sm font-medium text-foreground">The tournament director will confirm it at the desk.</p>
      )}
      <Button onClick={onDone} className="w-full" size="lg">
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        Back to Actions
      </Button>
    </CardContent>
  );
}
