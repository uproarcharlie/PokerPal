/**
 * Staff-written rich text (club descriptions) reduced to a small allowlist before it is stored and
 * again before it is served, because stored rows may predate this (SEC-08).
 *
 * The output is rebuilt, never copied: only the tags below are emitted, links carry a checked `href`
 * and nothing else from the input, every text run is escaped, and every tag opened is closed. So
 * whatever the input holds (malformed markup, tricks that depend on how a browser parses it), the
 * result can only contain this markup. The tokenizer is lenient: a misread can lose formatting but
 * can never let other markup through.
 */

import { createHash } from "node:crypto";
import {
  keepsBlankTarget,
  RICH_TEXT_DROPPED_CONTAINERS as DROPPED_CONTAINERS,
  RICH_TEXT_HEADING_ALIASES as HEADING_ALIASES,
  RICH_TEXT_LINK_REL as LINK_REL,
  RICH_TEXT_MAX_DEPTH as MAX_DEPTH,
  RICH_TEXT_RAW_TEXT_TAGS as RAW_TEXT_TAGS,
  RICH_TEXT_TAGS as ALLOWED_TAGS,
  richTextHref,
} from "@shared/domain/rich-text";

// The policy (tags, headings, dropped elements, links) is shared/domain/rich-text, which the client's
// sanitiser applies too; this module is the server's parser for it.

/** The only allowed tag with no content or closing tag. */
const VOID_TAGS: ReadonlySet<string> = new Set(["br"]);

const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** A character reference that a browser decodes in text: passed through as written. */
const CHARACTER_REFERENCE = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

function escapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === "&") {
      const reference = CHARACTER_REFERENCE.exec(text.slice(i, i + 40));
      out += reference ? "&" : "&amp;";
    } else out += char;
  }
  return out;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeReferences(value: string): string {
  return value.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]+);/g, (match, body: string) => {
    if (body[0] !== "#") return NAMED_REFERENCES[body] ?? match;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
  });
}

/** The link target to emit, or null to drop the link (its text stays): richTextHref of the decoded attribute. */
export function safeLinkHref(raw: string): string | null {
  return richTextHref(decodeReferences(raw));
}

const isAsciiLetter = (char: string | undefined) =>
  char !== undefined && ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z"));
const isSpace = (char: string | undefined) =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

interface Tag {
  name: string;
  attributes: Map<string, string>;
  /** Index just past the tag's closing ">", or -1 when the input ends inside the tag. */
  end: number;
}

/** Reads the start tag whose name begins at `start` (just past "<"). First attribute of a name wins. */
function readStartTag(html: string, start: number): Tag {
  let pos = start;
  while (pos < html.length && !isSpace(html[pos]) && html[pos] !== "/" && html[pos] !== ">") pos++;
  const name = html.slice(start, pos).toLowerCase();
  const attributes = new Map<string, string>();

  for (;;) {
    while (isSpace(html[pos]) || html[pos] === "/") pos++;
    if (pos >= html.length) return { name, attributes, end: -1 };
    if (html[pos] === ">") return { name, attributes, end: pos + 1 };

    const nameStart = pos;
    pos++;
    while (pos < html.length && !isSpace(html[pos]) && html[pos] !== "/" && html[pos] !== ">" && html[pos] !== "=") pos++;
    const attribute = html.slice(nameStart, pos).toLowerCase();
    while (isSpace(html[pos])) pos++;

    let value = "";
    if (html[pos] === "=") {
      pos++;
      while (isSpace(html[pos])) pos++;
      const quote = html[pos];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, pos + 1);
        if (close === -1) return { name, attributes, end: -1 };
        value = html.slice(pos + 1, close);
        pos = close + 1;
      } else {
        const valueStart = pos;
        while (pos < html.length && !isSpace(html[pos]) && html[pos] !== ">") pos++;
        value = html.slice(valueStart, pos);
      }
    }
    if (!attributes.has(attribute)) attributes.set(attribute, value);
  }
}

/** Index just past the next `needle` at or after `from`, or the input's length when there is none. */
function pastNext(html: string, needle: string, from: number): number {
  const at = html.indexOf(needle, from);
  return at === -1 ? html.length : at + needle.length;
}

/** Index just past the end tag `</name ...>` of a raw-text element, or the input's length. */
function pastRawTextEnd(html: string, name: string, from: number): number {
  // `name` is one of RAW_TEXT_TAGS (ASCII letters), so it is safe inside the pattern.
  const endTag = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, "gi");
  endTag.lastIndex = from;
  const match = endTag.exec(html);
  return match ? pastNext(html, ">", match.index) : html.length;
}

/** `html` reduced to the allowlist above: well-formed, every tag closed, text escaped. */
export function sanitizeRichText(html: string): string {
  let out = "";
  const open: string[] = [];
  /** While > 0, everything is dropped: the depth inside `droppedName` elements. */
  let droppedDepth = 0;
  let droppedName = "";

  const emitText = (text: string) => {
    if (droppedDepth === 0 && text) out += escapeText(text);
  };

  const startTag = (tag: Tag) => {
    if (droppedDepth > 0) {
      if (tag.name === droppedName) droppedDepth++;
      return;
    }
    if (DROPPED_CONTAINERS.has(tag.name)) {
      droppedName = tag.name;
      droppedDepth = 1;
      return;
    }
    const name = HEADING_ALIASES[tag.name] ?? tag.name;
    if (!ALLOWED_TAGS.has(name) || open.length >= MAX_DEPTH) return;
    if (VOID_TAGS.has(name)) {
      out += `<${name}>`;
      return;
    }
    if (name === "a") {
      // A link inside a link is not markup a browser keeps; its text joins the outer link.
      if (open.includes("a")) return;
      const href = safeLinkHref(tag.attributes.get("href") ?? "");
      if (href === null) return;
      const target = keepsBlankTarget(tag.attributes.get("target")) ? ' target="_blank"' : "";
      out += `<a href="${escapeAttribute(href)}"${target} rel="${LINK_REL}">`;
    } else {
      out += `<${name}>`;
    }
    open.push(name);
  };

  const endTag = (rawName: string) => {
    if (droppedDepth > 0) {
      if (rawName === droppedName) droppedDepth--;
      return;
    }
    const name = HEADING_ALIASES[rawName] ?? rawName;
    const at = open.lastIndexOf(name);
    if (at === -1) return;
    while (open.length > at) out += `</${open.pop()}>`;
  };

  let pos = 0;
  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) {
      emitText(html.slice(pos));
      break;
    }
    emitText(html.slice(pos, lt));
    const next = html[lt + 1];

    if (html.startsWith("<!--", lt)) {
      pos = pastNext(html, "-->", lt + 4);
    } else if (next === "!" || next === "?") {
      pos = pastNext(html, ">", lt + 2); // doctype, CDATA, processing instruction: dropped
    } else if (next === "/") {
      if (isAsciiLetter(html[lt + 2])) {
        let nameEnd = lt + 2;
        while (nameEnd < html.length && !isSpace(html[nameEnd]) && html[nameEnd] !== "/" && html[nameEnd] !== ">") nameEnd++;
        endTag(html.slice(lt + 2, nameEnd).toLowerCase());
      }
      pos = pastNext(html, ">", lt + 2);
    } else if (isAsciiLetter(next)) {
      const tag = readStartTag(html, lt + 1);
      // Input that ends inside a tag is dropped, as a browser drops it.
      if (tag.end === -1) break;
      pos = tag.end;
      if (droppedDepth === 0 && tag.name === "plaintext") break;
      if (droppedDepth === 0 && RAW_TEXT_TAGS.has(tag.name)) pos = pastRawTextEnd(html, tag.name, pos);
      else startTag(tag);
    } else {
      emitText("<");
      pos = lt + 1;
    }
  }

  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

/**
 * A club description as stored and served: sanitised, and null when nothing visible is left
 * (an empty editor sends "<p></p>").
 */
export function sanitizeClubDescription(description: string | null | undefined): string | null {
  if (description == null) return null;
  const clean = sanitizeRichText(description);
  const visible = clean.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;|&#xa0;/gi, "").trim();
  return visible ? clean : null;
}

/**
 * `sanitize` remembered by a digest of its input, most recently used kept, up to `maxChars` of
 * output in all. Public lists send every club's description, which is sanitised again on read
 * (stored rows may predate sanitising): this does that once per distinct text and process, not once
 * per row per view, so a list of large descriptions cannot cost seconds of CPU on every request
 * (P2REV0-SEC-02). A changed description has a new digest, so nothing is ever served stale.
 */
export function createSanitizedTextCache(
  sanitize: (text: string) => string | null,
  maxChars: number,
): (text: string | null | undefined) => string | null {
  const cache = new Map<string, string | null>();
  let chars = 0;
  return (text) => {
    if (text == null) return null;
    const key = createHash("sha256").update(text).digest("base64url");
    const hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const clean = sanitize(text);
    cache.set(key, clean);
    chars += clean?.length ?? 0;
    while (chars > maxChars) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      chars -= cache.get(oldest)?.length ?? 0;
      cache.delete(oldest);
    }
    return clean;
  };
}
