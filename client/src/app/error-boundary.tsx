import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageNavigation } from "@/lib/page-navigation";
import { retryFailedPages } from "./lazy-page";

/** A lazy page's script that failed to arrive (a dropped connection) or no longer exists (a tab left open across a deploy). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i.test(message);
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
  /** Where "Go back home" leads: `routes.staffHome()` for staff screens, the site's home for public ones. */
  homeHref: string;
  /** Clears a caught error when it changes (the location), so moving to another page recovers. */
  resetKey?: string;
}

interface RouteErrorBoundaryState {
  error: unknown;
}

/**
 * Catches a render error in one part of the app (the public pages, the staff pages) and shows a
 * friendly way out instead of a blank screen. The sidebar and the rest of the layout stay usable.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("A page failed to render", error, info.componentStack);
  }

  componentDidUpdate(previous: RouteErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.retry();
  }

  /** Clears the error; a page whose script failed is fetched afresh when it is drawn again. */
  private readonly retry = () => {
    retryFailedPages();
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} homeHref={this.props.homeHref} onRetry={this.retry} />;
  }
}

interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** What shows instead of the section, with a way to try it again. */
  fallback: (retry: () => void) => ReactNode;
}

/**
 * Catches one part of a page, so a part that fails (a script that would not load) takes only itself
 * down, never the page and what was typed into it (P3REV4-PERF-B). `retry` draws the part again.
 */
export class SectionErrorBoundary extends Component<SectionErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("A part of the page failed to render", error, info.componentStack);
  }

  private readonly retry = () => {
    retryFailedPages();
    this.setState({ error: null });
  };

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.retry) : this.props.children;
  }
}

export function ErrorFallback({ error, homeHref, onRetry }: { error: unknown; homeHref: string; onRetry?: () => void }) {
  const update = isChunkLoadError(error);
  return (
    <div role="alert" className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
        <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-destructive" aria-hidden="true" />
        <h2 className="mb-2 text-xl font-semibold text-foreground">
          {update ? "This page could not be loaded" : "Something went wrong"}
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {update
            ? "Check your connection, then reload. If LovePoker.club was updated while this page was open, reloading picks up the new version."
            : "This page hit a problem and could not be shown. Reloading usually fixes it."}
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          {/* A dropped request: asking for the page again (it is loaded afresh) keeps the rest of the app. */}
          {update && onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button onClick={() => pageNavigation.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reload
          </Button>
          <Button variant="outline" asChild>
            <a href={homeHref}>Go back home</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
