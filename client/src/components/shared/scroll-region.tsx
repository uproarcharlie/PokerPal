import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

interface ScrollRegionProps {
  /** What it holds, e.g. "Standings": the region's accessible name. */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * A box whose content may scroll inside it: a wide table on a phone, a long feed. While its content
 * overflows it is in the tab order, so someone on a keyboard can focus it and scroll with the arrow
 * keys (WCAG 2.1.1; axe scrollable-region-focusable); when everything fits it is not, so it adds no
 * empty tab stop. It is a named region either way, so a screen reader says what it holds.
 */
export function ScrollRegion({ label, className, children }: ScrollRegionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollable = useOverflows(ref);
  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      // A scrolling region has to take focus to be scrolled from the keyboard.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={scrollable ? 0 : undefined}
      className={cn("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", className)}
    >
      {children}
    </div>
  );
}

/** Whether the element's content is bigger than its box, kept up to date as either changes size. */
function useOverflows(ref: RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setOverflows(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref]);
  return overflows;
}
