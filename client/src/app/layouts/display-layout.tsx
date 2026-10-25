import { Suspense, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ImpersonationBanner } from "@/components/auth/impersonation-banner";
import { PageSpinner } from "@/components/shared/page-spinner";
import { RouteErrorBoundary } from "../error-boundary";
import { routes } from "../routes";
import { ThemeScope, type ThemeLayer } from "../theme";
import { useNavigationFocus } from "./use-navigation-focus";

const DISPLAY_THEME: ThemeLayer = { colorScheme: "dark", surface: "display" };

/**
 * A screen shown full-bleed on the venue's TV (the tournament clock): always dark, nothing around the
 * page. An admin viewing as a club's manager is told so here too, at the top, clear of the staff's
 * control bar: that session runs the room's clock, and left on the TV it leads back to the admin's
 * account (P4REV3-SEC-03). The page is in its own error boundary and loading state, like every other
 * layout's.
 */
export function DisplayLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const main = useRef<HTMLElement>(null);
  useNavigationFocus(main);
  return (
    <ThemeScope layer={DISPLAY_THEME}>
      {/* Focusable (not in the tab order), so a move to another page can put focus on it. */}
      <main ref={main} id="main" tabIndex={-1} className="min-h-dvh bg-background text-foreground focus:outline-none">
        <RouteErrorBoundary homeHref={routes.landing()} resetKey={location}>
          <Suspense fallback={<PageSpinner label="Loading the clock" className="min-h-dvh" />}>{children}</Suspense>
        </RouteErrorBoundary>
      </main>
      <ImpersonationBanner placement="top" />
    </ThemeScope>
  );
}
