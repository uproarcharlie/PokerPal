import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Loader2, MailOpen } from "lucide-react";
import type { AcceptStaffInviteResponse } from "@shared/api/clubs";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { PageSpinner } from "@/components/shared/page-spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { useAcceptStaffInvite } from "../hooks";
import { storeInviteToken, takeInviteToken } from "../invite-token";

const acceptedRole = (role: AcceptStaffInviteResponse["role"]) => (role === "owner" ? "the owner of" : "a manager of");

function Accepted({ result }: { result: AcceptStaffInviteResponse }) {
  return (
    <div className="space-y-4 text-center" data-testid="invite-accepted">
      <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
      <p className="text-foreground">
        You are now {acceptedRole(result.role)} <span className="font-semibold">{result.clubName}</span>.
      </p>
      <Button asChild>
        <Link href={routes.clubDetails(result.clubId)}>Go to the club</Link>
      </Button>
    </div>
  );
}

function SignInFirst() {
  return (
    <div className="space-y-4" data-testid="invite-sign-in">
      <CardDescription>
        You have been invited to help run a club on LovePoker.club. Sign in, or create an account, with the email address this
        invitation was sent to, then accept it here.
      </CardDescription>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="w-full sm:flex-1" asChild>
          <Link href={routes.login(routes.staffInvite())}>Sign in</Link>
        </Button>
        <Button variant="outline" className="w-full sm:flex-1" asChild>
          <Link href={routes.register(routes.staffInvite())}>Create an account</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Accepting an invitation to a club's staff (SEC-P2REV-03). The role is granted only to the account
 * that uses the invited address, so the person signs in (or signs up) with it first, comes back here,
 * and accepts.
 */
export default function StaffInvitePage() {
  usePageMeta({ title: "Club invitation", noindex: true });
  const { loading, isAuthenticated, user } = useAuth();
  const [token] = useState(takeInviteToken);
  const accept = useAcceptStaffInvite();

  const onAccept = (secret: string) =>
    accept.mutate(
      { token: secret },
      {
        onSuccess: () => storeInviteToken(null),
        onError: (error) => {
          // A link that can never work again is forgotten; one for another account is kept to retry after switching.
          if (hasErrorCode(error, "INVITE_INVALID", "INVITE_EXPIRED")) storeInviteToken(null);
        },
      },
    );

  let body;
  if (!token) {
    body = (
      <CardDescription data-testid="invite-missing">
        This page needs the invitation link you were sent. Open the link again, or ask the club for a new one.
      </CardDescription>
    );
  } else if (loading) {
    body = <PageSpinner label="Checking your sign-in" className="min-h-0 py-4" />;
  } else if (accept.data) {
    body = <Accepted result={accept.data} />;
  } else if (!isAuthenticated) {
    body = <SignInFirst />;
  } else {
    body = (
      <div className="space-y-4">
        <CardDescription>
          You have been invited to help run a club on LovePoker.club. You are signed in as{" "}
          <span className="font-medium text-foreground">{user?.email}</span>: the invitation works only for the account that uses the
          address it was sent to.
        </CardDescription>
        {accept.isError ? (
          <p role="alert" className="text-sm text-destructive" data-testid="invite-error">
            {errorMessage(accept.error)}
          </p>
        ) : null}
      </div>
    );
  }

  const canAccept = token !== null && !loading && isAuthenticated && !accept.data;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-foreground via-foreground/90 to-foreground px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight text-foreground">
            <MailOpen className="h-5 w-5" aria-hidden="true" />
            Club invitation
          </h1>
        </CardHeader>
        <CardContent>{body}</CardContent>
        {canAccept ? (
          <CardFooter>
            <Button className="w-full" busy={accept.isPending} onClick={() => onAccept(token)} data-testid="invite-accept">
              {accept.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Accept the invitation
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
