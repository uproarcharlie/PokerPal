import { useRef, useState } from "react";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { absoluteUrl, routes } from "@/app/routes";
import type { PendingRegistrationDto } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { toCents } from "@shared/domain/money";
import { isFreeTournament } from "@shared/domain/prize-pool";
import { acceptRefusal } from "@shared/domain/waiting-list";
import { usePaymentDesk } from "../../staff-hooks";
import { FreeEntrySheet } from "../free-entry/free-entry-sheet";
import { useFreeEntryChanges } from "../free-entry/use-free-entry-changes";
import { ConfirmedPayments, PendingPayments } from "./payment-lists";
import { usePaymentConfirmations } from "./use-payment-confirmations";

interface PaymentDeskCardsProps {
  tournament: Pick<TournamentDetailDto, "id" | "maxPlayers" | "buyInAmount">;
  timeZone: string;
  /** The club's name for its take ("AP"), for what a funded free entry leaves out. */
  rakeLabel: string;
}

/** The desk's words: a game with no buy-in accepts players (round 7, item 8) rather than taking their money. */
const WORDS = {
  paid: {
    pendingTitle: "Pending Payment Confirmations",
    pendingDescription: "Players who signed up and have not paid at the desk yet",
    confirmedTitle: "Confirmed Players",
    confirmedDescription: "Players who have paid, or have a free entry, and are registered",
  },
  free: {
    pendingTitle: "Free tournament — accept players",
    pendingDescription: "Nobody pays to play: accept each player who signed up to put them in the field",
    confirmedTitle: "Accepted Players",
    confirmedDescription: "Players accepted into the tournament",
  },
} as const;

/**
 * The payment desk: who has signed up and owes what, confirming each payment or giving a free entry
 * (round 7), and who has paid or come in free; the sign-up link to share and the QR code to show. On the
 * TD's phone it is the Money tab's lower half (round5-contracts §8.1). Both lists are followed every
 * DESK_REFRESH_MS while shown, so QR sign-ups arrive on their own. A payment confirmed under "seat them
 * once they've paid" says where the player sits. A game with no buy-in accepts its players instead
 * (round 7, item 8): accepting confirms them at $0.
 */
export function PaymentDeskCards({ tournament, timeZone, rakeLabel }: PaymentDeskCardsProps) {
  const { pending, confirmed } = usePaymentDesk(tournament.id);
  const registrationUrl = absoluteUrl(routes.publicRegister(tournament.id));
  const freeTournament = isFreeTournament(tournament);
  const { confirmingIds, confirm, earlyBirds: earlyBirdToggle } = usePaymentConfirmations(tournament.id, { freeTournament });
  const freeEntryChanges = useFreeEntryChanges(tournament.id);
  // The sign-up a free entry is being given to (the sheet is open while there is one); focus goes back to its button.
  const [freeFor, setFreeFor] = useState<PendingRegistrationDto | null>(null);
  const freeButton = useRef<HTMLElement | null>(null);
  const buyInCents = toCents(tournament.buyInAmount);
  const words = freeTournament ? WORDS.free : WORDS.paid;
  // Max players accepted already (round 5, item 15): the waiting list says so before a refused tap. Both lists are needed to count.
  const full = pending.data && confirmed.data ? acceptRefusal([...pending.data, ...confirmed.data], tournament.maxPlayers) : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{words.pendingTitle}</CardTitle>
          <CardDescription>{words.pendingDescription}</CardDescription>
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
            onFreeEntry={(registration) => {
              freeButton.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setFreeFor(registration);
            }}
            freeTournament={freeTournament}
            earlyBirds={earlyBirdToggle}
            full={full}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{words.confirmedTitle}</CardTitle>
          <CardDescription>{words.confirmedDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmedPayments query={confirmed} timeZone={timeZone} earlyBirds={earlyBirdToggle} freeEntries={freeEntryChanges} freeTournament={freeTournament} />
        </CardContent>
      </Card>

      <FreeEntrySheet
        tournamentId={tournament.id}
        buyInCents={buyInCents}
        rakeLabel={rakeLabel}
        player={freeFor}
        open={freeFor !== null}
        onOpenChange={(open) => {
          if (!open) setFreeFor(null);
        }}
        returnFocusTo={freeButton}
      />
    </>
  );
}
