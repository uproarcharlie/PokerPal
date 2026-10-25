/**
 * The toaster's region is not "outside" an open dialog or sheet. A toast sits above every layer (on a
 * phone, over a sheet's title and close button), and a form raises one while it stays open, so a tap
 * on the toast or its dismiss button must not count as a tap outside the form, which would close it
 * and lose what was typed (MA-03). Dialogs and sheets pass their outside-interaction handler through
 * this.
 */
export const NOTIFICATIONS_REGION_ATTRIBUTE = "data-notifications-region";

export function isInNotificationsRegion(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${NOTIFICATIONS_REGION_ATTRIBUTE}]`) !== null;
}

/** `handler`, then keeps the layer open when the interaction was on a toast. */
export function keepOpenForNotifications<E extends Event>(handler?: (event: E) => void): (event: E) => void {
  return (event) => {
    handler?.(event);
    if (isInNotificationsRegion(event.target)) event.preventDefault();
  };
}

/**
 * Marks a phone sheet's footer (its Save or Confirm, kept in view): the toaster keeps its toasts above
 * it, so a refusal never hides the button to press again (round 6, B3).
 */
export const SHEET_FOOTER_ATTRIBUTE = "data-sheet-footer";

/**
 * Set by the toaster on the open dialog or sheet while toasts stand over its foot: how much of it they
 * cover ("120px"). A phone sheet's scrolling body (PhoneSheetBody) ends that far above, so no row of it
 * is ever under a toast, and its last rows still scroll into view (R6REV1-PHONE-03).
 */
export const TOAST_CLEARANCE_VARIABLE = "--toast-clearance";
