/**
 * The rich-text policy for club descriptions (SEC-08), in one place for both sanitisers: the server's
 * (server/services/sanitize-html.ts, on write and on every read) and the client's
 * (client/src/lib/rich-text.ts, before anything is rendered as HTML). They parse differently (a
 * tokenizer on the server, the browser's DOMParser on the client) but keep exactly this. PURE.
 */

/** Tags kept (lower case). Attributes are dropped, except a link's href and target="_blank". */
export const RICH_TEXT_TAGS: ReadonlySet<string> = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "a",
]);

/** Headings outside the allowlist keep their emphasis as the nearest allowed heading. */
export const RICH_TEXT_HEADING_ALIASES: Readonly<Record<string, string>> = { h1: "h2", h4: "h3", h5: "h3", h6: "h3" };

/** Elements whose content is raw text to a browser: dropped together with that content. */
export const RICH_TEXT_RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript",
]);

/** Elements dropped together with everything inside them (foreign markup, embedded documents, forms). */
export const RICH_TEXT_DROPPED_CONTAINERS: ReadonlySet<string> = new Set(["template", "svg", "math", "select", "object", "head"]);

/** Deeper nesting is flattened (its tags dropped, its text kept), which keeps the work linear. */
export const RICH_TEXT_MAX_DEPTH = 100;

/** Forced on every link kept. */
export const RICH_TEXT_LINK_REL = "noopener noreferrer nofollow";

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);
const MAX_HREF_LENGTH = 2048;

/**
 * The href a link keeps, or null to drop the link (its text stays). `value` is the attribute with its
 * character references already decoded. It is parsed with the WHATWG URL parser, as a browser would,
 * and kept in its canonical form, so the protocol checked is the one a browser follows: http(s) or
 * mailto only, at most 2048 characters. Relative links are refused.
 */
export function richTextHref(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_HREF_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  return LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
}

/** Whether a link's target attribute is kept: only `_blank` (any case, any surrounding space). */
export function keepsBlankTarget(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === "_blank";
}
