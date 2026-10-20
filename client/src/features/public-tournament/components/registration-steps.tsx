import { Trophy, UserPlus, Users } from "lucide-react";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { MoneyText } from "@/components/shared/money-text";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { amountDue } from "../registration";
import type { PlayerType, RegistrationFlow } from "../use-registration-flow";
import { ChoiceTile } from "./choice-tile";
import { PlayerSearch } from "./player-search";
import { offersHighHand } from "@shared/domain/player-actions";

const QUESTION = "text-base font-semibold text-foreground";

/** Step 1: has this player played at the club before? */
export function PlayerTypeStep({ flow }: { flow: RegistrationFlow }) {
  return (
    <div className="space-y-4">
      <p id="player-type-question" className={QUESTION}>
        Are you a new or existing player?
      </p>
      <RadioGroup
        aria-labelledby="player-type-question"
        value={flow.playerType ?? ""}
        onValueChange={(value) => flow.choosePlayerType(value as PlayerType)}
      >
        <ChoiceTile value="new" selected={flow.playerType === "new"} data-testid="player-type-new">
          <UserPlus className="h-5 w-5" aria-hidden="true" />
          New Player
        </ChoiceTile>
        <ChoiceTile value="existing" selected={flow.playerType === "existing"} data-testid="player-type-existing">
          <Users className="h-5 w-5" aria-hidden="true" />
          Existing Player
        </ChoiceTile>
      </RadioGroup>
      <Button onClick={flow.continueFromType} className="h-11 w-full" data-testid="step1-next">
        Continue
      </Button>
    </div>
  );
}

/** Step 2 for a regular: find themselves by name among the club's players. */
export function ExistingPlayerStep({ flow, tournamentId }: { flow: RegistrationFlow; tournamentId: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p id="find-name-question" className={QUESTION}>
          Find Your Name
        </p>
        <PlayerSearch
          tournamentId={tournamentId}
          selected={flow.existingPlayer}
          onSelect={flow.chooseExistingPlayer}
          labelledBy="find-name-question"
        />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1" onClick={flow.back} data-testid="step2-back">
          Back
        </Button>
        <Button className="h-11 flex-1" onClick={flow.continueWithExisting} data-testid="step2-next">
          Continue
        </Button>
      </div>
    </div>
  );
}

/** Step 3: the high hands (when the tournament has one), what is owed at the desk, and the sign-up itself. */
export function ConfirmStep({ flow, tournament }: { flow: RegistrationFlow; tournament: TournamentDetailDto }) {
  return (
    <div className="space-y-4">
      {flow.player ? (
        <p className="text-center text-sm text-muted-foreground" data-testid="registering-as">
          Registering <span className="font-semibold text-foreground">{flow.player.name}</span>
        </p>
      ) : null}

      {offersHighHand(tournament) ? (
        <div className="space-y-4">
          <p id="high-hands-question" className={QUESTION}>
            High Hands Entry
          </p>
          <p className="text-sm text-muted-foreground">
            Enter the high hands competition for an additional <MoneyText amount={tournament.highHandAmount} forceCents />
          </p>
          <RadioGroup
            aria-labelledby="high-hands-question"
            value={flow.enteringHighHands ? "yes" : "no"}
            onValueChange={(value) => flow.setEnteringHighHands(value === "yes")}
          >
            <ChoiceTile value="yes" selected={flow.enteringHighHands} data-testid="high-hands-yes">
              <Trophy className="h-5 w-5" aria-hidden="true" />
              Yes, I&apos;m in!
            </ChoiceTile>
            <ChoiceTile value="no" selected={!flow.enteringHighHands} data-testid="high-hands-no">
              No thanks
            </ChoiceTile>
          </RadioGroup>
        </div>
      ) : (
        <p className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
          High hands competition is not available for this tournament
        </p>
      )}

      <div className="rounded-lg bg-muted p-4">
        <p className="mb-2 text-sm font-medium text-foreground">Total Amount</p>
        <p className="text-3xl font-bold text-foreground">{amountDue(tournament, flow.enteringHighHands)}</p>
      </div>

      {flow.registrationError ? (
        <Alert variant="destructive" data-testid="registration-problem">
          <AlertDescription>{flow.registrationError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1" onClick={flow.back} data-testid="step3-back">
          Back
        </Button>
        <Button className="h-11 flex-1" onClick={flow.completeRegistration} busy={flow.registering} data-testid="complete-registration">
          {flow.registering ? "Registering..." : "Complete Registration"}
        </Button>
      </div>
    </div>
  );
}
