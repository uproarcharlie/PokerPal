import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/shared/toaster";
import { AuthProvider } from "@/contexts/auth-context";
import { queryClient as appQueryClient } from "@/lib/api/query-client";
import { ThemeController } from "./theme";

/**
 * Everything every screen needs above it: data (TanStack Query), the theme owner, who is signed in
 * (whose session-expiry listener turns an API 401 into the login page on staff screens) and toasts.
 * Tests pass their own query client.
 */
export function AppProviders({ children, queryClient = appQueryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </ThemeController>
    </QueryClientProvider>
  );
}
