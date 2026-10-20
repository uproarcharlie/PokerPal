import { useRef, useState, type RefObject } from "react";
import { useFirstInPage } from "@/components/ui/return-focus";
import { Crown, UserMinus, X } from "lucide-react";
import type { ClubStaffDto, StaffInviteDto, StaffInviteRole } from "@shared/api/clubs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRemoveManager, useRevokeInvite } from "../staff-hooks";

export const ROLE_NAMES: Record<StaffInviteRole, string> = { manager: "manager", owner: "owner" };

type Manager = ClubStaffDto["managers"][number];

/**
 * A person's name and email address in a staff row. The address wraps rather than being cut off on a
 * phone: an invitation works only for the account with that exact address, so the owner must be able
 * to check all of it (MA-15).
 */
function Person({ name, email }: { name?: string; email: string }) {
  return (
    <div className="min-w-0">
      {name ? <p className="break-words font-medium">{name}</p> : null}
      <p className={name ? "break-all text-sm text-muted-foreground" : "break-all font-medium"}>{email}</p>
    </div>
  );
}

export function OwnerSection({ owner }: { owner: ClubStaffDto["owner"] }) {
  return (
    <section aria-labelledby="staff-owner-heading" className="space-y-2">
      <h3 id="staff-owner-heading" className="text-sm font-medium text-foreground">
        Owner
      </h3>
      <div className="flex items-center gap-2 rounded-md border border-border p-3" data-testid="staff-owner">
        <Crown className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        {owner ? (
          <Person name={owner.name} email={owner.email} />
        ) : (
          <p className="text-sm text-muted-foreground">No owner yet. Only platform admins can run this club until one is set.</p>
        )}
      </div>
    </section>
  );
}

/** The managers, each removed only after the owner confirms (it ends their access at once: CQ-11). */
export function ManagerList({ clubId, managers }: { clubId: string; managers: readonly Manager[] }) {
  const { toast } = useToast();
  const removeManager = useRemoveManager(clubId);
  const [removing, setRemoving] = useState<Manager | null>(null);
  // A removed manager's row, and the Remove that opened the dialog, are gone once it closes.
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <section aria-labelledby="staff-managers-heading" className="space-y-2">
      <h3 ref={heading} tabIndex={-1} id="staff-managers-heading" className="text-sm font-medium text-foreground focus:outline-none">
        Managers
      </h3>
      {managers.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="no-managers">
          No managers yet.
        </p>
      ) : (
        <ul role="list" className="divide-y divide-border rounded-md border border-border">
          {managers.map((manager) => (
            <li key={manager.user.id} className="flex items-center justify-between gap-3 p-3" data-testid={`manager-row-${manager.user.id}`}>
              <Person name={manager.user.name} email={manager.user.email} />
              <Button
                type="button"
                variant="ghost"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => setRemoving(manager)}
                aria-label={`Remove ${manager.user.name}`}
              >
                <UserMinus className="mr-1 h-4 w-4" aria-hidden="true" />
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.user.name ?? "this manager"}?`}
        description="They can no longer run this club's tournaments, seasons or registrations. To bring them back, send them a new invitation."
        confirmLabel="Remove manager"
        pendingLabel="Removing…"
        destructive
        returnFocusTo={heading}
        onConfirm={async () => {
          if (!removing) return;
          await removeManager.mutateAsync(removing.user.id);
          toast({ title: "Manager removed" });
        }}
      />
    </section>
  );
}

interface InviteListProps {
  clubId: string;
  invites: readonly StaffInviteDto[];
  canInviteOwner: boolean;
  until: (iso: string) => string;
  /** Called once an invitation is withdrawn (the link shown for it, if any, goes). */
  onWithdrawn: (inviteId: string) => void;
  /** Where focus goes once the last invitation is withdrawn and this list has gone. */
  emptyFocusTo: RefObject<HTMLElement | null>;
}

/** Invitations not yet accepted, each withdrawn only after the owner confirms (its link stops working). */
export function InviteList({ clubId, invites, canInviteOwner, until, onWithdrawn, emptyFocusTo }: InviteListProps) {
  const { toast } = useToast();
  const revoke = useRevokeInvite(clubId);
  const [withdrawing, setWithdrawing] = useState<StaffInviteDto | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const afterWithdrawing = useFirstInPage(heading, emptyFocusTo);

  // The confirmation stays mounted when the list empties, so withdrawing the last invitation can
  // finish and put focus somewhere (P3REV-MA-FOCUS-AFTER-REMOVE).
  return (
    <>
      {invites.length > 0 ? (
        <InviteRows invites={invites} canInviteOwner={canInviteOwner} until={until} heading={heading} onWithdraw={setWithdrawing} />
      ) : null}
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => !open && setWithdrawing(null)}
        title="Withdraw this invitation?"
        description={`The link sent to ${withdrawing?.email ?? "them"} stops working. You can invite them again with a new link.`}
        confirmLabel="Withdraw invitation"
        pendingLabel="Withdrawing…"
        destructive
        returnFocusTo={afterWithdrawing}
        onConfirm={async () => {
          if (!withdrawing) return;
          await revoke.mutateAsync(withdrawing.id);
          onWithdrawn(withdrawing.id);
          toast({ title: "Invitation withdrawn" });
        }}
      />
    </>
  );
}

interface InviteRowsProps extends Pick<InviteListProps, "invites" | "canInviteOwner" | "until"> {
  heading: RefObject<HTMLHeadingElement>;
  onWithdraw: (invite: StaffInviteDto) => void;
}

function InviteRows({ invites, canInviteOwner, until, heading, onWithdraw }: InviteRowsProps) {
  return (
    <section aria-labelledby="staff-invites-heading" className="space-y-2">
      <h3 ref={heading} tabIndex={-1} id="staff-invites-heading" className="text-sm font-medium text-foreground focus:outline-none">
        Invitations waiting to be accepted
      </h3>
      <ul role="list" className="divide-y divide-border rounded-md border border-border">
        {invites.map((open) => (
          <li key={open.id} className="flex items-center justify-between gap-3 p-3" data-testid={`invite-row-${open.id}`}>
            <div className="min-w-0">
              <Person email={open.email} />
              <p className="text-sm text-muted-foreground">
                As {ROLE_NAMES[open.role]}, until {until(open.expiresAt)}
              </p>
            </div>
            {open.role !== "owner" || canInviteOwner ? (
              <Button
                type="button"
                variant="ghost"
                className="shrink-0"
                onClick={() => onWithdraw(open)}
                aria-label={`Withdraw the invitation for ${open.email}`}
              >
                <X className="mr-1 h-4 w-4" aria-hidden="true" />
                Withdraw
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
