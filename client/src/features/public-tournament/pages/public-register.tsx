import { useParams } from "wouter";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { usePageMeta } from "@/app/page-meta";
import { ClubHeader } from "@/components/shared/club-header";
import { CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { QueryState } from "@/components/shared/query-state";
import { useFocusOnChange } from "@/hooks/use-focus-on-change";
import { useClub } from "@/features/clubs/hooks";
import { useRegistrations, useTournament } from "@/features/tournaments/hooks";
import { isClosedStatus } from "@shared/domain/tournaments";
import { CenteredCard, TOURNAMENT_PAGE_STATES } from "../components/page-shell";
import { NewPlayerStep } from "../components/new-player-step";
import { RegistrationClosed, RegistrationComplete } from "../components/registration-outcome";
import { ConfirmStep, ExistingPlayerStep, PlayerTypeStep } from "../components/registration-steps";
import { StepProgress } from "../components/step-progress";
import { POOL_LOCKED_REGISTRATION_MESSAGE, REGISTRATION_CLOSED_MESSAGE, TOURNAMENT_FULL_MESSAGE } from "../messages";
import { useRegistrationFlow } from "../use-registration-flow";

/**
 * Why a player cannot sign up from the QR code now, or null when they can. A full tournament says so
 * before anyone types their details or uploads a photo (TN-03); its staff can still seat a player.
 */
function closedMessage(tournament: TournamentDetailDto, signedUp: readonly PublicRegistration[] | undefined): string | null {
  if (isClosedStatus(tournament.status)) return REGISTRATION_CLOSED_MESSAGE;
  if (tournament.prizePoolLocked) return POOL_LOCKED_REGISTRATION_MESSAGE;
  const full = !tournament.viewer.canManage && (signedUp?.length ?? 0) >= tournament.maxPlayers;
  return full ? TOURNAMENT_FULL_MESSAGE : null;
}

function Registration({ tournament }: { tournament: TournamentDetailDto }) {
  const flow = useRegistrationFlow(tournament.id);
  const { data: club } = useClub(tournament.clubId);
  // Who is already in: a failed count leaves the server to refuse a full tournament.
  const { data: signedUp } = useRegistrations(tournament.id);

  const closed = closedMessage(tournament, signedUp);
  // Each step replaces the last, Continue included: focus goes to the new step.
  const shown = useFocusOnChange<HTMLDivElement>(flow.complete ? "complete" : flow.step);
  if (flow.complete) {
    return (
      <CenteredCard>
        <div ref={shown} tabIndex={-1} className="focus:outline-none">
          <RegistrationComplete tournament={tournament} club={club} enteringHighHands={flow.enteringHighHands} onRegisterAnother={flow.startOver} />
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
      </CardHeader>
      <CardContent ref={shown} tabIndex={-1} className="focus:outline-none" data-testid="registration-step">
        {flow.step === 1 ? <PlayerTypeStep flow={flow} /> : null}
        {flow.step === 2 && flow.playerType === "new" ? <NewPlayerStep flow={flow} /> : null}
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

  return (
    <QueryState query={tournament} {...TOURNAMENT_PAGE_STATES}>
      {(loaded) => <Registration tournament={loaded} />}
    </QueryState>
  );
}
