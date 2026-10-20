import { cn } from "@/lib/utils";

/**
 * What the "*" on a form's labels means, said once in each form that marks a field required (a
 * FormItem's `required`): a first-time user also learns that the rest may be left empty (WCAG 3.3.2).
 */
export function RequiredNote({ className }: { className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>Fields marked * are required.</p>;
}
