import { Link } from "wouter";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { routes } from "./routes";

/** Any URL the app has no page for. */
export function NotFound() {
  const { isAuthenticated } = useAuth();
  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
        <Compass className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">Page not found</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          There is nothing at this address. The link may be mistyped, or the page may have moved.
        </p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          {isAuthenticated ? (
            <Button asChild>
              <Link href={routes.staffHome()}>Go to the dashboard</Link>
            </Button>
          ) : null}
          <Button variant={isAuthenticated ? "outline" : "default"} asChild>
            <Link href={routes.home()}>Find a club</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
