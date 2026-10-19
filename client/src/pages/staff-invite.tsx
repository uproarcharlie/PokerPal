import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { apiJson, isApiRequestError } from "@/lib/queryClient";
import { STAFF_INVITE_PATH, type AcceptStaffInviteResponse } from "@shared/api/clubs";

/** Holds the invitation's secret while the person signs in or signs up, so it survives leaving the page. */
const STORAGE_KEY = "pokerpal.staffInvite";

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (a private window): the link still works if opened again once signed in.
  }
}

/**
 * The secret from the link's fragment (`/staff-invite#<token>`), which never reaches a server log, or
 * the one kept while the person signed in. The fragment is cleared from the address bar once read.
 */
function takeToken(): string | null {
  const fromLink = window.location.hash.replace(/^#/, "");
  if (fromLink) {
    store(fromLink);
    window.history.replaceState(null, "", STAFF_INVITE_PATH);
    return fromLink;
  }
  return readStored();
}

const acceptedRole = (role: AcceptStaffInviteResponse["role"]) => (role === "owner" ? "the owner of" : "a manager of");

/**
 * Accepting an invitation to a club's staff (SEC-P2REV-03). The role is granted only to the account
 * that uses the invited address, so the person signs in (or signs up) with it first, comes back here,
 * and accepts.
 */
export default function StaffInvitePage() {
  const { loading, isAuthenticated, user } = useAuth();
  const [token] = useState(takeToken);
  const [accepted, setAccepted] = useState<AcceptStaffInviteResponse | null>(null);

  const accept = useMutation({
    mutationFn: (secret: string) => apiJson<AcceptStaffInviteResponse>("POST", "/api/staff-invites/accept", { token: secret }),
    onSuccess: (result) => {
      store(null);
      setAccepted(result);
    },
    onError: (error) => {
      // A link that can never work again is forgotten; one for another account is kept to retry after switching.
      if (isApiRequestError(error) && (error.code === "INVITE_INVALID" || error.code === "INVITE_EXPIRED")) store(null);
    },
  });

  useEffect(() => {
    document.title = "Club invitation - LovePoker.club";
  }, []);

  const next = encodeURIComponent(STAFF_INVITE_PATH);

  let body;
  if (!token) {
    body = (
      <CardDescription data-testid="invite-missing">
        This page needs the invitation link you were sent. Open the link again, or ask the club for a new one.
      </CardDescription>
    );
  } else if (loading) {
    body = <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />;
  } else if (accepted) {
    body = (
      <div className="space-y-4 text-center" data-testid="invite-accepted">
        <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
        <p>
          You are now {acceptedRole(accepted.role)} <span className="font-semibold">{accepted.clubName}</span>.
        </p>
        <Link href={`/clubs/${accepted.clubId}`}>
          <Button>Go to the club</Button>
        </Link>
      </div>
    );
  } else if (!isAuthenticated) {
    body = (
      <div className="space-y-4" data-testid="invite-sign-in">
        <CardDescription>
          You have been invited to help run a club on LovePoker.club. Sign in, or create an account, with the email
          address this invitation was sent to, then accept it here.
        </CardDescription>
        <div className="flex flex-col sm:flex-row gap-2">
          <Link href={`/login?next=${next}`}>
            <Button className="w-full">Sign in</Button>
          </Link>
          <Link href={`/register?next=${next}`}>
            <Button variant="outline" className="w-full">
              Create an account
            </Button>
          </Link>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <CardDescription>
          You have been invited to help run a club on LovePoker.club. You are signed in as{" "}
          <span className="font-medium text-foreground">{user?.email}</span>: the invitation works only for the account
          that uses the address it was sent to.
        </CardDescription>
        {accept.error && (
          <p role="alert" className="text-sm text-destructive" data-testid="invite-error">
            {accept.error.message}
          </p>
        )}
      </div>
    );
  }

  const canAccept = token !== null && !loading && isAuthenticated && accepted === null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailOpen className="w-5 h-5" />
            Club invitation
          </CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
        {canAccept && (
          <CardFooter>
            <Button className="w-full" disabled={accept.isPending} onClick={() => accept.mutate(token)} data-testid="invite-accept">
              {accept.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Accept the invitation
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
