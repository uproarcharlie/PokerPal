import { useEarlyBirds } from "@/features/clock/staff-hooks";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { useConfirmPayment } from "../../staff-hooks";
import { autoSeatText } from "../desk/auto-seat-text";
import type { EarlyBirdToggle } from "./payment-lists";

/**
 * What the pending payments list does with a tap, wherever it is shown (the payment desk, the phone's
 * "Take payment" sheet): confirm a payment, saying where a player seated by it sits, and switch an
 * early-bird bonus. Each row waits for its own answer, and each answer is told for its own row
 * (P3REV0-PARITY-03).
 */
export function usePaymentConfirmations(tournamentId: string): { confirmingIds: ReadonlySet<string>; confirm: (registrationId: string) => void; earlyBirds: EarlyBirdToggle } {
  const { toast } = useToast();
  const confirmPayment = useConfirmPayment(tournamentId);
  const rows = useBusyRows();
  const earlyBirds = useEarlyBirds(tournamentId);
  const earlyBirdRows = useBusyRows();

  const confirm = async (registrationId: string) => {
    try {
      const paid = await rows.run(registrationId, () => confirmPayment.mutateAsync(registrationId));
      const seat = autoSeatText(paid.seating);
      const name = paid.player?.name ?? "The player";
      toast({ title: "Payment Confirmed", description: seat ? `${name} has paid. ${seat}` : "Registration payment has been confirmed." });
    } catch (error) {
      // Max players are accepted (round 5, item 15): no override, the server's sentence says how to make room.
      toast({
        title: hasErrorCode(error, "TOURNAMENT_FULL") ? "Tournament full" : "Could not confirm the payment",
        description: errorMessage(error, "Failed to confirm payment. Please try again."),
        variant: "destructive",
      });
    }
  };

  return {
    confirmingIds: rows.busy,
    confirm: (registrationId) => void confirm(registrationId),
    earlyBirds: {
      busy: earlyBirdRows.busy,
      onChange: (registrationId, earlyBird) =>
        void earlyBirdRows.run(registrationId, () => earlyBirds.mutateAsync({ registrationIds: [registrationId], earlyBird })).catch((error: unknown) =>
          toast({ title: "Could not change the early-bird bonus", description: errorMessage(error), variant: "destructive" }),
        ),
    },
  };
}
