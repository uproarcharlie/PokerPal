import { useParams } from "wouter";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/auth/access-denied";
import { LiveStatus } from "@/components/shared/live-status";
import { PageHeader } from "@/components/shared/page-header";
import { PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { figureOf, FigureValue } from "@/components/shared/query-figure";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { clubTimeZone } from "@/lib/format";
import { ClubThemeScope } from "@/features/branding/components/public/club-theme-scope";
import { useClub } from "@/features/clubs/hooks";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { RequestList } from "../components/request-desk/request-list";
import { TournamentNotFound } from "../components/tournament-not-found";
import { useTournament } from "../hooks";
import { DESK_REFRESH_MS, usePendingActions } from "../staff-hooks";
import { qk } from "@/lib/api/query-keys";

/** The request desk: re-buys, add-ons and knockouts players asked for from their phones, to confirm or dismiss. */
export default function AdminActionsPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const tournament = useTournament(tournamentId);
  usePageMeta({ title: tournament.data ? `${tournament.data.name} requests` : "Player requests" });

  // The club's own colours (round 5, item 13) on its tournament pages, in the light or dark the TD chose.
  return (
    <ClubThemeScope clubId={tournament.data?.clubId} scheme="preference">
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
    </ClubThemeScope>
  );
}

function RequestDesk({ tournament }: { tournament: TournamentDetailDto }) {
  const club = useClub(tournament.clubId);
  const timeZone = clubTimeZone(club.data);
  const actions = usePendingActions(tournament.id);
  const waitingCount = figureOf(actions, (list) => list.length);

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
            {/* The same list (confirm, dismiss, refusals, the re-entry question) as the TD's phone "Approve requests" sheet. */}
            <RequestList tournament={tournament} timeZone={timeZone} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
