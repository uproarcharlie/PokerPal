import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { SITE_NAME } from "@/app/page-meta";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { STEPS } from "../content";
import { BrandMark } from "./brand-mark";

/** Three steps from sign-up to a running game. */
export function StepsSection() {
  return (
    <section className="container mx-auto px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">Get started in minutes</h2>
          <p className="text-lg text-muted-foreground">No complicated setup. Start running better tournaments today.</p>
        </div>
        <ol role="list" className="grid gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="text-center">
              <div
                className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary"
                aria-hidden="true"
              >
                {index + 1}
              </div>
              <h3 className="mb-3 text-xl font-bold text-foreground">{step.title}</h3>
              <p className="text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The last call to action, on the brand colour. */
export function CallToActionSection() {
  return (
    <section className="border-y border-border bg-primary py-16 text-primary-foreground sm:py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-4 text-3xl font-bold text-primary-foreground sm:text-4xl">Ready to level up your poker club?</h2>
          <p className="mb-8 text-lg opacity-90">
            Join hundreds of clubs using {SITE_NAME} to run smoother tournaments, engage players, and grow their community.
          </p>
          <Button size="lg" variant="secondary" className="text-lg" asChild>
            <Link href={routes.register()}>
              Start Free Trial
              <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
          <p className="mt-6 text-sm opacity-75">Free for up to 9 players • No credit card required • Cancel anytime</p>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-border py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <BrandMark size="sm" nameClassName="font-semibold" />
          <nav aria-label="Footer" className="flex gap-6 text-sm text-muted-foreground">
            <Link href={routes.home()} className="hover:text-foreground">
              Find a club
            </Link>
            <Link href={routes.privacy()} className="hover:text-foreground">
              Privacy
            </Link>
          </nav>
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
