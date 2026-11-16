import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import type { ConfirmedRegistrationDto } from "@shared/api/registrations";
import { useChangeFreeEntry } from "../../staff-hooks";
import { playerName } from "../../player-name";
import type { FreeEntryActions, FreeEntryUndo } from "../payment-desk/payment-lists";

const DONE: Readonly<Record<FreeEntryUndo, { title: string; description: (name: string) => string }>> = {
  mark_paid: { title: "Marked paid", description: (name) => `${name} has paid: their buy-in is now in the prize pool.` },
  take_back: { title: "Free entry taken back", description: (name) => `${name} is a normal entry again and has not paid yet.` },
};

/**
 * The confirmed list's Mark paid and Undo for a free entry (round 7, item 6): each row waits for its
 * own answer, and each answer is told for its own row.
 */
export function useFreeEntryChanges(tournamentId: string): FreeEntryActions {
  const { toast } = useToast();
  const change = useChangeFreeEntry(tournamentId);
  const rows = useBusyRows();

  const run = async (registration: ConfirmedRegistrationDto, action: FreeEntryUndo) => {
    const name = playerName(registration);
    try {
      await rows.run(registration.id, () => change.mutateAsync({ registrationId: registration.id, input: { action } }));
      toast({ title: DONE[action].title, description: DONE[action].description(name) });
    } catch (error) {
      toast({
        title: action === "mark_paid" ? "Could not mark the payment" : "Could not take the free entry back",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  };

  return { busy: rows.busy, onChange: (registration, action) => void run(registration, action) };
}
