import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** A link up one level, e.g. `{ href: routes.clubs(), label: "Clubs" }`. */
  back?: { href: string; label: string };
  /** Buttons for the page; they wrap under the title on a phone. */
  actions?: ReactNode;
  className?: string;
}

/**
 * A staff page's title bar: back link, title, description and actions, stacked on narrow screens. It
 * stays in view from tablet width up; on a phone it scrolls away with the page, as its wrapped action
 * rows would otherwise pin a third of the screen under the app bar (MA-01).
 */
export function PageHeader({ title, description, back, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("border-b border-border bg-card md:sticky md:top-0 md:z-10", className)}>
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="min-w-0">
          {back ? (
            <Link
              href={back.href}
              className="mb-1 inline-flex min-h-10 items-center gap-1 rounded-sm text-sm text-muted-foreground md:min-h-0 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {back.label}
            </Link>
          ) : null}
          <h1 className="break-words text-2xl font-bold text-foreground">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
