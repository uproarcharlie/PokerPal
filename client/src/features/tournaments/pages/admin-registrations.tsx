import { useParams } from "wouter";
import { AccessDenied } from "@/components/auth/access-denied";
import { LiveStatus } from "@/components/shared/live-status";
import { PageHeader } from "@/components/shared/page-header";
import { PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { clubTimeZone } from "@/lib/format";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PaymentDeskCards } from "../components/payment-desk/payment-desk-cards";
import { TournamentNotFound } from "../components/tournament-not-found";
import { ClubThemeScope } from "@/features/branding/components/public/club-theme-scope";
import { useClub } from "@/features/clubs/hooks";
import { useTournament } from "../hooks";
import { DESK_REFRESH_MS } from "../staff-hooks";
import { qk } from "@/lib/api/query-keys";

/** The payment desk: who has signed up and owes what, confirming each payment, and who has paid. */
export default function AdminRegistrationsPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const tournament = useTournament(tournamentId);
  usePageMeta({ title: tournament.data ? `${tournament.data.name} registrations` : "Registrations" });

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
            <PaymentDesk tournament={data} />
          ) : (
            <AccessDenied
              message="Only this club's owner, its managers and admins can manage registrations and payments."
              backHref={routes.tournaments()}
              backLabel="Back to Tournaments"
            />
          )
        }
      </QueryState>
    </ClubThemeScope>
  );
}

function PaymentDesk({ tournament }: { tournament: TournamentDetailDto }) {
  const club = useClub(tournament.clubId);
  const timeZone = clubTimeZone(club.data);

  return (
    <>
      <PageHeader
        title={tournament.name}
        description="Registrations and payments"
        back={{ href: routes.tournamentAdmin(tournament.id), label: "Tournament" }}
      />

      <div className="space-y-4 px-4 py-6 sm:px-6 md:space-y-6 lg:px-8">
        <LiveStatus
          follows={[
            { queryKey: qk.tournaments.pendingRegistrations(tournament.id), interval: DESK_REFRESH_MS },
            { queryKey: qk.tournaments.confirmedRegistrations(tournament.id), interval: DESK_REFRESH_MS },
          ]}
          timeZone={timeZone}
        />
        {/* The same cards (and "Show QR Code") as the TD's phone Money tab: a payment says where the player was seated. */}
        <PaymentDeskCards tournament={tournament} timeZone={timeZone} />
      </div>
    </>
  );
}
