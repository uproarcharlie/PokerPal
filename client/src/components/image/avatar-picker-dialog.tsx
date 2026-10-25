import type { RefObject } from "react";
import { AVATARS, avatarIdOf, avatarUrl } from "@shared/domain/avatars";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SmartImage } from "./smart-image";

interface AvatarPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The picture now: the avatar it is, if any, shows as the one chosen. */
  value: string | null | undefined;
  /** The chosen avatar's path ("/avatars/shark.svg"); the dialog then closes. */
  onPick: (url: string) => void;
  description?: string;
  /** Where focus goes on close when what opened the dialog is gone. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The built-in avatars (shared/domain/avatars) as a 4 × 4 grid of big, captioned buttons: one tap picks
 * one and closes. The whole screen on a phone. Nothing is uploaded: an avatar is a file the app serves.
 */
export function AvatarPickerDialog({
  open,
  onOpenChange,
  value,
  onPick,
  description = "Tap one to use it as your picture.",
  returnFocusTo,
}: AvatarPickerDialogProps) {
  const current = avatarIdOf(value);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-4 rounded-none border-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-lg sm:border sm:p-6"
        returnFocusTo={returnFocusTo}
      >
        <DialogTitle className="pr-10">Pick an avatar</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <ul role="list" aria-label="Avatars" className="-mx-1 grid min-h-0 grid-cols-4 content-start gap-2 overflow-y-auto px-1 py-1">
          {AVATARS.map(({ id, label }) => {
            const chosen = current === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => {
                    onPick(avatarUrl(id));
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex min-h-[96px] w-full flex-col items-center gap-1 rounded-lg border-2 p-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    chosen ? "border-primary bg-primary/10" : "border-transparent hover:border-border",
                  )}
                  data-testid={`avatar-${id}`}
                >
                  <SmartImage src={avatarUrl(id)} alt="" width={72} height={72} priority className="aspect-square w-full max-w-[72px] rounded-full" />
                  <span className="text-xs font-medium leading-tight text-foreground">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
