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
