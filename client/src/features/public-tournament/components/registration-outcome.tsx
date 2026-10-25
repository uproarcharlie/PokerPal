import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import type { ClubDto, PublicPlayer } from "@shared/api/public";
import type { RegistrationCreatedDto } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { routes } from "@/app/routes";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { ClubHeader } from "@/components/shared/club-header";
import { MoneyText } from "@/components/shared/money-text";
import { SeatAssignment } from "@/features/seating/components/public/seat-assignment";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { amountDue } from "../registration";
import { waitingListPlaceOf } from "../waiting-list";
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

/** Why the form is not shown: the tournament is over, or its pool is locked. */
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
  /** Who was signed up: their picture, large, so they see it is them (round 5, item 14). */
  player: PublicPlayer | null;
  /** The sign-up's answer: where automatic seating put the player (round 5, item 9), or why not yet. */
  registration: RegistrationCreatedDto | null;
  enteringHighHands: boolean;
  onRegisterAnother: () => void;
}

/** The player's picture (or initials) with a tick on it: who is now registered. */
function RegisteredPlayer({ player }: { player: PublicPlayer }) {
  return (
    <div className="flex flex-col items-center gap-2" data-testid="registered-player">
      <span className="relative">
        <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="xl" className="ring-4 ring-primary/20" />
        <CheckCircle2 className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-card text-primary" aria-hidden="true" />
      </span>
      <p className="text-lg font-semibold text-foreground">{player.name}</p>
    </div>
  );
}

/**
 * Signed up: who, what to pay at the desk, and a way to sign up the next player on the same phone. A
 * sign-up past a full field is on the waiting list (round 5, item 15): it says their number, and that
 * they pay once a place opens and the tournament director accepts them, never that a seat is coming.
 */
export function RegistrationComplete({ tournament, club, player, registration, enteringHighHands, onRegisterAnother }: CompleteProps) {
  const withHighHands = enteringHighHands && offersHighHand(tournament);
  const waitingListPlace = waitingListPlaceOf(registration);
  // Where automatic seating put them; nothing while the tournament has no tables (most clubs never draw any).
  const seating = registration && waitingListPlace === null && !(registration.seating.status === "waiting" && registration.seating.reason === "no_tables") ? registration.seating : null;
  return (
    <>
      <CardHeader className="space-y-4 text-center">
        {club ? <ClubHeader club={club} /> : null}
        <div className="space-y-4 pt-4">
          {player ? <RegisteredPlayer player={player} /> : <CheckCircle2 className="mx-auto h-16 w-16 text-primary" aria-hidden="true" />}
          {waitingListPlace === null ? (
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Registration Complete!</h1>
              <CardDescription className="mt-2">You&apos;re registered for {tournament.name}</CardDescription>
            </div>
          ) : (
            <div data-testid="waiting-list-place">
              <h1 className="text-2xl font-semibold text-foreground">You&apos;re on the waiting list — #{waitingListPlace}</h1>
              <CardDescription className="mt-2">
                {tournament.name} is full right now. When a place opens, the tournament director calls the next player on the list.
              </CardDescription>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {seating ? <SeatAssignment seating={seating} tournamentId={tournament.id} /> : null}
        <div className="space-y-2 rounded-lg bg-muted p-4">
          <p className="text-sm font-medium text-foreground">
            {waitingListPlace === null ? "Please proceed to the payment desk" : "Pay at the desk once you're called in"}
          </p>
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
