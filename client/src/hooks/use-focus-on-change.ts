import { useEffect, useRef } from "react";

/**
 * A ref for content that replaces what was on screen (a form's next step, an action's own form): when
 * `view` changes, focus moves to it. The button the person pressed went with the old content, and
 * focus fell to the top of the page, so a screen-reader user had to find the new step from the start
 * (MA-P3REV1-03). Never on the first render: the page's own load does not take focus. The element
 * needs `tabIndex={-1}`.
 */
export function useFocusOnChange<T extends HTMLElement>(view: string | number) {
  const target = useRef<T>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    target.current?.focus();
  }, [view]);
  return target;
}
