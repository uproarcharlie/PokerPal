import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ReturnFocusProps } from "@/components/ui/return-focus";
import { SHEET_FOOTER_ATTRIBUTE } from "@/lib/notifications-region";
import { cn } from "@/lib/utils";

const WIDTHS = {
  /** A form of a few fields (the seating settings). */
  narrow: "sm:max-w-lg",
  /** A table of rows (the blind structure, the payouts). */
  wide: "sm:max-w-xl md:max-w-2xl",
} as const;

interface PhoneSheetProps extends Pick<ReturnFocusProps, "returnFocusTo"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The heading. Without one the content draws its own PhoneSheetHeader, PhoneSheetBody and
   * PhoneSheetFooter: a sheet whose heading changes with its steps, or whose footer is its form's.
   */
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Kept in view under the scrolling content (Save, Cancel). */
  footer?: ReactNode;
  /** "right": a panel at the side from `sm` up; "bottom": rises from the foot (the phone desk). */
  side?: "right" | "bottom";
  /** From `sm` up, for side "right". */
  width?: keyof typeof WIDTHS;
  /** What takes focus as it opens instead of the first box: a search box focused by itself pulls the keyboard over half the list. */
  initialFocus?: RefObject<HTMLElement | null>;
  testId?: string;
}

/**
 * The TD's longer work on a phone (round5-contracts: "sheets full screen on phones"): the whole visible
 * screen (100dvh, never the browser's 100vh), the content scrolling between a fixed heading and a fixed
 * footer, clear of the notch and the home bar; a panel at the side on a larger screen. One frame for the
 * clock, seating, payout and desk sheets, so their headers, insets and heights match (R5REV3-CQ-06).
 */
export function PhoneSheet({ open, onOpenChange, title, description, children, footer, side = "right", width = "narrow", initialFocus, testId, returnFocusTo }: PhoneSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn("flex h-dvh max-h-dvh w-full flex-col gap-0 p-0", side === "right" ? WIDTHS[width] : null)}
        returnFocusTo={returnFocusTo}
        onOpenAutoFocus={
          initialFocus
            ? (event) => {
                event.preventDefault();
                initialFocus.current?.focus();
              }
            : undefined
        }
        data-testid={testId}
        // Without a description nothing describes the sheet (Radix would otherwise point at a missing one).
        {...(title !== undefined && !description ? { "aria-describedby": undefined } : {})}
      >
        {title !== undefined ? (
          <>
            <PhoneSheetHeader title={title} description={description} />
            <PhoneSheetBody atFoot={!footer}>{children}</PhoneSheetBody>
            {footer ? <PhoneSheetFooter>{footer}</PhoneSheetFooter> : null}
          </>
        ) : (
          children
        )}
      </SheetContent>
    </Sheet>
  );
}

interface PhoneSheetHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** The heading, focusable (tabIndex -1) for `initialFocus` and useStepFocus. */
  titleRef?: RefObject<HTMLHeadingElement>;
  /** Drawn before the title. */
  icon?: ReactNode;
  /** Kept in view under the description (the player a step is about). */
  children?: ReactNode;
}

export function PhoneSheetHeader({ title, description, titleRef, icon, children }: PhoneSheetHeaderProps) {
  return (
    <SheetHeader className="shrink-0 space-y-1 border-b border-border px-4 pb-3 pr-14 pt-[max(1rem,env(safe-area-inset-top))] text-left">
      <SheetTitle ref={titleRef} tabIndex={titleRef ? -1 : undefined} className={cn(icon ? "flex items-center gap-2" : null, titleRef ? "focus:outline-none" : null)}>
        {icon}
        {title}
      </SheetTitle>
      {description ? <SheetDescription>{description}</SheetDescription> : null}
      {children}
    </SheetHeader>
  );
}

/**
 * The part that scrolls. `atFoot` (no footer under it, the default): its end clears the phone's home bar.
 * While toasts stand over the sheet's foot it ends above them (TOAST_CLEARANCE_VARIABLE, which the
 * toaster sets), so they never cover a row the TD is about to tap.
 */
export function PhoneSheetBody({ children, atFoot = true, className }: { children: ReactNode; atFoot?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "mb-[var(--toast-clearance,0px)] min-h-0 flex-1 overflow-y-auto px-4 pt-4",
        atFoot ? "pb-[max(1.5rem,env(safe-area-inset-bottom))]" : "pb-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The sheet's buttons, kept in view: marked for the toaster, which keeps its toasts above them. */
export function PhoneSheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 gap-2 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" {...{ [SHEET_FOOTER_ATTRIBUTE]: "" }}>
      {children}
    </div>
  );
}

/**
 * When a sheet moves to its next step (a player chosen), focus goes to the new step's heading: the row
 * that was tapped has gone, and focus would fall to the top of the page (MA-P3REV1-03).
 */
export function useStepFocus(heading: RefObject<HTMLElement | null>, step: string): void {
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    heading.current?.focus();
  }, [heading, step]);
}
