import { useSyncExternalStore, type ReactNode } from "react";

/** One toast at a time: a new one replaces the last. */
const TOAST_LIMIT = 1;

/** A toast as the Toaster (components/shared/toaster.tsx) shows it. */
export interface ToasterToast {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  /** "destructive" for a failure: drawn in the error colours and announced at once. */
  variant?: "default" | "destructive";
}

type Toast = Omit<ToasterToast, "id">;

let count = 0;
let toasts: readonly ToasterToast[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly ToasterToast[]) {
  toasts = next;
  listeners.forEach((listener) => listener());
}

/** Shows a toast; returns its id and a way to close it early. */
export function toast(props: Toast): { id: string; dismiss: () => void } {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  const id = String(count);
  publish([{ ...props, id }, ...toasts].slice(0, TOAST_LIMIT));
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
