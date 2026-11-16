import { Check, Copy } from "lucide-react";
import { useCopyToClipboard } from "@/components/shared/copy-link-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface CopyValueButtonProps {
  value: string;
  /** What is copied, for its name: "account number" gives "Copy account number". */
  what: string;
  testId?: string;
}

/**
 * Copies one of the transfer's details into the player's banking app. It says "Copied" only when the
 * copy worked; when the browser refused, a toast repeats the value to copy by hand. One width for
 * "Copy" and "Copied", so the row never reflows as it changes.
 */
export function CopyValueButton({ value, what, testId }: CopyValueButtonProps) {
  const { status, copy } = useCopyToClipboard();
  const { toast } = useToast();

  const onClick = async () => {
    if (!(await copy(value))) toast({ title: `Couldn't copy the ${what}`, description: `Select it and copy it yourself: ${value}`, variant: "destructive" });
  };

  return (
    <Button type="button" variant="outline" size="sm" className="h-10 min-w-[6rem] shrink-0 px-2.5" onClick={() => void onClick()} aria-label={`Copy ${what}`} data-testid={testId}>
      {status === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      <span aria-live="polite">{status === "copied" ? "Copied" : "Copy"}</span>
    </Button>
  );
}
