import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, isApiError } from "@/lib/api/http";
import { cn } from "@/lib/utils";

/** What QueryState reads of a query (a TanStack query result, or several combined into one). */
export interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => unknown;
}

interface QueryStateProps<T> {
  query: QueryLike<T>;
  /** The page or section, given the loaded data. */
  children: (data: T) => ReactNode;
  /** What shows while loading (default: a few skeleton rows). A query waiting on another counts as loading. */
  loading?: ReactNode;
  /** What shows when the data is empty (see `isEmpty`); without it, empty data goes to `children`. */
  empty?: ReactNode;
  /** Whether the data counts as empty; default: an empty array. */
  isEmpty?: (data: T) => boolean;
  /** What shows for a 404 (default: the error state with the server's sentence). */
  notFound?: ReactNode;
  /** The error state's heading. */
  errorTitle?: string;
  /**
   * Classes for a box around the loading, error, not-found and empty states (not the loaded content):
   * a page's padding, or a column centred in the screen, so a page draws its first load in its own
   * frame and the loaded page in full (P3REV2-CQ-09).
   */
  stateClassName?: string;
}

const defaultIsEmpty = (data: unknown) => Array.isArray(data) && data.length === 0;

/** `stateClassName` for a staff page's main query: its states set in from the page's edges, as its content is. */
export const PAGE_STATE_CLASS = "px-4 py-6 sm:px-6 lg:px-8";

/**
 * The loading, error and empty states of one query, so no screen shows an empty list while it loads or
 * a "not found" for a failed request. The error state names the server's reason and offers a retry.
 * Data already on screen stays when a later refetch or poll fails (TanStack keeps it, and the next
 * refetch brings it up to date): one request dropped on the venue's Wi-Fi never blanks a page. A 404
 * does replace it with `notFound`.
 */
export function QueryState<T>({
  query,
  children,
  loading,
  empty,
  isEmpty = defaultIsEmpty,
  notFound,
  errorTitle = "This could not be loaded",
  stateClassName,
}: QueryStateProps<T>) {
  // Try again swaps the error for the loading state, taking the pressed button with it: a retry that fails
  // again puts focus back on the new one, so a keyboard or screen-reader user keeps their place (P3REV3-CQ-06).
  const [retried, setRetried] = useState(false);
  const framed = (state: ReactNode) => (stateClassName === undefined ? <>{state}</> : <div className={stateClassName}>{state}</div>);
  if (query.isPending) return framed(loading ?? <LoadingRows />);
  // A 404 is final even for data already on screen: it was deleted meanwhile (by another device), and
  // keeping the old copy up would show a tournament that no longer exists (P3REV4-PERF-D).
  if (query.isError && notFound && isApiError(query.error) && query.error.status === 404) return framed(notFound);
  if (query.isError && query.data === undefined) {
    return framed(
      <ErrorState
        title={errorTitle}
        message={errorMessage(query.error)}
        retrying={query.isRefetching}
        focusRetry={retried}
        onRetry={() => {
          setRetried(true);
          void query.refetch();
        }}
      />,
    );
  }
  const data = query.data as T;
  if (empty !== undefined && isEmpty(data)) return framed(empty);
  return <>{children(data)}</>;
}

/** Placeholder rows while something loads. */
export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-3", className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Shown again after a retry that failed: focus Try again, unless the person has moved on meanwhile. */
  focusRetry?: boolean;
  className?: string;
}

export function ErrorState({ title, message, onRetry, retrying = false, focusRetry = false, className }: ErrorStateProps) {
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (focusRetry && (active === null || active === document.body)) retry.current?.focus();
  }, [focusRetry]);
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-lg border border-destructive/30 px-4 py-8 text-center", className)}>
      <AlertCircle className="mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button ref={retry} variant="outline" size="sm" className="mt-4" onClick={onRetry} busy={retrying}>
          <RefreshCw className={cn("mr-2 h-4 w-4", retrying && "animate-spin")} aria-hidden="true" />
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      ) : null}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** A button or link to make the first one. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed px-4 py-10 text-center", className)}>
      <div className="mb-3 text-muted-foreground" aria-hidden="true">
        {icon ?? <SearchX className="h-8 w-8" />}
      </div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
