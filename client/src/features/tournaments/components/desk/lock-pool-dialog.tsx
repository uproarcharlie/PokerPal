import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { useUpdateTournament } from "../../staff-hooks";

interface LockPoolDialogProps {
  tournamentId: string;
  /** Whether the pool is locked now: the dialog offers the opposite. */
  locked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Locking the prize pool asks first (TN2-01): no new sign-ups, re-buys or add-ons after it. */
export function LockPoolDialog({ tournamentId, locked, open, onOpenChange }: LockPoolDialogProps) {
  const { toast } = useToast();
  const update = useUpdateTournament(tournamentId);
  // What the TD was asked when the dialog opened, kept while the change lands: the tournament refetches
  // (and `locked` flips) before the dialog closes.
  const [asked, setAsked] = useState({ open, unlocking: locked });
  if (asked.open !== open) setAsked({ open, unlocking: open ? locked : asked.unlocking });
  const { unlocking } = asked;

  const confirm = async () => {
    await update.mutateAsync({ prizePoolLocked: !unlocking });
    toast(
      unlocking
        ? { title: "Prize Pool Unlocked", description: "Registrations, rebuys and addons are open again" }
        : { title: "Prize Pool Locked", description: "No further registrations, rebuys, or addons will be allowed" },
    );
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={unlocking ? "Unlock the prize pool?" : "Lock the prize pool?"}
      description={
        unlocking
          ? "Players can sign up, and re-buys and add-ons can be added, again until you lock it."
          : "No new sign-ups, re-buys or add-ons after this. Re-buy and add-on requests players sent before the lock can still be confirmed."
      }
      confirmLabel={unlocking ? "Unlock" : "Lock"}
      pendingLabel={unlocking ? "Unlocking…" : "Locking…"}
      contentTestId="confirm-lock"
      confirmTestId="confirm-lock-action"
      onConfirm={confirm}
    />
  );
}
