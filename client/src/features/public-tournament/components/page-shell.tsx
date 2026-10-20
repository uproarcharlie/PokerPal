import type { ReactNode } from "react";
import { Link } from "wouter";
import { routes } from "@/app/routes";
import { PageSpinner } from "@/components/shared/page-spinner";
import { EmptyState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A phone-sized card in the middle of the screen: the sign-up, the player requests, their results. */
export function CenteredCard({ children, wide = false, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <Card className={cn("w-full", wide ? "max-w-2xl" : "max-w-md", className)}>{children}</Card>
    </div>
  );
}

/** A tournament that does not exist (any more): a mistyped link, or one the TD removed. */
function TournamentMissing() {
  return (
    <EmptyState
      title="Tournament not found"
      description="The link may be mistyped, or the tournament may have been removed. Check it with the tournament director."
      action={
        <Button variant="outline" asChild>
          <Link href={routes.home()}>Find a club</Link>
        </Button>
      }
    />
  );
}

/**
 * QueryState's states for a public tournament page's first load, centred on the screen: a spinner,
 * then the page, or why it cannot be shown (missing, or the request failed, with a retry). Once
 * shown, the page stays when a later poll or refetch fails.
 */
export const TOURNAMENT_PAGE_STATES = {
  stateClassName: "mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center bg-background px-4 py-8",
  loading: <PageSpinner label="Loading tournament" />,
  errorTitle: "The tournament could not be loaded",
  notFound: <TournamentMissing />,
};
