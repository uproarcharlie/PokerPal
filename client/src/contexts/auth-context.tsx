import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthMeResponse } from "@shared/api/auth";
import { useToast } from "@/hooks/use-toast";
import { pageNavigation } from "@/lib/page-navigation";
import { onSessionExpired } from "@/lib/queryClient";

interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  imageUrl: string | null;
}

/** The admin behind the session while they view the app as `user` (SEC-13). */
export type Impersonator = NonNullable<AuthMeResponse["impersonator"]>;

interface AuthContextType {
  user: User | null;
  /** Set while an admin is viewing the app as `user`. */
  impersonator: Impersonator | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Ends the impersonation and reloads as the admin; if their admin access has ended, signs out. */
  stopImpersonation: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isFullMember: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [impersonator, setImpersonator] = useState<Impersonator | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Every cached response was fetched as the previous viewer (`viewer.canManage`, staff lists), and
   * cached data is never refetched on its own (staleTime Infinity): start afresh whenever who is
   * signed in changes, so a shared venue laptop never shows one person's controls to the next (TN-07).
   */
  const forgetCachedData = () => queryClient.clear();

  const userRef = useRef(user);
  userRef.current = user;

  // Check if user is logged in on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // An API call answered 401: the session ended (signed out elsewhere, deactivated, password changed).
  // Forgetting the user sends staff pages to the login screen (ProtectedRoute); public pages stay.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (!userRef.current) return;
        userRef.current = null;
        forgetCachedData();
        setUser(null);
        setImpersonator(null);
        toast({
          title: "Signed out",
          description: "Your session has ended. Please sign in again.",
          variant: "destructive",
        });
      }),
    [toast, queryClient],
  );

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: 'include',
      });

      if (response.ok) {
        const data: AuthMeResponse = await response.json();
        setUser(data.user);
        setImpersonator(data.impersonator ?? null);
      } else {
        setUser(null);
        setImpersonator(null);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string) {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      forgetCachedData();
      setUser(data.user);
      setImpersonator(null);
      toast({
        title: "Login successful",
        description: `Welcome back, ${data.user.name}!`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      toast({
        title: "Login failed",
        description: message,
        variant: "destructive",
      });
      throw error;
    }
  }

  async function register(email: string, password: string, name: string, phone?: string) {
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, phone }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        // A weak password lists the rules it breaks; other errors carry one sentence.
        const problems = Array.isArray(data.details)
          ? data.details.filter((detail: unknown): detail is string => typeof detail === "string")
          : [];
        throw new Error(problems.length > 0 ? problems.join(", ") : data.error || "Registration failed");
      }

      forgetCachedData();
      setUser(data.user);
      setImpersonator(null);
      toast({
        title: "Registration successful",
        description: `Welcome, ${data.user.name}!`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Registration failed";
      toast({
        title: "Registration failed",
        description: message,
        variant: "destructive",
      });
      throw error;
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: 'include',
      });

      forgetCachedData();
      setUser(null);
      setImpersonator(null);
      toast({
        title: "Logged out",
        description: "You have been logged out successfully",
      });
    } catch (error) {
      console.error("Logout failed:", error);
      toast({
        title: "Logout failed",
        description: "An error occurred during logout",
        variant: "destructive",
      });
    }
  }

  async function stopImpersonation() {
    const failed = (description: string) =>
      toast({ title: "Could not stop impersonating", description, variant: "destructive" });

    let response: Response;
    try {
      response = await fetch("/api/admin/stop-impersonation", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      failed("Check your connection and try again.");
      return;
    }
    if (response.ok) {
      // Every cached screen belongs to the impersonated user: start afresh as the admin.
      pageNavigation.reload();
      return;
    }
    if (response.status === 401) {
      // The admin's own access has ended meanwhile; the server has signed the session out.
      setUser(null);
      setImpersonator(null);
      pageNavigation.assign("/login");
      return;
    }
    const data: { error?: string } = await response.json().catch(() => ({}));
    failed(data.error || "Please try again.");
  }

  const value: AuthContextType = {
    user,
    impersonator,
    loading,
    login,
    register,
    logout,
    stopImpersonation,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isFullMember: user?.role === 'full_member' || user?.role === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
