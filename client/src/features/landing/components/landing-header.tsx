import { Link } from "wouter";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { BrandMark } from "./brand-mark";

/** The marketing page's top bar: the mark, then sign in and sign up (or, signed in, the way to the dashboard). */
export function LandingHeader() {
  const { isAuthenticated } = useAuth();
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-4">
        <BrandMark size="md" nameClassName="text-base sm:text-xl" />
        <nav aria-label="Account" className="flex shrink-0 items-center gap-1 sm:gap-4">
          {isAuthenticated ? (
            <Button size="sm" asChild>
              <Link href={routes.staffHome()}>Go to Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href={routes.login()}>Log In</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href={routes.register()}>
                  <span className="sm:hidden">Sign Up</span>
                  <span className="hidden sm:inline">Get Started Free</span>
                </Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
