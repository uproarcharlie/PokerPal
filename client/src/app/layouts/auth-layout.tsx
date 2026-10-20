import { Suspense, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ImpersonationBanner } from "@/components/auth/impersonation-banner";
import { PageSpinner } from "@/components/shared/page-spinner";
import { RouteErrorBoundary } from "../error-boundary";
import { routes } from "../routes";
import { ThemeScope, type ThemeLayer } from "../theme";
import { useNavigationFocus } from "./use-navigation-focus";

const AUTH_THEME: ThemeLayer = { colorScheme: "light", surface: "auth" };

/** Sign-in, sign-up and the staff invitation: full-screen forms of their own, outside the staff layout. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const main = useRef<HTMLElement>(null);
  useNavigationFocus(main);
  return (
    <ThemeScope layer={AUTH_THEME}>
      {/* Focusable (not in the tab order), so a move to another page can put focus on it. */}
      <main ref={main} id="main" tabIndex={-1} className="focus:outline-none">
        <RouteErrorBoundary homeHref={routes.landing()} resetKey={location}>
          <Suspense fallback={<PageSpinner label="Loading page" className="min-h-dvh" />}>{children}</Suspense>
        </RouteErrorBoundary>
      </main>
      <ImpersonationBanner />
    </ThemeScope>
  );
}
