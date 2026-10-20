import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A figure worked out from a query: its value once known, "loading" while it loads, "failed" when it
 * could not be loaded. One way for every screen (P3REV5-CQ-07): a figure is never a 0 or a blank
 * before it is known, and a failure always looks the same.
 */
export type QueryFigure = { value: ReactNode } | "loading" | "failed";

/** `pick` of a query's data, or where that query stands. */
export function figureOf<T>(query: { data: T | undefined; isError: boolean }, pick: (data: T) => ReactNode): QueryFigure {
  if (query.data !== undefined) return { value: pick(query.data) };
  return query.isError ? "failed" : "loading";
}

/** The figure, inline: a placeholder the size of `loadingClassName` while it loads, a dash if it failed. */
export function FigureValue({ figure, loadingClassName = "h-4 w-10" }: { figure: QueryFigure; loadingClassName?: string }) {
  if (figure === "loading") {
    return (
      <span className={cn("inline-block animate-pulse rounded-md bg-muted align-middle", loadingClassName)}>
        <span className="sr-only">Loading</span>
      </span>
    );
  }
  if (figure === "failed") {
    return (
      <span className="text-muted-foreground" title="This could not be loaded">
        –
        <span className="sr-only">(could not be loaded)</span>
      </span>
    );
  }
  return <>{figure.value}</>;
}
