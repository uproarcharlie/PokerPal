import { useParams } from "wouter";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/auth/access-denied";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { LiveStatus } from "@/components/shared/live-status";
import { PageHeader } from "@/components/shared/page-header";
import { PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { absoluteUrl, routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { errorMessage } from "@/lib/api/http";
import { clubTimeZone } from "@/lib/format";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { ConfirmedPayments, PendingPayments } from "../components/payment-desk/payment-lists";
import { TournamentNotFound } from "../components/tournament-not-found";
import { useClub } from "@/features/clubs/hooks";
import { useTournament } from "../hooks";
import { DESK_REFRESH_MS, useConfirmPayment, usePaymentDesk } from "../staff-hooks";
import { qk } from "@/lib/api/query-keys";

/** The payment desk: who has signed up and owes what, confirming each payment, and who has paid. */
export default function AdminRegistrationsPage() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const tournament = useTournament(tournamentId);
  usePageMeta({ title: tournament.data ? `${tournament.data.name} registrations` : "Registrations" });

  return (
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
  );
}

function PaymentDesk({ tournament }: { tournament: TournamentDetailDto }) {
  const { toast } = useToast();
  const club = useClub(tournament.clubId);
  const timeZone = clubTimeZone(club.data);
  // Staff-only lists, followed while the page is open: QR sign-ups arrive on their own.
  const { pending, confirmed } = usePaymentDesk(tournament.id);
  const confirmPayment = useConfirmPayment(tournament.id);
  const registrationUrl = absoluteUrl(routes.publicRegister(tournament.id));

  // Each row waits for its own answer, and each answer is told for its own row (P3REV0-PARITY-03).
  const rows = useBusyRows();
  const confirm = async (registrationId: string) => {
    try {
      await rows.run(registrationId, () => confirmPayment.mutateAsync(registrationId));
      toast({ title: "Payment Confirmed", description: "Registration payment has been confirmed." });
    } catch (error) {
      toast({
        title: "Could not confirm the payment",
        description: errorMessage(error, "Failed to confirm payment. Please try again."),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <PageHeader
        title={tournament.name}
        description="Registrations and payments"
        back={{ href: routes.tournamentAdmin(tournament.id), label: "Tournament" }}
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={routes.tournamentQr(tournament.id)} target="_blank" rel="noopener noreferrer" data-testid="view-qr-code">
              <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
              Show QR Code
            </a>
          </Button>
        }
      />

      <div className="space-y-4 px-4 py-6 sm:px-6 md:space-y-6 lg:px-8">
        <LiveStatus
          follows={[
            { queryKey: qk.tournaments.pendingRegistrations(tournament.id), interval: DESK_REFRESH_MS },
            { queryKey: qk.tournaments.confirmedRegistrations(tournament.id), interval: DESK_REFRESH_MS },
          ]}
          timeZone={timeZone}
        />
        <Card>
          <CardHeader>
            <CardTitle>Pending Payment Confirmations</CardTitle>
            <CardDescription>Players who signed up and have not paid at the desk yet</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-3 md:p-4">
              <p className="mb-2 text-xs font-medium md:text-sm">Registration Link</p>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 overflow-x-auto rounded bg-background p-2 text-xs">{registrationUrl}</code>
                <CopyLinkButton value={registrationUrl} label="Copy" size="sm" data-testid="copy-registration-link" />
              </div>
            </div>
            <PendingPayments
              query={pending}
              timeZone={timeZone}
              confirmingIds={rows.busy}
              onConfirm={(registrationId) => void confirm(registrationId)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confirmed Players</CardTitle>
            <CardDescription>Players who have paid and are registered</CardDescription>
          </CardHeader>
          <CardContent>
            <ConfirmedPayments query={confirmed} timeZone={timeZone} />
          </CardContent>
        </Card>

      </div>
    </>
  );
}
