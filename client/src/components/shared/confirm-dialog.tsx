import { useId, useState, type ReactNode, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api/http";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** The confirm button's words, e.g. "Delete tournament". */
  confirmLabel: string;
  /** Shown on the confirm button while `onConfirm` runs, e.g. "Deleting…". */
  pendingLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for something that cannot be undone. */
  destructive?: boolean;
  /**
   * Words the person must type before the confirm button works (e.g. the club's name), for an action
   * that takes a lot with it.
   */
  confirmText?: string;
  /** Test ids for the dialog and its confirm button, for the e2e specs. */
  contentTestId?: string;
  /** Where focus goes on close when what opened the dialog is gone: the trigger of the menu it was chosen from. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  confirmTestId?: string;
  /** A choice that shapes the action (a checkbox), between the question and the buttons; the caller holds its state. */
  children?: ReactNode;
  /**
   * Runs on confirm. The dialog stays open, its buttons busy (they ignore presses but keep focus, so a
   * refusal leaves the person on the button they pressed), until it settles: it closes when the
   * promise resolves and shows the error's sentence when it rejects (the action can be retried).
   */
  onConfirm: () => Promise<unknown> | void;
}

/** "Are you sure?" before an action that changes or removes something. */
export function ConfirmDialog({ open, onOpenChange, contentTestId, returnFocusTo, ...body }: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent data-testid={contentTestId} returnFocusTo={returnFocusTo}>
        {/* Mounted only while open, so a reopened dialog starts without the last error or typed words. */}
        <ConfirmBody {...body} pending={pending} setPending={setPending} onDone={() => onOpenChange(false)} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConfirmBodyProps = Omit<ConfirmDialogProps, "open" | "onOpenChange" | "contentTestId" | "returnFocusTo"> & {
  pending: boolean;
  setPending: (pending: boolean) => void;
  onDone: () => void;
};

/**
 * What counts as typing the same words: a phone keyboard's curly quotes and dashes (iOS Smart
 * Punctuation turns ' into ’), letter case, compatibility forms and runs of spaces do not matter, so
 * the owner of "O'Malley's" can delete it from an iPhone (MA-11).
 */
export function sameWords(typed: string, expected: string): boolean {
  const plain = (text: string) =>
    text
      .normalize("NFKC")
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4\u0060]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  return plain(typed) === plain(expected);
}

function ConfirmBody({
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  confirmText,
  confirmTestId,
  children,
  onConfirm,
  pending,
  setPending,
  onDone,
}: ConfirmBodyProps) {
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const typedId = useId();
  const typedEnough = confirmText === undefined || sameWords(typed, confirmText);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setPending(false);
      onDone();
    } catch (cause) {
      setPending(false);
      setError(errorMessage(cause));
    }
  };

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild={typeof description !== "string"}>
          {typeof description === "string" ? description : <div>{description}</div>}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {children}
      {confirmText !== undefined ? (
        <div className="space-y-2">
          <Label htmlFor={typedId}>
            Type <span className="font-semibold">{confirmText}</span> to confirm
          </Label>
          <Input
            id={typedId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            readOnly={pending}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <AlertDialogFooter>
        {/* While it runs, Cancel cannot close the dialog (ConfirmDialog ignores the close), and says so. */}
        <AlertDialogCancel aria-disabled={pending || undefined}>{cancelLabel}</AlertDialogCancel>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={() => void confirm()}
          busy={pending}
          disabled={!typedEnough}
          data-testid={confirmTestId}
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
