import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One titled part of the tournament form; every part but the first is ruled off from the one above. */
export function FormSection({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <section className={cn("space-y-4", !first && "border-t border-border pt-6")}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h3>
      {children}
    </section>
  );
}
