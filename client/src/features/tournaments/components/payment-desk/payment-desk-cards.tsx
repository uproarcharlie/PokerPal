import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { absoluteUrl, routes } from "@/app/routes";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { acceptRefusal } from "@shared/domain/waiting-list";
import { usePaymentDesk } from "../../staff-hooks";
import { ConfirmedPayments, PendingPayments } from "./payment-lists";
import { usePaymentConfirmations } from "./use-payment-confirmations";

interface PaymentDeskCardsProps {
  tournament: Pick<TournamentDetailDto, "id" | "maxPlayers">;
  timeZone: string;
}

/**
 * The payment desk: who has signed up and owes what, confirming each payment, and who has paid; the
 * sign-up link to share and the QR code to show. On the TD's phone it is the Money tab's lower half
 * (round5-contracts §8.1). Both lists are followed every DESK_REFRESH_MS while shown, so QR sign-ups
 * arrive on their own. A payment confirmed under "seat them once they've paid" says where the player sits.
 */
export function PaymentDeskCards({ tournament, timeZone }: PaymentDeskCardsProps) {
  const { pending, confirmed } = usePaymentDesk(tournament.id);
  const registrationUrl = absoluteUrl(routes.publicRegister(tournament.id));
  const { confirmingIds, confirm, earlyBirds: earlyBirdToggle } = usePaymentConfirmations(tournament.id);
  // Max players accepted already (round 5, item 15): the waiting list says so before a refused tap. Both lists are needed to count.
  const full = pending.data && confirmed.data ? acceptRefusal([...pending.data, ...confirmed.data], tournament.maxPlayers) : null;

  return (
    <>
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
              <CopyLinkButton value={registrationUrl} label="Copy" size="sm" className="h-11 sm:h-9" data-testid="copy-registration-link" />
              <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                <a href={routes.tournamentQr(tournament.id)} target="_blank" rel="noopener noreferrer" data-testid="view-qr-code">
                  <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
                  Show QR Code
                </a>
              </Button>
            </div>
          </div>
          <PendingPayments
            query={pending}
            timeZone={timeZone}
            confirmingIds={confirmingIds}
            onConfirm={confirm}
            earlyBirds={earlyBirdToggle}
            full={full}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Confirmed Players</CardTitle>
          <CardDescription>Players who have paid and are registered</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmedPayments query={confirmed} timeZone={timeZone} earlyBirds={earlyBirdToggle} />
        </CardContent>
      </Card>
    </>
  );
}
