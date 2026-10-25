import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthMeResponse, SessionUser } from "@shared/api/auth";
import { routes } from "@/app/routes";
import { fetchSession, signIn, signOut, signUp, stopImpersonating } from "@/features/account/api";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, isApiError, onSessionExpired } from "@/lib/api/http";
import { retryDelay, shouldRetry } from "@/lib/api/query-client";
import { pageNavigation } from "@/lib/page-navigation";

/** The admin behind the session while they view the app as `user` (SEC-13). */
export type Impersonator = NonNullable<AuthMeResponse["impersonator"]>;

interface Session {
  user: SessionUser | null;
  /** Set while an admin is viewing the app as `user`. */
  impersonator: Impersonator | null;
}

const SIGNED_OUT: Session = { user: null, impersonator: null };

interface AuthContextType {
  user: SessionUser | null;
  /** Set while an admin is viewing the app as `user`. */
  impersonator: Impersonator | null;
  /** True until the first answer about who is signed in. */
  loading: boolean;
  /**
   * The server could not say who is signed in (no connection, a server error), even after asking
   * again: not the same as "nobody", so staff pages offer to try again instead of the sign-in page.
   */
  sessionCheckFailed: boolean;
  /** Asks the server who is signed in again, after a failed check. */
  retrySessionCheck: () => void;
  /** Signs in; rejects with the ApiError (wrong password, throttled, ...) for the page to show. */
  login: (email: string, password: string) => Promise<void>;
  /** Creates the account and signs in; rejects with the ApiError (email taken, weak password, ...). */
  register: (email: string, password: string, name: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Ends the impersonation and reloads as the admin; if their admin access has ended, signs out. */
  stopImpersonation: () => Promise<void>;
  /** Shows the signed-in user as the server now returns them (after a profile edit), without a reload. */
  updateSessionUser: (user: SessionUser) => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isFullMember: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/**
 * Who is signed in, or null for nobody: the server answers `{ user: null }`, or a 401 as it did before
 * (backlog item 2). Any other failure is not "nobody" (P3REV4-PERF-04): it is asked again by the rule
 * every read follows (shouldRetry, retryDelay), then thrown.
 */
async function readSession(signal: AbortSignal): Promise<AuthMeResponse | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const me = await fetchSession(signal);
      return me.user === null ? null : me;
    } catch (error) {
      if (isApiError(error) && error.status === 401) return null;
      if (signal.aborted || !shouldRetry(attempt, error)) throw error;
      await wait(retryDelay(attempt), signal);
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(SIGNED_OUT);
  const [loading, setLoading] = useState(true);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  // Bumped to ask again after a failed check.
  const [sessionCheck, setSessionCheck] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Read by the session-expiry listener, which outlives renders; kept in step after each render.
  const signedIn = useRef(false);
  useEffect(() => {
    signedIn.current = session.user !== null;
  }, [session.user]);

  /**
   * Every cached response was fetched as the previous viewer (`viewer.canManage`, staff lists) and
   * stays fresh for 30 seconds, and longer while nothing refocuses the window: start afresh whenever
   * who is signed in changes, so a shared venue laptop never shows one person's controls or data to
   * the next (TN-07, CA-39).
   */
  const forgetCachedData = useCallback(() => queryClient.clear(), [queryClient]);

  // Who is signed in, at start (and again on request after a failed check). "Nobody" here is no
  // session ending: no one was signed in to lose.
  useEffect(() => {
    const controller = new AbortController();
    readSession(controller.signal)
      .then((me) => setSession(me ? { user: me.user, impersonator: me.impersonator ?? null } : SIGNED_OUT))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Auth check failed:", error);
        setSessionCheckFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sessionCheck]);

  const retrySessionCheck = useCallback(() => {
    setSessionCheckFailed(false);
    setLoading(true);
    setSessionCheck((count) => count + 1);
  }, []);

  // An API call answered 401: the session ended (signed out elsewhere, deactivated, password changed).
  // Forgetting the user sends staff pages to the login screen (ProtectedRoute); public pages stay.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (!signedIn.current) return;
        signedIn.current = false;
        forgetCachedData();
        setSession(SIGNED_OUT);
        toast({
          title: "Signed out",
          description: "Your session has ended. Please sign in again.",
          variant: "destructive",
        });
      }),
    [toast, forgetCachedData],
  );

  const signedInAs = useCallback(
    (user: SessionUser) => {
      forgetCachedData();
      setSession({ user, impersonator: null });
    },
    [forgetCachedData],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { user } = await signIn({ email, password });
      signedInAs(user);
      toast({ title: "Login successful", description: `Welcome back, ${user.name}!` });
    },
    [signedInAs, toast],
  );

  const register = useCallback(
    async (email: string, password: string, name: string, phone?: string) => {
      const { user } = await signUp({ email, password, name, phone });
      signedInAs(user);
      toast({ title: "Registration successful", description: `Welcome, ${user.name}!` });
    },
    [signedInAs, toast],
  );

  const logout = useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      toast({ title: "Logout failed", description: errorMessage(error), variant: "destructive" });
      return;
    }
    signedIn.current = false;
    forgetCachedData();
    setSession(SIGNED_OUT);
    toast({ title: "Logged out", description: "You have been logged out successfully" });
  }, [forgetCachedData, toast]);

  const stopImpersonation = useCallback(async () => {
    try {
      await stopImpersonating();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        // The admin's own access has ended meanwhile; the server has signed the session out.
        signedIn.current = false;
        setSession(SIGNED_OUT);
        pageNavigation.assign(routes.login());
        return;
      }
      toast({ title: "Could not stop impersonating", description: errorMessage(error), variant: "destructive" });
      return;
    }
    // Every cached screen belongs to the impersonated user: start afresh as the admin.
    pageNavigation.reload();
  }, [toast]);

  const updateSessionUser = useCallback((user: SessionUser) => {
    setSession((current) => (current.user?.id === user.id ? { ...current, user } : current));
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user: session.user,
      impersonator: session.impersonator,
      loading,
      sessionCheckFailed,
      retrySessionCheck,
      login,
      register,
      logout,
      stopImpersonation,
      updateSessionUser,
      isAuthenticated: session.user !== null,
      isAdmin: session.user?.role === "admin",
      isFullMember: session.user?.role === "full_member" || session.user?.role === "admin",
    }),
    [session, loading, sessionCheckFailed, retrySessionCheck, login, register, logout, stopImpersonation, updateSessionUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
