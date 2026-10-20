import { Suspense, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ImpersonationBanner } from "@/components/auth/impersonation-banner";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Sidebar } from "@/components/layout/sidebar";
import { PageSpinner } from "@/components/shared/page-spinner";
import { RouteErrorBoundary } from "../error-boundary";
import { routes } from "../routes";
import { ThemeScope, type ThemeLayer } from "../theme";
import { SkipToContent } from "./skip-to-content";
import { useNavigationFocus } from "./use-navigation-focus";

const STAFF_THEME: ThemeLayer = { colorScheme: "preference", surface: "admin" };

/**
 * Every staff screen: signed in (else the login page), the sidebar, the page in its own error
 * boundary and loading state, and the light/dark preference. One instance stays mounted while staff
 * move between staff pages, so the sidebar never redraws. `requireAdmin` keeps everyone but platform
 * admins off the page.
 */
export function AdminLayout({ children, requireAdmin = false }: { children: ReactNode; requireAdmin?: boolean }) {
  const [location] = useLocation();
  // The layout (and so this scroller) stays while staff move between pages: each page starts at its
  // top, not part-way down where the last one was left (P3REV4-PERF-E).
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (main.current) main.current.scrollTop = 0;
  }, [location]);
  useNavigationFocus(main);
  return (
    <ThemeScope layer={STAFF_THEME}>
      <ProtectedRoute requireAdmin={requireAdmin}>
        <SkipToContent />
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <main ref={main} id="main" tabIndex={-1} className="flex-1 overflow-y-auto pt-[57px] focus:outline-none lg:pt-0">
            <RouteErrorBoundary homeHref={routes.staffHome()} resetKey={location}>
              <Suspense fallback={<PageSpinner label="Loading page" />}>{children}</Suspense>
            </RouteErrorBoundary>
          </main>
        </div>
      </ProtectedRoute>
      <ImpersonationBanner />
    </ThemeScope>
  );
}
