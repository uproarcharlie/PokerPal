// @vitest-environment jsdom
// jsdom stands in for the browser that renders the description (dangerouslySetInnerHTML).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSanitizedTextCache, safeLinkHref, sanitizeClubDescription, sanitizeRichText } from "./sanitize-html";

const ALLOWED = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "S", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "A"]);
const REL = 'rel="noopener noreferrer nofollow"';

/** How a browser reads `html` as innerHTML (what the client's dangerouslySetInnerHTML does). */
function parsed(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

/** Every way `html`, once parsed by a browser, holds something outside the allowlist. */
function violations(html: string): string[] {
  const problems: string[] = [];
  for (const element of Array.from(parsed(html).querySelectorAll("*"))) {
    if (!ALLOWED.has(element.tagName)) problems.push(`element ${element.tagName}`);
    for (const { name, value } of Array.from(element.attributes)) {
      const allowed = element.tagName === "A" && (name === "href" || name === "rel" || (name === "target" && value === "_blank"));
      if (!allowed) problems.push(`${element.tagName}[${name}=${value}]`);
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") ?? "";
      if (!/^(https?|mailto):/.test(new URL(href).protocol)) problems.push(`href ${href}`);
      if (element.getAttribute("rel") !== "noopener noreferrer nofollow") problems.push("rel");
    }
  }
  return problems;
}

describe("sanitizeRichText", () => {
  it("keeps what the rich-text editor writes, forcing rel on links", () => {
    const html =
      '<h2>Welcome</h2><p><strong>Weekly</strong> games, <em>all</em> levels. ' +
      '<a target="_blank" rel="noopener noreferrer nofollow" class="text-primary underline" href="https://example.test/info">Info</a></p>' +
      "<ul><li><p>Fridays</p></li></ul><ol><li>One</li></ol><blockquote><p>Quote</p></blockquote><p>a<br>b <u>u</u> <s>s</s> <b>b</b> <i>i</i></p>";

    expect(sanitizeRichText(html)).toBe(
      '<h2>Welcome</h2><p><strong>Weekly</strong> games, <em>all</em> levels. ' +
        `<a href="https://example.test/info" target="_blank" ${REL}>Info</a></p>` +
        "<ul><li><p>Fridays</p></li></ul><ol><li>One</li></ol><blockquote><p>Quote</p></blockquote><p>a<br>b <u>u</u> <s>s</s> <b>b</b> <i>i</i></p>",
    );
  });

  it("drops scripts, styles, frames and their content, and every event handler or style attribute", () => {
    const html =
      '<p onclick="alert(1)" style="color:red">Hi</p><img src=x onerror="alert(1)"><script>alert(2)</script>' +
      '<iframe srcdoc="<script>alert(3)</script>"></iframe><style>p{}</style><svg><script>alert(4)</script><a href="https://x.test">x</a></svg>' +
      "<noscript><p>no</p></noscript><template><p>t</p></template><textarea></p><script>alert(5)</script></textarea>end";

    expect(sanitizeRichText(html)).toBe("<p>Hi</p>end");
  });

  it("drops links that are not http, https or mailto, however they are disguised, and keeps their text", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "jav&#x61;script:alert(1)",
      "jav&#97;script:alert(1)",
      "javascript&colon;alert(1)",
      "java&Tab;script:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "/relative/path",
      "//evil.test/x",
      "#top",
      "",
    ]) {
      expect(sanitizeRichText(`<p><a href="${href.replace(/"/g, "&quot;")}">Click</a></p>`)).toBe("<p>Click</p>");
    }
    expect(sanitizeRichText("<a>No href</a>")).toBe("No href");
  });

  it("emits a link's href in canonical form, so what was checked is what a browser follows", () => {
    expect(safeLinkHref("HTTPS://Example.TEST/a b?x=1&amp;y=2")).toBe("https://example.test/a%20b?x=1&y=2");
    expect(safeLinkHref("mailto:club@example.test")).toBe("mailto:club@example.test");
    expect(sanitizeRichText('<a href="https://x.test/?a=1&amp;b=&quot;2&quot;" target="_self">x</a>')).toBe(
      `<a href="https://x.test/?a=1&amp;b=%222%22" ${REL}>x</a>`,
    );
  });

  it("escapes text, keeps character references, and drops comments, doctypes and unknown tags", () => {
    expect(sanitizeRichText("<p>5 < 6 & 7 > 3 &amp; &nbsp; &#169; &copy;</p>")).toBe("<p>5 &lt; 6 &amp; 7 &gt; 3 &amp; &nbsp; &#169; &copy;</p>");
    expect(sanitizeRichText("<!DOCTYPE html><!-- note --><div><span>Kept</span></div><custom-tag>too</custom-tag><?php x ?>")).toBe("Kepttoo");
    expect(sanitizeRichText("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("closes what it opens, ignores stray closing tags and never nests a link in a link", () => {
    expect(sanitizeRichText("<p><strong>bold</p>after</strong></em>")).toBe("<p><strong>bold</strong></p>after");
    expect(sanitizeRichText('<a href="https://a.test">one <a href="https://b.test">two</a> three')).toBe(
      `<a href="https://a.test/" ${REL}>one two</a> three`,
    );
    expect(sanitizeRichText("<UL><LI>Upper</LI></UL><h1>Big</h1><h5>Small</h5>")).toBe("<ul><li>Upper</li></ul><h2>Big</h2><h3>Small</h3>");
  });

  it("drops a tag the input ends inside, and everything after <plaintext>", () => {
    expect(sanitizeRichText('<p>ok</p><a href="https://x.test')).toBe("<p>ok</p>");
    expect(sanitizeRichText("<p>ok<img src=x onerror=alert(1)")).toBe("<p>ok</p>");
    expect(sanitizeRichText("<p>ok</p><plaintext><script>alert(1)</script>")).toBe("<p>ok</p>");
  });

  it("is safe for any input: a browser parsing the output finds only the allowlist (property)", () => {
    const piece = fc.oneof(
      fc.constantFrom(
        "<", ">", "</", "/>", '"', "'", "=", "&", "&amp;", "&#x61;", "&lt;", " ", "\n", "\t", "\0",
        "<!--", "-->", "--!>", "<!", "<?", "]]>", "<![CDATA[",
        "<p>", "</p>", "<a ", "</a>", "<A HREF=", "<br/>", "<li>", "<ul>", "</ul>", "<h1>", "<strong>",
        "<script>", "</script>", "<script", "</script ", "<style>", "</style>", "<svg>", "</svg>", "<math>",
        "<iframe>", "</iframe>", "<textarea>", "</textarea>", "<title>", "<template>", "</template>",
        "<img ", "<div ", "<plaintext>", "<select>", "<noscript>", "<table>", "<td>", "<form>", "<input ",
        "<object>", "<embed ", "<base ", "<meta ", "<link ", "<math><mi>",
        "href=", "href=\"", "src=", "onerror=", "onclick=\"", "style=", "target=_blank", "srcdoc=",
        "javascript:", "JAVA\tSCRIPT:", "data:text/html,", "https://ok.test/", "mailto:a@b.test", "alert(1)",
      ),
      fc.string({ maxLength: 6 }),
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 40 }), (pieces) => {
        const out = sanitizeRichText(pieces.join(""));
        expect(violations(out)).toEqual([]);
        expect(sanitizeRichText(out)).toBe(out);
      }),
      { numRuns: 3000 },
    );
  });
});

describe("sanitizeClubDescription", () => {
  it("is null when nothing visible is left, e.g. an empty editor or only a script", () => {
    for (const empty of [null, undefined, "", "   ", "<p></p>", "<p><br></p>", "<script>alert(1)</script>", "<p>&nbsp;</p>"]) {
      expect(sanitizeClubDescription(empty)).toBeNull();
    }
    expect(sanitizeClubDescription("<p>Hi</p><script>x</script>")).toBe("<p>Hi</p>");
  });
});

describe("createSanitizedTextCache (P2REV0-SEC-02)", () => {
  function counting() {
    const calls: string[] = [];
    const sanitize = (text: string) => {
      calls.push(text);
      return text === "blank" ? null : `<p>${text}</p>`;
    };
    return { calls, sanitize };
  }

  it("sanitises each distinct text once, however often it is served", () => {
    const { calls, sanitize } = counting();
    const served = createSanitizedTextCache(sanitize, 1_000);

    for (let view = 0; view < 5; view++) {
      expect(served("Friday night poker")).toBe("<p>Friday night poker</p>");
      expect(served("blank")).toBeNull();
    }
    expect(served(null)).toBeNull();
    expect(served(undefined)).toBeNull();

    expect(calls).toEqual(["Friday night poker", "blank"]);
  });

  it("serves a changed text afresh, never what the old one gave", () => {
    const served = createSanitizedTextCache(sanitizeClubDescription, 1_000);

    expect(served("<p>Old</p><script>x()</script>")).toBe("<p>Old</p>");
    expect(served("<p>New</p><img src=x onerror=alert(1)>")).toBe("<p>New</p>");
  });

  it("keeps at most about maxChars of results, forgetting the least recently served first", () => {
    const { calls, sanitize } = counting();
    // Each result is "<p>" + 10 characters + "</p>": 17 characters, so 3 fit in 60.
    const served = createSanitizedTextCache(sanitize, 60);
    const text = (n: number) => `club ${String(n).padStart(5, "0")}`;

    for (const n of [1, 2, 3]) served(text(n));
    served(text(1)); // 1 is now the most recently served
    served(text(4)); // over the budget: 2 goes
    calls.length = 0;

    served(text(1));
    served(text(3));
    served(text(4));
    expect(calls).toEqual([]);
    served(text(2));
    expect(calls).toEqual([text(2)]);
  });
});
