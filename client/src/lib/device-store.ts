/**
 * Choices kept on one device (the TD's "paid players only", a TV's volume and edge margin), in
 * localStorage under one prefix. Every access is guarded: a browser that refuses storage (a private
 * window, a full quota) keeps what it could not store while the page is open. Every reader hears a
 * change at once on this page, and from another tab of the same browser through `storage`.
 */

export interface DeviceStore {
  /** The text stored under `key`, null for none. */
  read: (key: string) => string | null;
  /** Stores `value` under `key` (null removes it) and tells every reader. */
  write: (key: string, value: string | null) => void;
  /** For useSyncExternalStore: called on every change to the store's keys, here or in another tab. */
  subscribe: (onChange: () => void) => () => void;
}

export function createDeviceStore(prefix: string): DeviceStore {
  /** What could not be stored, by key: it outranks storage until a write gets through. */
  const unstored = new Map<string, string | null>();
  const listeners = new Set<() => void>();

  const read = (key: string): string | null => {
    if (unstored.has(key)) return unstored.get(key) ?? null;
    try {
      return window.localStorage.getItem(prefix + key);
    } catch {
      return null;
    }
  };

  const write = (key: string, value: string | null): void => {
    try {
      if (value === null) window.localStorage.removeItem(prefix + key);
      else window.localStorage.setItem(prefix + key, value);
      unstored.delete(key);
    } catch {
      unstored.set(key, value);
    }
    listeners.forEach((listener) => listener());
  };

  const subscribe = (onChange: () => void): (() => void) => {
    listeners.add(onChange);
    // A key of null: the other tab cleared the whole storage.
    const fromOtherTab = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(prefix)) onChange();
    };
    window.addEventListener("storage", fromOtherTab);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", fromOtherTab);
    };
  };

  return { read, write, subscribe };
}
