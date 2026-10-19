/**
 * Club descriptions are staff-written rich text. The server sanitises them on write and again on every
 * read (SEC-08), and the client sanitises once more before it renders any of it as HTML, so markup can
 * only reach the page through the allowlist both share (shared/domain/rich-text).
 *
 * The input is parsed in an inert document (DOMParser runs no script and loads nothing, and decodes
 * character references as a browser does) and the output is rebuilt from fresh elements: only the
 * allowed tags, links with a checked href, every text node as text. Nothing from the parsed tree is
 * ever inserted into the page.
 */
import {
  keepsBlankTarget,
  RICH_TEXT_DROPPED_CONTAINERS,
  RICH_TEXT_HEADING_ALIASES as HEADING_ALIASES,
  RICH_TEXT_LINK_REL as LINK_REL,
  RICH_TEXT_MAX_DEPTH as MAX_DEPTH,
  RICH_TEXT_RAW_TEXT_TAGS,
  RICH_TEXT_TAGS as ALLOWED_TAGS,
  richTextHref,
} from "@shared/domain/rich-text";

/** Elements dropped together with their content. */
const DROPPED_TAGS: ReadonlySet<string> = new Set(Array.from(RICH_TEXT_RAW_TEXT_TAGS).concat(Array.from(RICH_TEXT_DROPPED_CONTAINERS)));

/** Elements whose end starts a new line of text, for plain-text excerpts. */
const BLOCK_TAGS: ReadonlySet<string> = new Set(["p", "br", "h2", "h3", "li", "blockquote", "div"]);

function copyAllowed(from: Node, to: Node, depth: number): void {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      to.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue; // comments, processing instructions
    const element = child as Element;
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || DROPPED_TAGS.has(element.localName)) continue;
    const tag = HEADING_ALIASES[element.localName] ?? element.localName;
    if (!ALLOWED_TAGS.has(tag) || depth >= MAX_DEPTH) {
      copyAllowed(element, to, depth); // unwrap: keep the text, drop the tag
      continue;
    }
    const href = tag === "a" ? richTextHref(element.getAttribute("href")) : null;
    if (tag === "a" && href === null) {
      copyAllowed(element, to, depth); // a link we would not follow: keep its text, as the server does
      continue;
    }
    const copy = document.createElement(tag);
    if (href !== null) {
      copy.setAttribute("href", href);
      if (keepsBlankTarget(element.getAttribute("target"))) copy.setAttribute("target", "_blank");
      copy.setAttribute("rel", LINK_REL);
    }
    if (tag !== "br") copyAllowed(element, copy, depth + 1);
    to.appendChild(copy);
  }
}

function parse(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, "text/html").body;
}

/** `html` reduced to the allowlist, as markup safe to render. */
export function sanitizeRichText(html: string): string {
  const container = document.createElement("div");
  copyAllowed(parse(html), container, 0);
  return container.innerHTML;
}

/** The text of `html`, block elements separated by spaces, whitespace collapsed: for excerpts and lengths. */
export function richTextToPlain(html: string): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? "");
      else if (child.nodeType === Node.ELEMENT_NODE && !DROPPED_TAGS.has((child as Element).localName)) {
        walk(child);
        if (BLOCK_TAGS.has((child as Element).localName)) parts.push(" ");
      }
    }
  };
  walk(parse(html));
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** The first `max` characters of the text, cut at a word where possible, with "…" when cut. */
export function richTextExcerpt(html: string, max: number): string {
  const text = richTextToPlain(html);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
