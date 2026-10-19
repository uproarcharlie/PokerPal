import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Crown, Loader2, MailPlus, UserMinus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/queryClient";
import {
  STAFF_INVITE_PATH,
  type ClubStaffDto,
  type CreateStaffInviteResponse,
  type StaffInviteDto,
  type StaffInviteRole,
} from "@shared/api/clubs";

/** GET /api/clubs/:id/managers: answered for the club's owner and platform admins (403 for anyone else). */
export const clubStaffQueryKey = (clubId: string) => ["/api/clubs", clubId, "managers"] as const;

interface ClubStaffCardProps {
  clubId: string;
  staff: ClubStaffDto;
  /** Platform admins may also invite a new owner. */
  canInviteOwner: boolean;
}

/** The link an invitation is opened with; its secret goes in the fragment, which never reaches a server. */
export const staffInviteLink = (token: string) => `${window.location.origin}${STAFF_INVITE_PATH}#${token}`;

const ROLE_NAMES: Record<StaffInviteRole, string> = { manager: "manager", owner: "owner" };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * The club's owner, managers and open invitations. Owners and admins invite a manager by email: the
 * server makes an invitation link, shown here once, for the owner to send to the person, and the role
 * is theirs only when they open it signed in to the account that uses that address (SEC-P2REV-03).
 */
export function ClubStaffCard({ clubId, staff, canInviteOwner }: ClubStaffCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffInviteRole>("manager");
  const [created, setCreated] = useState<{ invite: StaffInviteDto; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const saveStaff = (next: ClubStaffDto) => queryClient.setQueryData(clubStaffQueryKey(clubId), next);

  const invite = useMutation({
    mutationFn: (input: { email: string; role: StaffInviteRole }) =>
      apiJson<CreateStaffInviteResponse>("POST", `/api/clubs/${clubId}/invites`, input),
    onSuccess: (response) => {
      saveStaff(response.staff);
      setCreated({ invite: response.invite, link: staffInviteLink(response.token) });
      setCopied(false);
      setEmail("");
      setRole("manager");
    },
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => apiJson<ClubStaffDto>("DELETE", `/api/clubs/${clubId}/invites/${inviteId}`),
    onSuccess: (next, inviteId) => {
      saveStaff(next);
      if (created?.invite.id === inviteId) setCreated(null);
      toast({ title: "Invitation withdrawn" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not withdraw the invitation", description: error.message, variant: "destructive" });
    },
  });

  const removeManager = useMutation({
    mutationFn: (userId: string) => apiJson<ClubStaffDto>("DELETE", `/api/clubs/${clubId}/managers/${userId}`),
    onSuccess: (next) => {
      saveStaff(next);
      toast({ title: "Manager removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove manager", description: error.message, variant: "destructive" });
    },
  });

  const submitInvite = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim()) invite.mutate({ email: email.trim(), role: canInviteOwner ? role : "manager" });
  };

  const copyLink = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      toast({ title: "Copy the link by hand", description: "This browser did not let the page copy it.", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Managers
        </CardTitle>
        <CardDescription>
          Managers can run tournaments, seasons and registrations for this club. Only the owner or an admin can
          delete the club or change who manages it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Owner</Label>
          <div className="flex items-center gap-2 rounded-md border border-border p-3" data-testid="staff-owner">
            <Crown className="w-4 h-4 text-amber-500 shrink-0" />
            {staff.owner ? (
              <div className="min-w-0">
                <p className="font-medium truncate">{staff.owner.name}</p>
                <p className="text-sm text-muted-foreground truncate">{staff.owner.email}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No owner yet. Only platform admins can run this club until one is set.</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Managers</Label>
          {staff.managers.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="no-managers">
              No managers yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {staff.managers.map((manager) => (
                <li key={manager.user.id} className="flex items-center justify-between gap-3 p-3" data-testid={`manager-row-${manager.user.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{manager.user.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{manager.user.email}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeManager.mutate(manager.user.id)}
                    disabled={removeManager.isPending}
                    aria-label={`Remove ${manager.user.name}`}
                  >
                    <UserMinus className="w-4 h-4 mr-1" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {staff.invites.length > 0 && (
          <div className="space-y-2">
            <Label>Invitations waiting to be accepted</Label>
            <ul className="divide-y divide-border rounded-md border border-border">
              {staff.invites.map((open) => (
                <li key={open.id} className="flex items-center justify-between gap-3 p-3" data-testid={`invite-row-${open.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{open.email}</p>
                    <p className="text-sm text-muted-foreground">
                      As {ROLE_NAMES[open.role]}, until {shortDate(open.expiresAt)}
                    </p>
                  </div>
                  {(open.role !== "owner" || canInviteOwner) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke.mutate(open.id)}
                      disabled={revoke.isPending}
                      aria-label={`Withdraw the invitation for ${open.email}`}
                    >
                      <X className="w-4 h-4 mr-1" />
                      Withdraw
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={submitInvite} className="space-y-2">
          <Label htmlFor="invite-email">{canInviteOwner ? "Invite a manager or a new owner" : "Invite a manager"}</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="invite-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="invite-email"
            />
            {canInviteOwner && (
              <Select value={role} onValueChange={(value) => setRole(value as StaffInviteRole)}>
                <SelectTrigger className="sm:w-36" aria-label="Role" data-testid="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button type="submit" disabled={invite.isPending || !email.trim()} data-testid="invite-submit">
              {invite.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailPlus className="w-4 h-4 mr-1" />}
              Invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            You get a link to send them yourself. It works once, for the LovePoker.club account that uses this address.
          </p>
          {invite.error && (
            <p role="alert" className="text-sm text-destructive">
              {invite.error.message}
            </p>
          )}
        </form>

        {created && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3" data-testid="invite-created">
            <p className="text-sm">
              Send this link to <span className="font-medium">{created.invite.email}</span>. They become the club's{" "}
              {ROLE_NAMES[created.invite.role]} when they open it signed in to the account that uses that address (it
              works until {shortDate(created.invite.expiresAt)}). It is shown only now.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={created.link} aria-label="Invitation link" data-testid="invite-link" onFocus={(event) => event.target.select()} />
              <Button type="button" variant="outline" onClick={copyLink} data-testid="invite-copy">
                {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
