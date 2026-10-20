import { useRef, useState, type RefObject } from "react";

export interface ReturnFocusProps {
  /**
   * Where focus goes when the layer closes and the element that opened it is gone (a menu item, whose
   * menu closed): usually that menu's trigger. Without it, focus goes back to the opener only.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Puts focus back where it was when a dialog, alert or sheet closes. Radix returns it only to a
 * Dialog Trigger, and the app opens its layers from state (a desk button, a menu item, a row's
 * control), so focus fell to <body> on every close and a keyboard or screen-reader user was sent back
 * to the top of a long page (MA-P3REV1-01, -02, -04). A caller's own `onCloseAutoFocus` that prevents
 * the default still wins.
 */
export function useReturnFocus({ returnFocusTo, onOpenAutoFocus, onCloseAutoFocus }: ReturnFocusProps) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      // Radix moves focus into the layer after this event: what has it now is what opened the layer.
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      for (const target of [opener.current, returnFocusTo?.current]) {
        if (!target?.isConnected) continue;
        target.focus();
        if (document.activeElement === target) {
          event.preventDefault();
          return;
        }
      }
    },
  };
}

/**
 * A `returnFocusTo` that is the first of `refs` still in the page when the layer closes: a list's
 * heading, and the card's once the list itself has gone with its last row. One object for the
 * component's life, read only when the layer closes, because a layer that closes as its opener's list
 * empties keeps the handler of the render before (P3REV-MA-FOCUS-AFTER-REMOVE). The refs must be the
 * component's own (useRef) or its parent's, which never change.
 */
export function useFirstInPage(...refs: RefObject<HTMLElement | null>[]): RefObject<HTMLElement | null> {
  const [target] = useState<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return refs.map((ref) => ref.current).find((element) => element?.isConnected) ?? null;
    },
  }));
  return target;
}
