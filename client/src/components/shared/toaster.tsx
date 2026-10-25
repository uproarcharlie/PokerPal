import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissToast, useToasts, type ToasterToast } from "@/hooks/use-toast";
import { NOTIFICATIONS_REGION_ATTRIBUTE } from "@/lib/notifications-region";
import { cn } from "@/lib/utils";

/** How long a toast shows, not counting while the pointer or keyboard focus is on it. */
export const TOAST_DURATION_MS = 5000;

/**
 * The toasts useToast() raises. Two live regions are always in the page, so a screen reader announces
 * each toast as it appears: a failure at once (assertive), anything else when the reader is free
 * (polite). The app's own rather than Radix Toast's, whose focus-wrapping proxies are focusable
 * elements hidden from screen readers and whose toasts are list items given another role (axe:
 * aria-hidden-focus and list), and whose close button had no name.
 */
export function Toaster() {
  const toasts = useToasts();
  const showing = (variant: NonNullable<ToasterToast["variant"]>) =>
    toasts
      .filter((toast) => (toast.variant ?? "default") === variant)
      .map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />);

  return (
    <section
      aria-label="Notifications"
      // Not "outside" an open dialog or sheet: tapping a toast leaves the form open (lib/notifications-region).
      {...{ [NOTIFICATIONS_REGION_ATTRIBUTE]: "" }}
      // At the foot of the screen (above the phone's home bar), never over the staff header and its menu
      // button at the top of a phone, where it sat after nearly every desk action (MA-P3REV1-05). Over a
      // phone's bottom tab bar (the TD's page), above it and its quick-action button instead.
      className="pointer-events-none fixed bottom-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:right-0 md:max-w-[420px] [:root:has([data-bottom-bar])_&]:bottom-[calc(7.5rem+env(safe-area-inset-bottom))]"
      data-testid="notifications"
    >
      <ol role="list" aria-live="assertive" className="flex flex-col gap-2">
        {showing("destructive")}
      </ol>
      <ol role="list" aria-live="polite" className="flex flex-col gap-2">
        {showing("default")}
      </ol>
    </section>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToasterToast; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useDismissAfter(TOAST_DURATION_MS, onDismiss, hovered || focused);

  return (
    <li
      className={cn(
        "pointer-events-auto relative w-full rounded-md border p-4 pr-12 shadow-lg animate-in fade-in-0 slide-in-from-bottom-full",
        toast.variant === "destructive" ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background text-foreground",
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => setFocused(event.currentTarget.contains(event.relatedTarget))}
    >
      {toast.title ? <p className="text-sm font-semibold">{toast.title}</p> : null}
      {toast.description ? <div className={cn("text-sm opacity-90", toast.title ? "mt-1" : null)}>{toast.description}</div> : null}
      {toast.action ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 text-foreground"
          onClick={() => {
            onDismiss();
            toast.action?.onClick();
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDismiss();
        }}
        className="absolute right-1 top-1 inline-flex h-10 w-10 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Calls `onDone` once the component has been shown for `ms` while not `paused`; a pause keeps the time left. */
function useDismissAfter(ms: number, onDone: () => void, paused: boolean) {
  const done = useRef(onDone);
  const remaining = useRef(ms);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => done.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused]);
}
