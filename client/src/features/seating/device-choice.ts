/**
 * A choice the TD makes on one device that should outlive a refresh, a phone bringing the tab back or
 * a look at another tab (TDN3-PAIDONLY-RESET): kept under `pokerpal.seating.<key>` (lib/device-store,
 * which every reader of a key hears change, on this page and from another tab).
 */
import { useSyncExternalStore } from "react";
import { createDeviceStore } from "@/lib/device-store";

const store = createDeviceStore("pokerpal.seating.");

/**
 * The device's choice for `key`, one of `options` (the first is the default, which is stored as no
 * value), and the way to change it.
 */
export function useDeviceChoice<T extends string>(key: string, options: readonly [T, ...T[]]): [T, (next: T) => void] {
  const stored = useSyncExternalStore(
    store.subscribe,
    () => store.read(key),
    () => null,
  );
  const value = options.find((option) => option === stored) ?? options[0];
  return [value, (next) => store.write(key, next === options[0] ? null : next)];
}
