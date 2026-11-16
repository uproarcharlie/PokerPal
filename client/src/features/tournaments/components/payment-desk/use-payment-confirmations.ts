import type { PaymentMethod } from "@shared/api/registrations";
import { useEarlyBirds } from "@/features/clock/staff-hooks";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { useConfirmPayment } from "../../staff-hooks";
import { autoSeatText } from "../desk/auto-seat-text";
import { highHandLeftText } from "../desk/high-hand-left";
import type { EarlyBirdToggle } from "./payment-lists";

/** What the payment toast says was paid: "has paid", or how, when the desk recorded it (round 8). */
const PAID_WORDS: Readonly<Record<PaymentMethod, string>> = { cash: "has paid in cash", transfer: "has paid by bank transfer" };

/**
 * What the pending payments list does with a tap, wherever it is shown (the payment desk, the phone's
 * "Take payment" sheet): confirm a payment, saying where a player seated by it sits, and switch an
 * early-bird bonus. Each row waits for its own answer, and each answer is told for its own row
 * (P3REV0-PARITY-03). In a game with no buy-in (`freeTournament`, round 7, item 8) nobody pays:
 * the same tap accepts the player, and the toast says so. Where the desk asks how the player paid
 * (round 8: cash or bank transfer), the payment is recorded so.
 */
export function usePaymentConfirmations(
  tournamentId: string,
  { freeTournament = false }: { freeTournament?: boolean } = {},
): { confirmingIds: ReadonlySet<string>; confirm: (registrationId: string, paidBy?: PaymentMethod) => void; earlyBirds: EarlyBirdToggle } {
  const { toast } = useToast();
  const confirmPayment = useConfirmPayment(tournamentId);
  const rows = useBusyRows();
  const earlyBirds = useEarlyBirds(tournamentId);
  const earlyBirdRows = useBusyRows();

  const confirm = async (registrationId: string, paidBy?: PaymentMethod) => {
    try {
      const paid = await rows.run(registrationId, () => confirmPayment.mutateAsync({ registrationId, paidBy }));
      const seat = autoSeatText(paid.seating);
      const name = paid.player?.name ?? "The player";
      const confirmed = freeTournament
        ? [`${name} is in.`, seat].filter(Boolean).join(" ")
        : paidBy
          ? [`${name} ${PAID_WORDS[paidBy]}.`, seat].filter(Boolean).join(" ")
          : seat
            ? `${name} has paid. ${seat}`
            : "Registration payment has been confirmed.";
      const left = highHandLeftText(paid.highHandUnawardedCents);
      toast({ title: freeTournament ? "Player accepted" : "Payment Confirmed", description: left ? `${confirmed} ${left}` : confirmed });
    } catch (error) {
      // Max players are accepted (round 5, item 15): no override, the server's sentence says how to make room.
      toast({
        title: hasErrorCode(error, "TOURNAMENT_FULL") ? "Tournament full" : freeTournament ? "Could not accept the player" : "Could not confirm the payment",
        description: errorMessage(error, freeTournament ? "Failed to accept the player. Please try again." : "Failed to confirm payment. Please try again."),
        variant: "destructive",
      });
    }
  };

  return {
    confirmingIds: rows.busy,
    confirm: (registrationId, paidBy) => void confirm(registrationId, paidBy),
    earlyBirds: {
      busy: earlyBirdRows.busy,
      onChange: (registrationId, earlyBird) =>
        void earlyBirdRows.run(registrationId, () => earlyBirds.mutateAsync({ registrationIds: [registrationId], earlyBird })).catch((error: unknown) =>
          toast({ title: "Could not change the early-bird bonus", description: errorMessage(error), variant: "destructive" }),
        ),
    },
  };
}
