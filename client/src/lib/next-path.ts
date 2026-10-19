/**
 * Where to go once signed in: the `next` query parameter when it is a path on this site (an
 * invitation link sends people through sign-in and back: SEC-P2REV-03), else `fallback`. Anything
 * else, such as `//elsewhere.example` or a full URL, is ignored, so the parameter can never send
 * someone to another site.
 */
export function nextPath(search: string, fallback = "/clubs"): string {
  const next = new URLSearchParams(search).get("next");
  return next && /^\/(?![/\\])/.test(next) ? next : fallback;
}

/** `path` with `?next=` carried over, for links between the sign-in and sign-up pages. */
export function withNext(path: string, search: string): string {
  const next = nextPath(search, "");
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
