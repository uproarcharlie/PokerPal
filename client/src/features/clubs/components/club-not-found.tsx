import { Link } from "wouter";
import { routes } from "@/app/routes";
import { EmptyState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";

/** A staff page for a club that does not exist (or no longer does). */
export function ClubNotFound() {
  return (
    <EmptyState
      title="Club Not Found"
      description="The club you're looking for doesn't exist."
      action={
        <Button asChild>
          <Link href={routes.clubs()}>Back to Clubs</Link>
        </Button>
      }
    />
  );
}
