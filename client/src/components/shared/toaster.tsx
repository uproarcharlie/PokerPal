import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissToast, useToasts, type ToasterToast } from "@/hooks/use-toast";
import { NOTIFICATIONS_REGION_ATTRIBUTE, SHEET_FOOTER_ATTRIBUTE, TOAST_CLEARANCE_VARIABLE } from "@/lib/notifications-region";
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
  const region = useRef<HTMLElement>(null);
  const layerFoot = useOpenLayerFoot(region, toasts.length > 0);
  const showing = (variant: NonNullable<ToasterToast["variant"]>) =>
    toasts
      .filter((toast) => (toast.variant ?? "default") === variant)
      .map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />);

  return (
    <section
      ref={region}
      aria-label="Notifications"
      // Not "outside" an open dialog or sheet: tapping a toast leaves the form open (lib/notifications-region).
      {...{ [NOTIFICATIONS_REGION_ATTRIBUTE]: "" }}
      // At the foot of the screen (above the phone's home bar), never over the staff header and its menu
      // button at the top of a phone, where it sat after nearly every desk action (MA-P3REV1-05). Over a
      // phone's bottom tab bar (the TD's page), above it and its quick-action button instead. While a
      // dialog or sheet is open, where useOpenLayerFoot says.
      className={cn(
        "pointer-events-none fixed bottom-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:right-0 md:max-w-[420px] [:root:has([data-bottom-bar])_&]:bottom-[calc(7.5rem+env(safe-area-inset-bottom))]",
        // Above a footer, which already clears the home bar.
        layerFoot ? "pb-4" : null,
      )}
      style={layerFoot === null ? undefined : { bottom: layerFoot }}
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

/** The open dialogs and sheets. Each has its own portal at the end of the page, so the last is on top. */
const OPEN_LAYERS = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/** The most of the screen's height a footer takes; a taller part is the layer's content. */
const FOOTER_MAX_SHARE = 0.4;

/**
 * Where the toasts stand while a dialog or sheet is open: how far above the screen's foot, or null while
 * none is open (the classes place them). The layer covers the TD's tab bar, so they leave it and go to
 * the foot; there, they would hide a phone sheet's footer (its Save or Confirm, the button to press
 * again after a refusal), so they rise above it instead (round 6, B3). The layer is told how much of
 * its foot they then cover (TOAST_CLEARANCE_VARIABLE), so a phone sheet's body ends above them and
 * none of its rows is under a toast (R6REV1-PHONE-03). Measured only while toasts show: as one appears,
 * and again when a layer opens, closes or moves to its next step, an animation (a sheet sliding in)
 * ends, or the window is resized.
 */
function useOpenLayerFoot(region: RefObject<HTMLElement | null>, showing: boolean): number | null {
  const [foot, setFoot] = useState<number | null>(null);
  useEffect(() => {
    if (!showing) return;
    let frame = 0;
    // The layer last told how much the toasts cover, told again (or freed) at each measure.
    let cleared: HTMLElement | null = null;
    const clear = (layer: HTMLElement | null, clearance: number) => {
      if (cleared && cleared !== layer) cleared.style.removeProperty(TOAST_CLEARANCE_VARIABLE);
      cleared = layer;
      layer?.style.setProperty(TOAST_CLEARANCE_VARIABLE, `${clearance}px`);
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      // Once the browser has laid out the change.
      frame = requestAnimationFrame(() => {
        const placed = region.current ? overOpenLayer(region.current) : null;
        clear(placed?.layer ?? null, placed?.clearance ?? 0);
        setFoot(placed?.foot ?? null);
      });
    };
    measure();
    const changes = new MutationObserver(measure);
    changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    document.addEventListener("animationend", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      document.removeEventListener("animationend", measure, true);
      window.removeEventListener("resize", measure);
      // With the last toast gone the layer's body reaches its foot again.
      clear(null, 0);
      // The next toast is measured afresh, never shown first where the last one stood.
      setFoot(null);
    };
  }, [region, showing]);
  return showing ? foot : null;
}

interface LayerPlacement {
  /** The open dialog or sheet on top. */
  layer: HTMLElement;
  /** How far above the screen's foot the toasts stand. */
  foot: number;
  /** How much of what scrolls in the layer (all of it above its footer) the toasts then cover. */
  clearance: number;
}

/** useOpenLayerFoot's measure: `region` is the toasts' own. Null while no layer is open. */
function overOpenLayer(region: HTMLElement): LayerPlacement | null {
  const layers = document.querySelectorAll<HTMLElement>(OPEN_LAYERS);
  const layer = layers.item(layers.length - 1);
  // One not drawn (yet) covers nothing.
  if (!layer || layer.getBoundingClientRect().height === 0) return null;
  const screenHeight = window.innerHeight;
  const toasts = region.getBoundingClientRect();
  const box = layer.getBoundingClientRect();
  const footer = footerOf(layer)?.getBoundingClientRect();
  // A dialog's buttons above the toasts' height, or beside them, are already clear.
  const covered = footer !== undefined && footer.bottom > screenHeight - toasts.height && footer.left < toasts.right && footer.right > toasts.left;
  const foot = covered ? Math.max(0, Math.ceil(screenHeight - footer.top)) : 0;
  // Where the toasts' top then is, against the foot of what scrolls: the footer's top, or the layer's foot.
  const beside = toasts.left >= box.right || toasts.right <= box.left;
  const overlap = (footer ? footer.top : box.bottom) - (screenHeight - foot - toasts.height);
  return { layer, foot, clearance: beside ? 0 : Math.max(0, Math.ceil(Math.min(toasts.height, overlap))) };
}

/**
 * The layer's footer: a phone sheet's marks its own (SHEET_FOOTER_ATTRIBUTE). Any other layer's is the
 * lowest of its parts (or of a wrapper's, such as a form around the fields and the buttons) when that
 * part does not scroll and is no taller than a footer. None when what reaches the layer's foot is
 * content that scrolls (a sheet's list), which has nothing kept in view below it.
 */
function footerOf(layer: Element): Element | null {
  const marked = Array.from(layer.querySelectorAll(`[${SHEET_FOOTER_ATTRIBUTE}]`)).filter((footer) => footer.getBoundingClientRect().height > 1);
  if (marked.length > 0) return marked.at(-1) ?? null;
  let part = lowestChild(layer);
  for (let depth = 0; part && depth < 3; depth += 1) {
    const { overflowY } = getComputedStyle(part);
    if (overflowY === "auto" || overflowY === "scroll") return null;
    if (part.getBoundingClientRect().height <= window.innerHeight * FOOTER_MAX_SHARE) return part;
    part = lowestChild(part);
  }
  return null;
}

/** The child that reaches lowest (the later of equals), leaving out any not drawn or screen-reader only (1 px). */
function lowestChild(parent: Element): Element | null {
  let lowest: Element | null = null;
  let bottom = -Infinity;
  for (const child of Array.from(parent.children)) {
    const rect = child.getBoundingClientRect();
    if (rect.height <= 1 || rect.bottom < bottom) continue;
    lowest = child;
    bottom = rect.bottom;
  }
  return lowest;
}
