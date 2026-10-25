import { useSyncExternalStore, type ReactNode } from "react";

/** How many toasts show at once, newest first. */
const TOAST_LIMIT = 3;

/** The one thing a toast offers to do next ("Seat now"): pressing it closes the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** A toast as the Toaster (components/shared/toaster.tsx) shows it. */
export interface ToasterToast {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  /** "destructive" for a failure: drawn in the error colours and announced at once. */
  variant?: "default" | "destructive";
  action?: ToastAction;
}

type Toast = Omit<ToasterToast, "id">;

let count = 0;
let toasts: readonly ToasterToast[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly ToasterToast[]) {
  toasts = next;
  listeners.forEach((listener) => listener());
}

/**
 * The toasts showing once `next` arrives: newest first, at most TOAST_LIMIT. Over the limit the oldest
 * one that only informs goes, so a toast offering a next step (a bust's Undo, "Seat now") is never
 * pushed out by news that came after it, such as a QR sign-up seated by another device a moment after
 * a one-tap bust (R5REV-HOST-08); only when every toast offers one does the oldest go.
 */
function admitToast(shown: readonly ToasterToast[], next: ToasterToast): ToasterToast[] {
  const stack = [next, ...shown];
  while (stack.length > TOAST_LIMIT) {
    let oldestNews = stack.length - 1;
    while (oldestNews >= 0 && stack[oldestNews].action) oldestNews -= 1;
    stack.splice(oldestNews >= 0 ? oldestNews : stack.length - 1, 1);
  }
  return stack;
}

/** Shows a toast; returns its id and a way to close it early. */
export function toast(props: Toast): { id: string; dismiss: () => void } {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  const id = String(count);
  publish(admitToast(toasts, { ...props, id }));
  return { id, dismiss: () => dismissToast(id) };
}

/** Closes one toast, or every toast. */
export function dismissToast(id?: string): void {
  publish(id === undefined ? [] : toasts.filter((shown) => shown.id !== id));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * `toast` for a component that raises toasts. It subscribes to nothing: the 30-odd components that
 * raise toasts no longer re-render whenever one appears or goes (P3REV5-CQ-10); only the Toaster
 * follows the list (useToasts).
 */
export function useToast() {
  return { toast, dismiss: dismissToast };
}

/** The toasts showing now: for the Toaster alone. */
export function useToasts(): readonly ToasterToast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}
