import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export type CopyStatus = "idle" | "copied" | "failed";

/** The old way, for browsers without the async clipboard (or without permission to use it). */
function copyWithSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/** Copies text to the clipboard and says honestly whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  return copyWithSelection(text);
}

/** `copy(text)` and what happened, back to idle after a moment. */
export function useCopyToClipboard(resetAfterMs = 2000): { status: CopyStatus; copy: (text: string) => Promise<boolean> } {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (text: string) => {
    const copied = await copyText(text);
    setStatus(copied ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), resetAfterMs);
    return copied;
  };
  return { status, copy };
}

/** What a copy that the browser refused says: the link itself, to copy by hand. */
function copyFailedToast(url: string) {
  return { title: "Couldn't copy the link", description: `Select it and copy it yourself: ${url}`, variant: "destructive" as const };
}

/**
 * Copies a link from where a CopyLinkButton cannot stand (a menu item, a card that is a button) and
 * says in a toast what happened: the copy, or the link to copy by hand. The one wording for every
 * copied link (P3REV3-CQ-08). `what` names the link: "Registration" gives "Registration link copied".
 */
export function useCopyLink(): (url: string, what: string) => Promise<boolean> {
  const { toast } = useToast();
  return async (url, what) => {
    const copied = await copyText(url);
    toast(copied ? { title: "Link copied", description: `${what} link copied to the clipboard` } : copyFailedToast(url));
    return copied;
  };
}

interface CopyLinkButtonProps extends Omit<ButtonProps, "onClick" | "children" | "value"> {
  /** What is copied, e.g. absoluteUrl(routes.publicRegister(id)). */
  value: string;
  label?: string;
  copiedLabel?: string;
}

/**
 * Copies a link. It says "Copied" only when the copy worked; when the browser refused, a toast shows the
 * link so it can be copied by hand.
 */
export function CopyLinkButton({ value, label = "Copy link", copiedLabel = "Copied", variant = "outline", ...props }: CopyLinkButtonProps) {
  const { status, copy } = useCopyToClipboard();
  const { toast } = useToast();

  const onClick = async () => {
    if (!(await copy(value))) toast(copyFailedToast(value));
  };

  return (
    <Button type="button" variant={variant} onClick={() => void onClick()} {...props}>
      {status === "copied" ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />}
      <span aria-live="polite">{status === "copied" ? copiedLabel : label}</span>
    </Button>
  );
}
