import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Loader2, MailPlus, Users } from "lucide-react";
import { z } from "zod";
import { STAFF_INVITE_PATH, createStaffInviteSchema, type ClubStaffDto, type StaffInviteDto } from "@shared/api/clubs";
import { absoluteUrl } from "@/app/routes";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/api/http";
import { formatDate } from "@/lib/format";
import { useInviteStaff } from "../staff-hooks";
import { InviteList, ManagerList, OwnerSection, ROLE_NAMES } from "./club-staff-lists";
import { formResolver } from "@/lib/forms";

interface ClubStaffCardProps {
  clubId: string;
  staff: ClubStaffDto;
  /** Platform admins may also invite a new owner. */
  canInviteOwner: boolean;
  /** The club's zone, for invitation expiry dates. */
  timeZone: string;
}

/** The link an invitation is opened with; its secret goes in the fragment, which never reaches a server. */
export const staffInviteLink = (token: string) => absoluteUrl(`${STAFF_INVITE_PATH}#${token}`);

type InviteValues = z.input<typeof createStaffInviteSchema>;

/**
 * The club's owner, managers and open invitations. Owners and admins invite a manager by email: the
 * server makes an invitation link, shown here once, for the owner to send to the person, and the role
 * is theirs only when they open it signed in to the account that uses that address (SEC-P2REV-03).
 */
export function ClubStaffCard({ clubId, staff, canInviteOwner, timeZone }: ClubStaffCardProps) {
  const [created, setCreated] = useState<{ invite: StaffInviteDto; link: string } | null>(null);
  const invite = useInviteStaff(clubId);
  const form = useForm<InviteValues>({ resolver: formResolver(createStaffInviteSchema), defaultValues: { email: "", role: "manager" } });
  const email = useWatch({ control: form.control, name: "email" });
  const until = (iso: string) => formatDate(iso, timeZone);
  const title = useRef<HTMLHeadingElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  // A new link is the thing to do next: focus goes to it (selected, ready to copy) rather than staying
  // on an Invite button that the emptied field has just disabled (P3REV-MA-FOCUS-AFTER-REMOVE).
  useEffect(() => {
    if (created) linkInput.current?.focus();
  }, [created]);

  const submitInvite = form.handleSubmit(async (values) => {
    const input = createStaffInviteSchema.parse({ ...values, role: canInviteOwner ? values.role : "manager" });
    try {
      const response = await invite.mutateAsync(input);
      setCreated({ invite: response.invite, link: staffInviteLink(response.token) });
      form.reset({ email: "", role: "manager" });
    } catch {
      // Shown under the form from the mutation's error.
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle ref={title} tabIndex={-1} className="flex items-center gap-2 text-xl focus:outline-none">
          <Users className="h-5 w-5" aria-hidden="true" />
          Managers
        </CardTitle>
        <CardDescription>
          Managers can run tournaments, seasons and registrations for this club. Only the owner or an admin can delete the club
          or change who manages it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <OwnerSection owner={staff.owner} />
        <ManagerList clubId={clubId} managers={staff.managers} />
        <InviteList
          clubId={clubId}
          invites={staff.invites}
          canInviteOwner={canInviteOwner}
          until={until}
          onWithdrawn={(inviteId) => setCreated((shown) => (shown?.invite.id === inviteId ? null : shown))}
          emptyFocusTo={title}
        />

        <Form {...form}>
          <form onSubmit={submitInvite} noValidate className="space-y-2">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel>{canInviteOwner ? "Invite a manager or a new owner" : "Invite a manager"}</FormLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <FormControl>
                      <Input type="email" autoComplete="off" placeholder="e.g. name@example.com" data-testid="invite-email" {...field} />
                    </FormControl>
                    {canInviteOwner ? (
                      <FormField
                        control={form.control}
                        name="role"
                        render={({ field: role }) => (
                          <Select value={role.value} onValueChange={role.onChange}>
                            <SelectTrigger className="sm:w-36" aria-label="Role" data-testid="invite-role">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="owner">Owner</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    ) : null}
                    <Button type="submit" busy={invite.isPending} disabled={!email.trim()} data-testid="invite-submit">
                      {invite.isPending ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <MailPlus className="mr-1 h-4 w-4" aria-hidden="true" />
                      )}
                      Invite
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-xs text-muted-foreground">
              You get a link to send them yourself. It works once, for the LovePoker.club account that uses this address.
            </p>
            {invite.error ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(invite.error)}
              </p>
            ) : null}
          </form>
        </Form>

        {created ? (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3" data-testid="invite-created">
            <p className="text-sm">
              Send this link to <span className="font-medium">{created.invite.email}</span>. They become the club's{" "}
              {ROLE_NAMES[created.invite.role]} when they open it signed in to the account that uses that address (it works until{" "}
              {until(created.invite.expiresAt)}). It is shown only now.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                ref={linkInput}
                readOnly
                value={created.link}
                aria-label="Invitation link"
                data-testid="invite-link"
                onFocus={(event) => event.target.select()}
              />
              <CopyLinkButton value={created.link} label="Copy" data-testid="invite-copy" className="shrink-0" />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
