import { useState, type ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { routes } from "@/app/routes";
import { PageSpinner } from "@/components/shared/page-spinner";
import { ErrorState } from "@/components/shared/query-state";
import { useAuth } from "@/contexts/auth-context";
import { NETWORK_ERROR_MESSAGE } from "@/lib/api/http";

interface ProtectedRouteProps {
  children: ReactNode;
  /** Platform admins only; anyone else is sent to the public club directory. */
  requireAdmin?: boolean;
}

/**
 * Shows `children` to a signed-in user; sends everyone else to sign in (or, for admin pages, away). A
 * visitor who opened a staff link signed out comes back to it after signing in (PUB-23); someone who
 * signs out, or whose session ends, starts again from the sign-in page's own default.
 */
export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { loading, isAuthenticated, isAdmin, sessionCheckFailed, retrySessionCheck } = useAuth();
  const [location] = useLocation();
  const search = useSearch();
  const [hadSession, setHadSession] = useState(isAuthenticated);
  if (isAuthenticated && !hadSession) setHadSession(true);

  if (loading) return <PageSpinner label="Checking your sign-in" className="min-h-dvh" />;

  // The server could not say who this is: their session may well be fine, so not the sign-in page.
  if (sessionCheckFailed) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-8">
        <ErrorState
          className="w-full max-w-md"
          title="Could not check your sign-in"
          message={NETWORK_ERROR_MESSAGE}
          onRetry={retrySessionCheck}
        />
      </div>
    );
  }

  // Signed out, or the session just ended (the auth context forgets the user on a 401).
  if (!isAuthenticated) return <Redirect to={routes.login(hadSession ? undefined : search ? `${location}?${search}` : location)} />;

  if (requireAdmin && !isAdmin) return <Redirect to={routes.home()} />;

  return <>{children}</>;
}
