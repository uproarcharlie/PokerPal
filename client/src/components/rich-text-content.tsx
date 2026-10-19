import { useMemo, type HTMLAttributes } from "react";
import { sanitizeRichText } from "@/lib/rich-text";

interface RichTextContentProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "dangerouslySetInnerHTML"> {
  /** Rich text from the API (a club description). Sanitised again here before it is rendered. */
  html: string;
}

/** Renders staff-written rich text through the client allowlist (lib/rich-text). */
export function RichTextContent({ html, ...props }: RichTextContentProps) {
  const safe = useMemo(() => sanitizeRichText(html), [html]);
  return <div {...props} dangerouslySetInnerHTML={{ __html: safe }} />;
}
