import { useMemo, type HTMLAttributes } from "react";
import { sanitizeRichText } from "@/lib/rich-text";

interface SafeHtmlProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "dangerouslySetInnerHTML"> {
  /** Rich text the server has already sanitised (a club description). */
  html: string;
}

/**
 * Renders staff-written rich text. The server sanitises it on write and on read; it passes through the
 * client's copy of the same allowlist (lib/rich-text, shared/domain/rich-text) once more before it
 * reaches the page, so a server bug alone can never put script on a public page.
 */
export function SafeHtml({ html, ...props }: SafeHtmlProps) {
  const safe = useMemo(() => sanitizeRichText(html), [html]);
  return <div {...props} dangerouslySetInnerHTML={{ __html: safe }} />;
}
