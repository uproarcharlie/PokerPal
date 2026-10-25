import { useRef, type RefObject } from "react";
import { Banknote } from "lucide-react";
import { PhoneSheet, PhoneSheetBody, PhoneSheetHeader } from "@/components/shared/phone-sheet";
import { usePendingPayments } from "../../staff-hooks";
import { PendingPayments } from "../payment-desk/payment-lists";
import { usePaymentConfirmations } from "../payment-desk/use-payment-confirmations";

interface PaymentsSheetProps {
  tournamentId: string;
  timeZone: string;
  /** Why nobody more can be accepted now (Max players accepted already: round 5, item 15), or null. */
  full: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The payments still to take, from the phone's quick actions (R5REV-HOST-09): each sign-up's total and
 * Confirm, one tap from wherever the TD is. Under "seat them once they've paid" confirming is what seats
 * a late arrival, and on the Money tab the list sat below the figures, the payouts and the AP.
 */
export function PaymentsSheet({ tournamentId, timeZone, full, open, onOpenChange, returnFocusTo }: PaymentsSheetProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <PhoneSheet side="bottom" open={open} onOpenChange={onOpenChange} returnFocusTo={returnFocusTo} initialFocus={heading}>
      <PhoneSheetHeader
        titleRef={heading}
        icon={<Banknote className="h-5 w-5 text-primary" aria-hidden="true" />}
        title="Take payment"
        description="Confirm each player's payment as you take it at the desk."
      />
      {/* Followed only while open. */}
      <PhoneSheetBody>{open ? <PendingList tournamentId={tournamentId} timeZone={timeZone} full={full} /> : null}</PhoneSheetBody>
    </PhoneSheet>
  );
}

function PendingList({ tournamentId, timeZone, full }: { tournamentId: string; timeZone: string; full: string | null }) {
  const pending = usePendingPayments(tournamentId);
  const { confirmingIds, confirm, earlyBirds } = usePaymentConfirmations(tournamentId);
  return <PendingPayments query={pending} timeZone={timeZone} confirmingIds={confirmingIds} onConfirm={confirm} earlyBirds={earlyBirds} full={full} />;
}
