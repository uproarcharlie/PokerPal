import { describe, expect, it } from "vitest";
import { sanitizeRichText as serverSanitize } from "../../../server/services/sanitize-html";
import { richTextExcerpt, richTextToPlain, sanitizeRichText } from "./rich-text";

describe("sanitizeRichText", () => {
  it("keeps the editor's formatting", () => {
    const html = "<h2>Welcome</h2><p>Play <strong>Fridays</strong>, <em>7pm</em>.</p><ul><li>One</li></ul><blockquote>Hi</blockquote>";

    expect(sanitizeRichText(html)).toBe(html);
  });

  it("drops scripts, event handlers, styles and embedded documents with their content", () => {
    const html =
      '<p onclick="steal()" style="color:red">Hi<script>alert(1)</script></p><img src=x onerror="alert(1)"><iframe src="https://evil.test"></iframe><svg><a href="https://x.test">x</a></svg><style>p{}</style>';

    expect(sanitizeRichText(html)).toBe("<p>Hi</p>");
  });

  it("keeps http(s) and mailto links, forcing rel, and drops any other link, keeping its text", () => {
    const html =
      '<a href="https://club.test/x" target="_blank" class="c">site</a><a href="javascript:alert(1)">bad</a><a href="/relative">rel</a><a href="mailto:td@club.test">mail</a>';

    expect(sanitizeRichText(html)).toBe(
      '<a href="https://club.test/x" target="_blank" rel="noopener noreferrer nofollow">site</a>badrel<a href="mailto:td@club.test" rel="noopener noreferrer nofollow">mail</a>',
    );
  });

  it("unwraps unknown tags, keeping their text escaped, and maps other headings", () => {
    expect(sanitizeRichText("<div><span>a &lt;b&gt;</span></div><h1>T</h1><h5>s</h5>")).toBe("a &lt;b&gt;<h2>T</h2><h3>s</h3>");
  });
});

describe("richTextToPlain and richTextExcerpt", () => {
  it("separates blocks with spaces and ignores scripts", () => {
    expect(richTextToPlain("<p>Weekly game</p><p>All welcome<script>x()</script></p>")).toBe("Weekly game All welcome");
  });

  it("cuts long text at a word, never inside markup", () => {
    const html = `<p>${"word ".repeat(40)}</p>`;

    const excerpt = richTextExcerpt(html, 30);

    expect(excerpt).toBe("word word word word word word…");
    expect(richTextExcerpt("<p>Short</p>", 30)).toBe("Short");
  });
});

/** Markup as a browser reads it, attributes in name order: two sanitisers agree when this is equal. */
function canonical(html: string): string {
  const write = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return JSON.stringify(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    const attributes = Array.from(element.attributes)
      .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
      .sort()
      .join(" ");
    return `<${element.localName} ${attributes}>${Array.from(element.childNodes).map(write).join("")}</>`;
  };
  return Array.from(new DOMParser().parseFromString(html, "text/html").body.childNodes).map(write).join("");
}

// They parse differently (a browser re-opens misnested formatting in the next block; the server's
// tokenizer does not), so the inputs are well nested: what is compared is the policy, not the parser.
describe("the client's sanitiser and the server's keep exactly the same (P2REV4-11)", () => {
  it.each([
    "<h2>Welcome</h2><p>Play <strong>Fridays</strong>, <em>7pm</em>.</p><ul><li>One</li></ul><blockquote>Hi</blockquote>",
    '<p onclick="steal()">Hi<script>alert(1)</script></p><img src=x onerror="alert(1)"><iframe src="https://evil.test"></iframe><svg><a href="https://x.test">x</a></svg>',
    '<a href="https://club.test/x" target="_blank">site</a><a href="javascript:alert(1)">bad</a><a href="/relative">rel</a><a href="mailto:td@club.test">mail</a>',
    '<a href="https://club.test/a" target=" _BLANK ">shouting</a><a href="https://club.test/b" target="_self">self</a>',
    `<a href="https://club.test/${"x".repeat(2100)}">too long</a><a href="java&#115;cript:alert(1)">encoded</a>`,
    "<div><span>a &lt;b&gt; &amp; c</span></div><h1>T</h1><h5>s</h5><embed src=x><object><p>gone</p></object>",
    "<ol><li><strong>bold <em>both</em></strong></li></ol><p>next<br>line</p>",
  ])("for %s", (html) => {
    expect(canonical(sanitizeRichText(html))).toBe(canonical(serverSanitize(html)));
  });
});
