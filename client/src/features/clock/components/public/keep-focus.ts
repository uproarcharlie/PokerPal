import type { MouseEvent } from "react";

/**
 * A mouse press that leaves focus where it was. On the TV, Space is Start / Pause for the club's staff:
 * a button that kept focus after a click would take Space for itself, and keep its bar on screen
 * (P4REV0-TV-SPACE-FOCUS). Keyboard focus still shows, and still reveals the buttons. A module of its
 * own, so the staff page's clock buttons use it without loading the TV screen (R2-CQ-03).
 */
export const keepFocusOnMouseDown = (event: MouseEvent) => event.preventDefault();
