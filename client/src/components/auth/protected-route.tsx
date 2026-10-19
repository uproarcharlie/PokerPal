import { ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { loading, isAuthenticated, isAdmin } = useAuth();

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Signed out, or the session just ended (the auth context forgets the user on a 401).
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  // Check admin requirement - redirect to public home page
  if (requireAdmin && !isAdmin) {
    return <Redirect to="/home" />;
  }

  return <>{children}</>;
}
