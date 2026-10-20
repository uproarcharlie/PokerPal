import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "wouter";

/**
 * After a move to another page within the layout (never on the first page shown), puts focus on the
 * layout's `<main>` when it was lost: a link inside the old page went away with it, leaving focus on
 * the document, so a screen reader said nothing of the new page and the next Tab began again from the
 * top (MA-REV-04). Focus someone kept (a sidebar link) is left where it is; nothing scrolls.
 */
export function useNavigationFocus(main: RefObject<HTMLElement | null>): void {
  const [location] = useLocation();
  const shown = useRef(location);
  useEffect(() => {
    if (shown.current === location) return;
    shown.current = location;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) main.current?.focus({ preventScroll: true });
  }, [location, main]);
}
