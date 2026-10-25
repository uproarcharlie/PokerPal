/**
 * Rendering for `web` tests: the app's providers (AppProviders: query client, theme, the real
 * AuthProvider, which asks GET /api/auth/me as `mockSignedIn` / `mockSignedOut` answer through MSW, and
 * the toaster) with a fresh query client that never retries, and an in-memory URL so pages read their
 * params and query string as they do in the app.
 */
import { useSyncExternalStore, type ReactElement } from "react";
import { act, render, type RenderResult } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { Route, Router } from "wouter";
import { AppProviders } from "@/app/providers";
import type { Impersonator } from "@/contexts/auth-context";
import { dismissToast } from "@/hooks/use-toast";
import { createQueryClient } from "@/lib/api/query-client";
import type { SignedOutMeResponse } from "@shared/api/auth";
import type { ErrorCode } from "@shared/api/errors";
import { server } from "../msw/server";

export interface RenderPageOptions {
  /** The URL the page is shown at, e.g. "/register/t1" or "/login?next=%2Fclubs". */
  path?: string;
  /** The route pattern the page is mounted under, e.g. "/register/:tournamentId". */
  route?: string;
}

/** The app's query defaults, except that a failed request fails at once instead of being retried. */
export function createTestQueryClient(): QueryClient {
  return createQueryClient({ queries: { retry: false } });
}

/** Toasts live in module state: close the last test's, so a new Toaster starts empty. */
function dismissToasts(): void {
  act(() => dismissToast());
}

/**
 * A location for `<Router hook={…} searchHook={…}>` starting at `initial` ("/leaderboards?season=s1"):
 * routes match the path alone and `useSearch()` reads the query, as in the browser.
 */
export function urlLocation(initial: string) {
  let url = new URL(initial, "http://localhost");
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const navigate = (to: string) => {
    url = new URL(to, url);
    listeners.forEach((listener) => listener());
  };
  return {
    useLocation: (): [string, (to: string) => void] => [useSyncExternalStore(subscribe, () => url.pathname), navigate],
    useSearch: () => useSyncExternalStore(subscribe, () => url.search.replace(/^\?/, "")),
    /** The current path and query. */
    href: () => `${url.pathname}${url.search}`,
  };
}

export function renderWithApp(ui: ReactElement, { path = "/", route }: RenderPageOptions = {}): RenderResult & {
  queryClient: QueryClient;
  /** The current path and query, e.g. "/login?next=%2Fclubs". */
  location: () => string;
} {
  dismissToasts();
  const queryClient = createTestQueryClient();
  const location = urlLocation(path);
  const result = render(
    <AppProviders queryClient={queryClient}>
      <Router hook={location.useLocation} searchHook={location.useSearch}>
        {route ? <Route path={route}>{ui}</Route> : ui}
      </Router>
    </AppProviders>,
  );
  return { ...result, queryClient, location: location.href };
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

/** GET /api/auth/me answers that nobody is signed in, as it does for a visitor. */
export function mockSignedOut(): void {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ user: null } satisfies SignedOutMeResponse)));
}

/** An error body as the API's central handler sends it. */
export function apiError(status: number, code: ErrorCode, error: string, details?: unknown): Response {
  return HttpResponse.json({ error, code, ...(details === undefined ? {} : { details }) }, { status });
}
