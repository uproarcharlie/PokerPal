import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Lock, RefreshCw, ShoppingCart, Skull } from "lucide-react";
import type { PublicPlayer } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { PlayerActionType } from "@shared/domain/player-actions";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { ClubHeader } from "@/components/shared/club-header";
import { LoadingRows, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatAmount } from "@/lib/format";
import { useFocusOnChange } from "@/hooks/use-focus-on-change";
import { ActionMenu } from "../components/action-menu";
import { ActionRequestForm } from "../components/action-request-form";
import { ActionSubmitted } from "../components/action-submitted";
import { useClub } from "@/features/clubs/hooks";
import { useRegistrations, useTournament } from "@/features/tournaments/hooks";
import { isClosedStatus } from "@shared/domain/tournaments";
import { CenteredCard, TOURNAMENT_PAGE_STATES } from "../components/page-shell";

const ACTION_ICONS: Readonly<Record<PlayerActionType, typeof RefreshCw>> = { rebuy: RefreshCw, addon: ShoppingCart, knockout: Skull };
const ACTION_TITLES: Readonly<Record<PlayerActionType, string>> = { rebuy: "Re-buy", addon: "Add-on", knockout: "Register Knockout" };

function actionHint(tournament: TournamentDetailDto, actionType: PlayerActionType): string {
  if (actionType === "rebuy") return `${formatAmount(tournament.rebuyAmount, { forceCents: true })} - Select player to add re-buy`;
  if (actionType === "addon") return `${formatAmount(tournament.addonAmount, { forceCents: true })} - Select player to purchase add-on`;
  return "Select players involved in elimination";
}

/** A finished or cancelled game takes no more requests: say so instead of offering them (PUB-14). */
function RequestsClosed({ tournament }: { tournament: TournamentDetailDto }) {
  return (
    <CardContent className="space-y-4 text-center">
      <Lock className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground" data-testid="requests-closed">
        This tournament {tournament.status === "cancelled" ? "was cancelled" : "has finished"}, so it takes no more requests.
      </p>
      <Button variant="outline" className="w-full" asChild>
        <Link href={routes.publicTournament(tournament.id)}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Back to Tournament
        </Link>
      </Button>
    </CardContent>
  );
}

function PlayerRequests({ tournament }: { tournament: TournamentDetailDto }) {
  const { data: club } = useClub(tournament.clubId);
  const registrations = useRegistrations(tournament.id);
  const [actionType, setActionType] = useState<PlayerActionType | null>(null);
  const [submitted, setSubmitted] = useState<{ player: PublicPlayer | null } | null>(null);
  // Choosing an action, going back and sending one each replace what was on screen: focus follows.
  const shown = useFocusOnChange<HTMLDivElement>(submitted ? "submitted" : (actionType ?? "menu"));

  // The table moves on while a phone sits in a pocket: check who is in again before each request.
  const choose = (type: PlayerActionType) => {
    setActionType(type);
    void registrations.refetch();
  };
  const startOver = () => {
    setActionType(null);
    setSubmitted(null);
  };

  const Icon = actionType ? ACTION_ICONS[actionType] : null;
  return (
    <CenteredCard>
      <CardHeader className="space-y-4">
        {club ? <ClubHeader club={club} /> : null}
        {submitted ? null : (
          <div ref={shown} tabIndex={-1} className="pt-2 text-center focus:outline-none" data-testid="player-actions-title">
            <h1 className="flex items-center justify-center gap-2 text-xl font-semibold text-foreground">
              {Icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : null}
              {actionType ? ACTION_TITLES[actionType] : tournament.name}
            </h1>
            <CardDescription className="mt-1">{actionType ? actionHint(tournament, actionType) : "Select an action"}</CardDescription>
          </div>
        )}
        {actionType && !submitted ? (
          <Button variant="ghost" size="sm" className="mx-auto" onClick={startOver}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back
          </Button>
        ) : null}
      </CardHeader>

      {isClosedStatus(tournament.status) ? (
        <RequestsClosed tournament={tournament} />
      ) : submitted && actionType ? (
        <div ref={shown} tabIndex={-1} className="focus:outline-none" data-testid="player-action-sent">
          <ActionSubmitted tournament={tournament} actionType={actionType} player={submitted.player} onDone={startOver} />
        </div>
      ) : actionType ? (
        <CardContent>
          <QueryState query={registrations} loading={<LoadingRows rows={2} />} errorTitle="The players could not be loaded">
            {(list) => (
              <ActionRequestForm
                key={actionType}
                tournament={tournament}
                actionType={actionType}
                registrations={list}
                onSubmitted={(player) => setSubmitted({ player })}
              />
            )}
          </QueryState>
        </CardContent>
      ) : (
        <CardContent>
          <ActionMenu tournament={tournament} onChoose={choose} />
        </CardContent>
      )}
    </CenteredCard>
  );
}

/** Where players ask the TD for a re-buy, an add-on or a knockout from their phones. */
export default function PlayerActionsPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const tournament = useTournament(tournamentId);
  usePageMeta({ title: tournament.data ? `Player requests: ${tournament.data.name}` : "Player requests", noindex: true });

  return (
    <QueryState query={tournament} {...TOURNAMENT_PAGE_STATES}>
      {(loaded) => <PlayerRequests tournament={loaded} />}
    </QueryState>
  );
}
