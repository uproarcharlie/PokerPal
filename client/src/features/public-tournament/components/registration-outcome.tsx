import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { routes } from "@/app/routes";
import { ClubHeader } from "@/components/shared/club-header";
import { MoneyText } from "@/components/shared/money-text";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { amountDue } from "../registration";
import { offersHighHand } from "@shared/domain/player-actions";

function BackToTournament({ tournamentId, variant }: { tournamentId: string; variant: "outline" | "ghost" }) {
  return (
    <Button variant={variant} className="w-full" size="lg" asChild>
      <Link href={routes.publicTournament(tournamentId)}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        Back to Tournament
      </Link>
    </Button>
  );
}

interface OutcomeProps {
  tournament: TournamentDetailDto;
  club: ClubDto | undefined;
}

/** Why the form is not shown: the tournament is over, its pool is locked, or it is full. */
export function RegistrationClosed({ tournament, club, message }: OutcomeProps & { message: string }) {
  return (
    <>
      <CardHeader className="space-y-4 text-center">
        {club ? <ClubHeader club={club} /> : null}
        <div className="pt-4">
          <Lock className="mx-auto mb-4 h-12 w-12 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground">{tournament.name}</h1>
          <CardDescription className="mt-2" data-testid="registration-closed">
            {message}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <BackToTournament tournamentId={tournament.id} variant="outline" />
      </CardContent>
    </>
  );
}

interface CompleteProps extends OutcomeProps {
  enteringHighHands: boolean;
  onRegisterAnother: () => void;
}

/** Signed up: what to pay at the desk, and a way to sign up the next player on the same phone. */
export function RegistrationComplete({ tournament, club, enteringHighHands, onRegisterAnother }: CompleteProps) {
  const withHighHands = enteringHighHands && offersHighHand(tournament);
  return (
    <>
      <CardHeader className="space-y-4 text-center">
        {club ? <ClubHeader club={club} /> : null}
        <div className="pt-4">
          <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-foreground">Registration Complete!</h1>
          <CardDescription className="mt-2">You&apos;re registered for {tournament.name}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg bg-muted p-4">
          <p className="text-sm font-medium text-foreground">Please proceed to the payment desk</p>
          <p className="text-3xl font-bold text-primary" data-testid="amount-due">
            {amountDue(tournament, enteringHighHands)}
          </p>
          <p className="text-xs text-muted-foreground">
            Buy-in: <MoneyText amount={tournament.buyInAmount} forceCents />
            {withHighHands ? (
              <>
                {" "}
                + High Hands: <MoneyText amount={tournament.highHandAmount} forceCents />
              </>
            ) : null}
          </p>
        </div>
        <div className="space-y-2">
          <Button onClick={onRegisterAnother} variant="outline" className="w-full" size="lg" data-testid="register-another">
            Register Another Player
          </Button>
          <BackToTournament tournamentId={tournament.id} variant="ghost" />
        </div>
      </CardContent>
    </>
  );
}
