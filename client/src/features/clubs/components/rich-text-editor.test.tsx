import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./rich-text-editor";

// ProseMirror measures the selection to keep it in view while typing; jsdom has no layout to measure.
const noRect = () => new DOMRect(0, 0, 0, 0);
const layout = { rects: Range.prototype.getClientRects, rect: Range.prototype.getBoundingClientRect, at: document.elementFromPoint };
beforeAll(() => {
  Range.prototype.getClientRects = () => Object.assign([noRect()], { item: () => noRect() }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = noRect;
  document.elementFromPoint = () => null;
});
afterAll(() => {
  Range.prototype.getClientRects = layout.rects;
  Range.prototype.getBoundingClientRect = layout.rect;
  document.elementFromPoint = layout.at;
});

/** The editor as a form uses it: the form holds the text, the editor reports each edit. */
function Field({ initial = "", onChange = vi.fn() }: { initial?: string; onChange?: (html: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RichTextEditor
        content={value}
        onChange={(html) => {
          setValue(html);
          onChange(html);
        }}
      />
      <button type="button" onClick={() => setValue("<p>Loaded from the server</p>")}>
        Load
      </button>
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("RichTextEditor", () => {
  it("writes in 16 px text on a phone, so iOS does not zoom the page when it is tapped (MA-07)", () => {
    render(<Field />);

    const classes = screen.getByRole("textbox", { name: "Description" }).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["prose-base", "md:prose-sm"]));
    expect(classes).not.toContain("prose-sm");
  });

  it("rings the writing area while it has focus, as the form's other fields are ringed (MA-REV-06)", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const box = screen.getByTestId("rich-text-editor");
    const area = screen.getByRole("textbox", { name: "Description" });

    // The ring belongs to the box, and is drawn only while the writing area inside it is focused.
    expect(box).toHaveClass("has-[.ProseMirror-focused]:ring-2", "has-[.ProseMirror-focused]:ring-ring");
    expect(area).not.toHaveClass("ProseMirror-focused");
    await user.click(area);
    await waitFor(() => expect(area).toHaveClass("ProseMirror-focused"));
    expect(box.contains(area)).toBe(true);
  });

  it("marks an empty editor for its example text, which index.css draws", () => {
    render(<Field />);

    const firstLine = screen.getByRole("textbox", { name: "Description" }).querySelector("p");
    expect(firstLine).toHaveClass("is-editor-empty");
    expect(firstLine).toHaveAttribute("data-placeholder", "Start typing...");
  });

  it("shows a description that arrives after it was made (CC-02: tiptap reads `content` once)", () => {
    const { rerender } = render(<RichTextEditor content="" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveTextContent("");

    rerender(<RichTextEditor content="<p>Fridays at 7pm</p>" onChange={() => {}} />);

    expect(screen.getByRole("textbox", { name: "Description" })).toHaveTextContent("Fridays at 7pm");
  });

  it("follows a value replaced from outside, without reporting it as an edit", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field initial="<p>Old text</p>" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(screen.getByRole("textbox", { name: "Description" })).toHaveTextContent("Loaded from the server");
    expect(onChange).not.toHaveBeenCalled();
    // Not an edit to undo either.
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("keeps what is typed (its own edits come back unchanged) and reports an emptied editor as no text", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field onChange={onChange} />);
    const editor = screen.getByRole("textbox", { name: "Description" });

    await user.click(editor);
    await user.keyboard("Hi");

    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("<p>Hi</p>"));
    expect(editor).toHaveTextContent("Hi");

    // Select all and delete, as tiptap does it (jsdom cannot run the key handling that does).
    act(() => {
      (editor as HTMLElement & { editor: Editor }).editor.commands.clearContent(true);
    });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(""));
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });

  it("names every toolbar button and says which formats are on", async () => {
    const user = userEvent.setup();
    render(<Field initial="<p>Bold text</p>" />);

    const toolbar = screen.getByRole("toolbar", { name: "Description formatting" });
    for (const name of ["Bold", "Italic", "Bulleted list", "Numbered list", "Link", "Undo", "Redo"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("textbox", { name: "Description" }));
    await user.click(screen.getByRole("button", { name: "Bold" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true"));
  });
});
