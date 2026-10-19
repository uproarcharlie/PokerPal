/**
 * Rendering for `web` tests: a fresh query client with the app's defaults, the real AuthProvider
 * (it asks GET /api/auth/me, which `mockSignedIn` / `mockSignedOut` answer through MSW), the toaster,
 * and a memory router so pages read their params as they do in the app.
 */
import type { ReactElement } from "react";
import { act, render, renderHook, type RenderResult } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, type Impersonator } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { createQueryClient } from "@/lib/queryClient";
import type { ErrorCode } from "@shared/api/errors";
import { server } from "../msw/server";

export interface RenderPageOptions {
  /** The URL the page is shown at, e.g. "/register/t1". */
  path?: string;
  /** The route pattern the page is mounted under, e.g. "/register/:tournamentId". */
  route?: string;
}

/** Toasts live in module state: close the last test's, so a new Toaster starts empty. */
function dismissToasts(): void {
  const { result, unmount } = renderHook(() => useToast());
  act(() => result.current.dismiss());
  unmount();
}

export function renderWithApp(ui: ReactElement, { path = "/", route }: RenderPageOptions = {}): RenderResult & {
  queryClient: QueryClient;
  location: () => string;
} {
  dismissToasts();
  const queryClient = createQueryClient();
  const memory = memoryLocation({ path, record: true });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router hook={memory.hook}>{route ? <Route path={route}>{ui}</Route> : ui}</Router>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, location: () => memory.history.at(-1) ?? path };
}

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "full_member";
}

/** GET /api/auth/me answers this user (viewed by `impersonator`, an admin, when given). */
export function mockSignedIn(user: MockUser, { impersonator = null }: { impersonator?: Impersonator | null } = {}): void {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({
        user: { ...user, phone: null, imageUrl: null, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" },
        impersonator,
        managedClubIds: [],
      }),
    ),
  );
}

/** GET /api/auth/me answers 401, as it does for a visitor. */
export function mockSignedOut(): void {
  server.use(http.get("/api/auth/me", () => apiError(401, "UNAUTHENTICATED", "Not signed in")));
}

/** An error body as the API's central handler sends it. */
export function apiError(status: number, code: ErrorCode, error: string, details?: unknown): Response {
  return HttpResponse.json({ error, code, ...(details === undefined ? {} : { details }) }, { status });
}
