import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** What shows while a page's code or its first data is on the way. */
export function PageSpinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex min-h-[50vh] items-center justify-center", className)}>
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
