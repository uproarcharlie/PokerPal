/**
 * Where the invitation's secret is kept while the person signs in or signs up: the link's fragment
 * (`/staff-invite#<token>`, never in a server log) first, then this tab's sessionStorage, so it
 * survives the trip through the sign-in page.
 */
import { routes } from "@/app/routes";

const STORAGE_KEY = "pokerpal.staffInvite";

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Keeps the secret for after signing in, or forgets it (null). */
export function storeInviteToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (a private window): the link still works if opened again once signed in.
  }
}

/** The secret from the link, or the one kept while the person signed in. The fragment is cleared from the address bar once read. */
export function takeInviteToken(): string | null {
  const fromLink = window.location.hash.replace(/^#/, "");
  if (fromLink) {
    storeInviteToken(fromLink);
    window.history.replaceState(null, "", routes.staffInvite());
    return fromLink;
  }
  return readStored();
}
