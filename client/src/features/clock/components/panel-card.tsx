import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PanelCardProps {
  title: string;
  description?: ReactNode;
  /** In a sheet that already says what it is (a phone's Clock tab): the content alone, no card round it. */
  bare?: boolean;
  className?: string;
  children: ReactNode;
}

/** A part of the Clock tab: a card on a larger screen, the body of its own sheet on a phone. */
export function PanelCard({ title, description, bare = false, className, children }: PanelCardProps) {
  if (bare) {
    return (
      <section aria-label={title} className={cn("space-y-4", className)}>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {children}
      </section>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn("space-y-4", className)}>{children}</CardContent>
    </Card>
  );
}
