import { useId, useRef, type RefObject } from "react";
import { Banknote } from "lucide-react";
import { PhoneSheet, PhoneSheetBody, PhoneSheetHeader } from "@/components/shared/phone-sheet";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { usePaymentDesk } from "../../staff-hooks";
import { useEntryFixes } from "../entry-fix/use-entry-fixes";
import { useFreeEntryChanges } from "../free-entry/use-free-entry-changes";
import { ConfirmedPayments, PendingPayments } from "../payment-desk/payment-lists";
import type { TransferDesk } from "../payment-desk/transfer-split";
import { usePaymentConfirmations } from "../payment-desk/use-payment-confirmations";

interface PaymentsSheetProps {
  tournament: TournamentDetailDto;
  timeZone: string;
  /** The game has no buy-in (round 7, item 8): the sheet accepts players rather than taking payments. */
  freeTournament: boolean;
  /** Why nobody more can be accepted now (Max players accepted already: round 5, item 15), or null. */
  full: string | null;
  /**
   * The game shows bank transfer details after sign-up (round 8; null: it does not): references, what
   * the door still collects, a name search, Cash or Transfer.
   */
  transfers: TransferDesk | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The payments still to take, from the phone's quick actions (R5REV-HOST-09): each sign-up's total and
 * Confirm, one tap from wherever the TD is. Under "seat them once they've paid" confirming is what seats
 * a late arrival, and on the Money tab the list sat below the figures, the payouts and the AP. Under
 * them, who has paid, each with the Fix menu (round 9), so a payment confirmed by mistake is put right
 * where it was made.
 */
export function PaymentsSheet({ tournament, timeZone, freeTournament, full, transfers, open, onOpenChange, returnFocusTo }: PaymentsSheetProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <PhoneSheet side="bottom" open={open} onOpenChange={onOpenChange} returnFocusTo={returnFocusTo} initialFocus={heading}>
      <PhoneSheetHeader
        titleRef={heading}
        icon={<Banknote className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={freeTournament ? "Accept players" : "Take payment"}
        description={freeTournament ? "Free tournament: accept each player who signed up." : "Confirm each player's payment as you take it at the desk."}
      />
      {/* Followed only while open. */}
      <PhoneSheetBody>
        {open ? <SheetLists tournament={tournament} timeZone={timeZone} freeTournament={freeTournament} full={full} transfers={transfers} /> : null}
      </PhoneSheetBody>
    </PhoneSheet>
  );
}

function SheetLists({ tournament, timeZone, freeTournament, full, transfers }: Pick<PaymentsSheetProps, "tournament" | "timeZone" | "freeTournament" | "full" | "transfers">) {
  const { pending, confirmed } = usePaymentDesk(tournament.id);
  const { confirmingIds, confirm, earlyBirds } = usePaymentConfirmations(tournament.id, { freeTournament });
  const freeEntries = useFreeEntryChanges(tournament.id);
  const paidHeading = useRef<HTMLHeadingElement>(null);
  const paidHeadingId = useId();
  const fixes = useEntryFixes({
    tournament,
    registrations: pending.data && confirmed.data ? [...pending.data, ...confirmed.data] : undefined,
    returnFocusTo: paidHeading,
  });
  // A free entry is given from its own quick action (round 7): the list to pay has no Free entry button.
  return (
    <>
      <PendingPayments
        query={pending}
        timeZone={timeZone}
        confirmingIds={confirmingIds}
        onConfirm={confirm}
        freeTournament={freeTournament}
        earlyBirds={earlyBirds}
        full={full}
        transfers={transfers}
      />
      <section aria-labelledby={paidHeadingId} className="mt-8 space-y-3" data-testid="payments-sheet-paid">
        <h3 id={paidHeadingId} ref={paidHeading} tabIndex={-1} className="text-base font-semibold text-foreground focus:outline-none">
          {freeTournament ? "Accepted" : "Paid"}
          {confirmed.data ? ` · ${confirmed.data.length}` : ""}
        </h3>
        <p className="text-sm text-muted-foreground">Confirmed by mistake, or paid another way? Tap Fix on their row.</p>
        <ConfirmedPayments
          query={confirmed}
          timeZone={timeZone}
          earlyBirds={earlyBirds}
          freeEntries={freeEntries}
          freeTournament={freeTournament}
          transfers={transfers}
          fixes={fixes}
        />
      </section>
      {fixes.dialogs}
    </>
  );
}
