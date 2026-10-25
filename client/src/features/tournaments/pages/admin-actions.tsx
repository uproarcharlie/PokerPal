import { useState } from "react";
import { useParams } from "wouter";
import { CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/auth/access-denied";
import { LiveStatus } from "@/components/shared/live-status";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, LoadingRows, PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { figureOf, FigureValue } from "@/components/shared/query-figure";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { errorMessage } from "@/lib/api/http";
import { clubTimeZone } from "@/lib/format";
import type { RebuyBeforeEliminationDetails } from "@shared/api/pending-actions";
import { useClub } from "@/features/clubs/hooks";
import { useWaitingSeat } from "@/features/seating/waiting-seat";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PendingActionsTable } from "../components/request-desk/pending-actions-table";
import { ReentryDialog } from "../components/request-desk/reentry-dialog";
import { TournamentNotFound } from "../components/tournament-not-found";
import { useTournament } from "../hooks";
import { rebuyBeforeEliminationDetails } from "../staff-api";
import { DESK_REFRESH_MS, useConfirmPendingAction, useDismissPendingAction, usePendingActions } from "../staff-hooks";
import { qk } from "@/lib/api/query-keys";

/** The request desk: re-buys, add-ons and knockouts players asked for from their phones, to confirm or dismiss. */
export default function AdminActionsPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const tournament = useTournament(tournamentId);
  usePageMeta({ title: tournament.data ? `${tournament.data.name} requests` : "Player requests" });

  return (
    <QueryState
      query={tournament}
      errorTitle="The tournament could not be loaded"
      notFound={<TournamentNotFound />}
      stateClassName={PAGE_STATE_CLASS}
    >
      {(data) =>
        data.viewer.canManage ? (
          <RequestDesk tournament={data} />
        ) : (
          <AccessDenied
            message="Only this club's owner, its managers and admins can confirm player actions."
            backHref={routes.tournaments()}
            backLabel="Back to Tournaments"
          />
        )
      }
    </QueryState>
  );
}

/** A confirmation the server sent back for the TD to decide: a re-buy asked for before the player went out. */
interface ReentryQuestion {
  actionId: string;
  details: RebuyBeforeEliminationDetails;
}

function RequestDesk({ tournament }: { tournament: TournamentDetailDto }) {
  const { toast } = useToast();
  const club = useClub(tournament.clubId);
  const timeZone = clubTimeZone(club.data);
  const actions = usePendingActions(tournament.id);
  const waitingCount = figureOf(actions, (list) => list.length);
  const confirmAction = useConfirmPendingAction(tournament.id);
  const dismissAction = useDismissPendingAction(tournament.id);
  const waitingSeat = useWaitingSeat(tournament.id);
  // Each request's buttons wait for its own answer, and each answer is handled for its own request.
  const rows = useBusyRows();
  // Why the server last refused to confirm each request: shown beside it until it is confirmed or dismissed.
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [question, setQuestion] = useState<ReentryQuestion | null>(null);
  const forget = (actionId: string) => setRefusals(({ [actionId]: _gone, ...rest }) => rest);

  // One call: the server applies the action and removes it in one transaction, exactly once.
  const confirm = async (actionId: string, reenter?: boolean) => {
    try {
      const data = await rows.run(actionId, () => confirmAction.mutateAsync({ actionId, reenter }));
      forget(actionId);
      setQuestion((open) => (open?.actionId === actionId ? null : open));
      const name = data.registration.player?.name ?? "The player";
      // A re-entry gets their old seat back only while it is free: otherwise they wait, and the toast offers a seat.
      const seatNow = data.reentered ? await waitingSeat(data.registration.id, name) : null;
      toast({
        title: "Action Confirmed",
        description: data.reentered ? `${name} is back in with the re-buy${seatNow ? ", waiting for a seat" : ""}.` : "Player action has been confirmed.",
        action: seatNow ?? undefined,
      });
    } catch (error) {
      const details = rebuyBeforeEliminationDetails(error);
      if (details) {
        setQuestion({ actionId, details });
        return;
      }
      setQuestion((open) => (open?.actionId === actionId ? null : open));
      // A refused request stays pending, with the reason beside it, until it is dismissed; one already handled is gone.
      setRefusals((current) => ({ ...current, [actionId]: errorMessage(error, "The request could not be confirmed") }));
      toast({ title: "Could not confirm", description: errorMessage(error, "Failed to confirm action. Please try again."), variant: "destructive" });
    }
  };

  // Takes a request off the list without applying it (TN2-02).
  const dismiss = async (actionId: string) => {
    try {
      await rows.run(actionId, () => dismissAction.mutateAsync(actionId));
    } catch (error) {
      toast({ title: "Could not dismiss", description: errorMessage(error, "Please try again."), variant: "destructive" });
    } finally {
      forget(actionId);
    }
  };

  return (
    <>
      <PageHeader
        title={tournament.name}
        description="Player Actions Confirmation"
        back={{ href: routes.tournamentAdmin(tournament.id), label: "Tournament" }}
      />
      <div className="space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <LiveStatus follows={[{ queryKey: qk.tournaments.pendingActions(tournament.id), interval: DESK_REFRESH_MS }]} timeZone={timeZone} />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4 md:h-5 md:w-5" aria-hidden="true" />
                Pending Actions
              </CardTitle>
              <CardDescription>Actions waiting for payment confirmation</CardDescription>
            </div>
            {/* How many are waiting once the list is in; never a 0 beside a list still loading (P3REV3-CQ-05). */}
            <Badge
              variant="secondary"
              className="px-3 py-1 text-base md:px-4 md:text-lg"
              aria-label={typeof waitingCount === "object" ? `${waitingCount.value} waiting` : undefined}
              data-testid="pending-actions-count"
            >
              <FigureValue figure={waitingCount} loadingClassName="h-5 w-5" />
            </Badge>
          </CardHeader>
          <CardContent>
            <QueryState
              query={actions}
              loading={<LoadingRows rows={3} />}
              errorTitle="The player requests could not be loaded"
              empty={<EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="No pending actions" />}
            >
              {(list) => (
                <PendingActionsTable
                  actions={list}
                  tournament={tournament}
                  timeZone={timeZone}
                  refusals={refusals}
                  busyIds={rows.busy}
                  onConfirm={(actionId) => void confirm(actionId)}
                  onDismiss={(actionId) => void dismiss(actionId)}
                />
              )}
            </QueryState>
          </CardContent>
        </Card>
      </div>

      <ReentryDialog
        question={question?.details ?? null}
        timeZone={timeZone}
        busy={question !== null && rows.busy.has(question.actionId)}
        onAnswer={(reenter) => question && void confirm(question.actionId, reenter)}
        onCancel={() => setQuestion(null)}
      />
    </>
  );
}
