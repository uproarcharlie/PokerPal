import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Bold, Italic, Link2, List, ListOrdered, Redo, Undo, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { richTextExtensions } from "./rich-text-extensions";

interface RichTextEditorProps {
  /** The rich text the form holds; "" for none. */
  content: string;
  /** The text after each edit, as HTML; "" once it is emptied. */
  onChange: (content: string) => void;
  /** Names the text area for screen readers (the form's visible label says the same). */
  label?: string;
  placeholder?: string;
  className?: string;
}

/** What the editor holds, as the form stores it: an emptied editor is "" (the server stores no description). */
const editorText = (editor: Editor) => (editor.isEmpty ? "" : editor.getHTML());

/**
 * A small rich text editor (bold, italic, lists, links) for club descriptions. tiptap only reads its
 * `content` when the editor is made, so a value that changes from outside (the form filled with the
 * club once it loads, or reset to what the server saved) is put into the editor here; the editor's own
 * edits come back unchanged and are left alone.
 */
export function RichTextEditor({ content, onChange, label = "Description", placeholder = "Start typing...", className }: RichTextEditorProps) {
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });
  // The text the editor and the form last agreed on.
  const synced = useRef(content);

  const extensions = useMemo(() => richTextExtensions(placeholder), [placeholder]);
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: "prose prose-base md:prose-sm max-w-none focus:outline-none min-h-[100px] p-3",
        "aria-label": label,
        "aria-multiline": "true",
      },
    }),
    [label],
  );
  const editor = useEditor({
    extensions,
    content,
    editorProps,
    onUpdate: ({ editor: updated }) => {
      synced.current = editorText(updated);
      report.current(synced.current);
    },
  });

  useEffect(() => {
    if (editor.isDestroyed || content === synced.current) return;
    synced.current = content;
    // Not an edit to undo: the text was replaced from outside.
    editor.chain().setMeta("addToHistory", false).setContent(content, { emitUpdate: false }).run();
  }, [content, editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      link: current.isActive("link"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  const addLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    // The writing area draws the same 2px ring as the form's other fields while it has focus (ProseMirror
    // marks it ProseMirror-focused); the toolbar's buttons have their own (MA-REV-06).
    <div
      className={cn(
        "rounded-md border border-control ring-offset-background has-[.ProseMirror-focused]:ring-2 has-[.ProseMirror-focused]:ring-ring has-[.ProseMirror-focused]:ring-offset-2",
        className,
      )}
      data-testid="rich-text-editor"
    >
      <div role="toolbar" aria-label={`${label} formatting`} className="flex flex-wrap gap-1 border-b border-border bg-muted/30 p-2">
        <ToolButton icon={Bold} label="Bold" pressed={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton icon={Italic} label="Italic" pressed={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton icon={List} label="Bulleted list" pressed={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolButton
          icon={ListOrdered}
          label="Numbered list"
          pressed={state.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolButton icon={Link2} label="Link" pressed={state.link} onClick={addLink} />
        {/* Undo and redo stay together, wrapping as a pair on a narrow screen. */}
        <div className="ml-auto flex gap-1">
          <ToolButton icon={Undo} label="Undo" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()} />
          <ToolButton icon={Redo} label="Redo" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()} />
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** For a toggle: whether it is on where the cursor is. */
  pressed?: boolean;
  disabled?: boolean;
}

function ToolButton({ icon: Icon, label, onClick, pressed, disabled }: ToolButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn("h-10 w-10 p-0", pressed && "bg-accent")}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
