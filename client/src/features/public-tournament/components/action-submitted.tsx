import { ArrowLeft, CheckCircle2 } from "lucide-react";
import type { PublicPlayer } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { PlayerActionType } from "@shared/domain/player-actions";
import { MoneyText } from "@/components/shared/money-text";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription } from "@/components/ui/card";

const SUBMITTED: Readonly<Record<PlayerActionType, string>> = {
  rebuy: "Re-buy request submitted",
  addon: "Add-on request submitted",
  knockout: "Knockout submitted",
};

interface ActionSubmittedProps {
  tournament: TournamentDetailDto;
  actionType: PlayerActionType;
  player: PublicPlayer | null;
  onDone: () => void;
}

/** The request is waiting for the TD: what to pay at the desk for a re-buy or an add-on. */
export function ActionSubmitted({ tournament, actionType, player, onDone }: ActionSubmittedProps) {
  const paid = actionType === "rebuy" || actionType === "addon";
  return (
    <CardContent className="space-y-4">
      <div className="pt-4 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-foreground">Action Submitted!</h1>
        <CardDescription className="mt-2">{SUBMITTED[actionType]}</CardDescription>
      </div>
      <div className="space-y-2 rounded-lg bg-muted p-4">
        <p className="text-sm font-medium text-foreground">Please proceed to the payment desk for confirmation</p>
        {paid && player ? (
          <>
            <p className="text-3xl font-bold text-primary">
              <MoneyText amount={actionType === "rebuy" ? tournament.rebuyAmount : tournament.addonAmount} forceCents />
            </p>
            <p className="text-xs text-muted-foreground">
              {actionType === "rebuy" ? "Re-buy" : "Add-on"} for {player.name}
            </p>
          </>
        ) : null}
      </div>
      <Button onClick={onDone} className="w-full" size="lg">
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        Back to Actions
      </Button>
    </CardContent>
  );
}
