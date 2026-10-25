import { useParams } from "wouter";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { usePageMeta } from "@/app/page-meta";
import { ClubHeader } from "@/components/shared/club-header";
import { CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { QueryState } from "@/components/shared/query-state";
import { useFocusOnChange } from "@/hooks/use-focus-on-change";
import { ClubThemeScope } from "@/features/branding/components/public/club-theme-scope";
import { useClub } from "@/features/clubs/hooks";
import { useRegistrations, useTournament } from "@/features/tournaments/hooks";
import { isClosedStatus } from "@shared/domain/tournaments";
import { CenteredCard, TOURNAMENT_PAGE_STATES } from "../components/page-shell";
import { NewPlayerStep } from "../components/new-player-step";
import { RegistrationClosed, RegistrationComplete } from "../components/registration-outcome";
import { ConfirmStep, ExistingPlayerStep, PlayerTypeStep } from "../components/registration-steps";
import { StepProgress } from "../components/step-progress";
import { POOL_LOCKED_REGISTRATION_MESSAGE, REGISTRATION_CLOSED_MESSAGE } from "../messages";
import { useRegistrationFlow } from "../use-registration-flow";
import { lineupOf, nextSignUpPlace } from "../waiting-list";

/** Why a player cannot sign up from the QR code now, or null when they can. */
function closedMessage(tournament: TournamentDetailDto): string | null {
  if (isClosedStatus(tournament.status)) return REGISTRATION_CLOSED_MESSAGE;
  if (tournament.prizePoolLocked) return POOL_LOCKED_REGISTRATION_MESSAGE;
  return null;
}

/**
 * A full field, said before anyone types their details or uploads a photo (TN-03): signing up still
 * works, onto the waiting list (round 5, item 15), and the player sees the number they would get.
 */
function WaitingListNotice({ tournament, signedUp }: { tournament: TournamentDetailDto; signedUp: readonly PublicRegistration[] | undefined }) {
  const place = signedUp ? nextSignUpPlace(lineupOf(signedUp, tournament.maxPlayers), tournament.maxPlayers) : null;
  if (place === null) return null;
  return (
    <p className="rounded-md border border-border bg-muted px-3 py-2 text-center text-sm text-foreground" data-testid="waiting-list-notice">
      This tournament is full. You can still sign up: you&apos;ll be <span className="font-semibold">#{place}</span> on the waiting list, and the
      tournament director calls the next player when a place opens.
    </p>
  );
}

function Registration({ tournament }: { tournament: TournamentDetailDto }) {
  const flow = useRegistrationFlow(tournament.id);
  const { data: club } = useClub(tournament.clubId);
  // Who is already in, for the waiting-list notice: a failed count leaves the server to number the sign-up.
  const { data: signedUp } = useRegistrations(tournament.id);

  const closed = closedMessage(tournament);
  // Each step (and each part of a new player's step 2) replaces the last, Continue included: focus goes to it.
  const shown = useFocusOnChange<HTMLDivElement>(flow.complete ? "complete" : flow.view);
  if (flow.complete) {
    return (
      <CenteredCard>
        <div ref={shown} tabIndex={-1} className="focus:outline-none">
          <RegistrationComplete
            tournament={tournament}
            club={club}
            player={flow.player}
            registration={flow.registration}
            enteringHighHands={flow.enteringHighHands}
            onRegisterAnother={flow.startOver}
          />
        </div>
      </CenteredCard>
    );
  }
  if (closed) {
    return (
      <CenteredCard>
        <RegistrationClosed tournament={tournament} club={club} message={closed} />
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <CardHeader className="space-y-4">
        {club ? <ClubHeader club={club} /> : null}
        <div className="pt-2 text-center">
          <h1 className="text-xl font-semibold text-foreground">{tournament.name}</h1>
          <CardDescription className="mt-1">Tournament Registration</CardDescription>
        </div>
        <StepProgress step={flow.step} />
        <WaitingListNotice tournament={tournament} signedUp={signedUp} />
      </CardHeader>
      <CardContent ref={shown} tabIndex={-1} className="focus:outline-none" data-testid="registration-step">
        {flow.step === 1 ? <PlayerTypeStep flow={flow} /> : null}
        {flow.step === 2 && flow.playerType === "new" ? <NewPlayerStep flow={flow} club={club} /> : null}
        {flow.step === 2 && flow.playerType === "existing" ? <ExistingPlayerStep flow={flow} tournamentId={tournament.id} /> : null}
        {flow.step === 3 ? <ConfirmStep flow={flow} tournament={tournament} /> : null}
      </CardContent>
    </CenteredCard>
  );
}

/** The QR code's page: a player signs themselves up for the tournament from their phone. */
export default function PublicRegisterPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const tournament = useTournament(tournamentId);
  usePageMeta({ title: tournament.data ? `Register: ${tournament.data.name}` : "Register", noindex: true });

  // In the club's own colours (round 5, item 13), around every state so a half-filled form is never remounted.
  return (
    <ClubThemeScope clubId={tournament.data?.clubId} scheme="light">
      <QueryState query={tournament} {...TOURNAMENT_PAGE_STATES}>
        {(loaded) => <Registration tournament={loaded} />}
      </QueryState>
    </ClubThemeScope>
  );
}
