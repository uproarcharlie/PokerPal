import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/query-state";
import { routes } from "@/app/routes";

/**
 * A tournament page whose tournament the server does not have (404): deleted, or a wrong link. Shown
 * inside the page's PAGE_STATE_CLASS frame, so it is inset once, like every staff page's states.
 */
export function TournamentNotFound() {
  return (
    <EmptyState
      className="my-6 sm:mx-auto sm:max-w-md"
      title="Tournament not found"
      description="It may have been deleted, or the link is wrong."
      action={
        <Button asChild>
          <Link href={routes.tournaments()}>Back to Tournaments</Link>
        </Button>
      }
    />
  );
}
