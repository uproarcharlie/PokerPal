import { render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { RichTextEditor } from "./rich-text-editor";
import { richTextExtensions } from "./rich-text-extensions";

/**
 * Which links a club description may hold, pinned to what the editor did on
 * tiptap 3.6 (before the security upgrade to 3.32, which on its own starts
 * accepting scheme-less "host/path" links that are saved as broken relative
 * hrefs). Each row: what an owner enters, whether it becomes a link, and the
 * href tiptap gives it when the same text is typed and auto-linked (null: not auto-linked).
 */
const LINKS: ReadonlyArray<[href: string, linked: boolean, autolinked: string | null]> = [
  ["facebook.com/groups/abc", false, null],
  ["instagram.com/club", false, null],
  ["www.facebook.com/groups/abc", false, null],
  ["example.org/page", false, null],
  ["lovepoker.club/club/x", false, null],
  ["bit.ly/abc123", false, null],
  ["example.com/", false, null],
  ["javascript:alert(1)", false, null],
  ["JavaScript:alert(1)", false, null],
  ["data:text/html,x", false, null],
  ["localhost:3000", false, null],
  ["https://facebook.com/groups/abc", true, "https://facebook.com/groups/abc"],
  ["http://example.org", true, "http://example.org"],
  [" https://a.com", true, "https://a.com"],
  ["example.org", true, "http://example.org"],
  ["www.example.com", true, "http://www.example.com"],
  ["foo-bar.com/x", true, "http://foo-bar.com/x"],
  ["mailto:a@b.c", true, "mailto:a@b.c"],
  ["tel:+441234", true, null],
  ["/relative", true, null],
  ["#anchor", true, null],
  ["//host.com/x", true, null],
  ["1.2.3.4/x", true, null],
  ["x-y:z", true, null],
];

const editors: Editor[] = [];
function editor(content: string): Editor {
  const created = new Editor({ extensions: richTextExtensions(""), content });
  editors.push(created);
  return created;
}

const hrefs = (html: string) =>
  Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("a"), (link) => link.getAttribute("href"));

afterEach(() => {
  for (const created of editors.splice(0)) created.destroy();
});

describe("the rich text editor's links", () => {
  it.each(LINKS)("%j from the link button: linked %s", (href, linked) => {
    const owner = editor("<p>Hello world</p>");
    owner.commands.setTextSelection({ from: 1, to: 6 });

    expect(owner.chain().focus().setLink({ href }).run()).toBe(linked);
    expect(hrefs(owner.getHTML())).toEqual(linked ? [href] : []);
  });

  it.each(LINKS)("%j in saved content: kept as a link %s", (href, linked) => {
    const saved = editor(`<p><a href="${href}">x</a></p>`);

    expect(hrefs(saved.getHTML())).toEqual(linked ? [href] : []);
  });

  it.each(LINKS.map(([href, , autolinked]) => [href, autolinked] as const))("%j typed into the text: auto-linked as %j", (href, autolinked) => {
    const typed = editor("<p></p>");

    typed.view.dispatch(typed.state.tr.insertText(`${href.trim()} `, 1));

    expect(hrefs(typed.getHTML())).toEqual(autolinked === null ? [] : [autolinked]);
  });

  it("styles a link and opens it in a new tab, as before", () => {
    const owner = editor("<p>Hello world</p>");
    owner.commands.setTextSelection({ from: 1, to: 6 });
    owner.chain().focus().setLink({ href: "https://facebook.com/groups/abc" }).run();

    expect(owner.getHTML()).toBe(
      '<p><a target="_blank" rel="noopener noreferrer nofollow" class="text-primary underline" href="https://facebook.com/groups/abc">Hello</a> world</p>',
    );
  });

  it("are what RichTextEditor shows for a saved description", () => {
    render(
      <RichTextEditor
        content={'<p><a href="facebook.com/groups/abc">Facebook</a> and <a href="https://instagram.com/club">Instagram</a></p>'}
        onChange={() => {}}
      />,
    );

    const description = screen.getByRole("textbox");
    expect(description).toHaveTextContent("Facebook and Instagram");
    expect(Array.from(description.querySelectorAll("a"), (link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Instagram", "https://instagram.com/club"],
    ]);
  });
});
