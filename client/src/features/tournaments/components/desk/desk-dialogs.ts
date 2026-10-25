import { useState } from "react";
import type { DeskDialog } from "./tournament-actions-bar";

/** What a dialog or sheet of the desk takes to open and close: `{...dialogs.propsFor("lock")}`. */
export interface DeskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The one dialog or sheet the TD's page has open, and the way each one opens and closes. */
export interface DeskDialogs {
  /** The one open, or null. */
  current: DeskDialog | null;
  show: (dialog: DeskDialog) => void;
  close: () => void;
  propsFor: (dialog: DeskDialog) => DeskDialogProps;
}

/**
 * The TD's page opens one dialog or sheet at a time: from the header's actions, the More tab, the
 * phone's quick actions or the request badge. `onShow` runs as one opens (the high-hand award fetches
 * the pot afresh). One copy of the open/close wiring for the page, its body and the phone's sheets
 * (R5REV3-CQ-13).
 */
export function useDeskDialogs({ onShow }: { onShow?: (dialog: DeskDialog) => void } = {}): DeskDialogs {
  const [current, setCurrent] = useState<DeskDialog | null>(null);
  const show = (dialog: DeskDialog) => {
    onShow?.(dialog);
    setCurrent(dialog);
  };
  const close = () => setCurrent(null);
  return {
    current,
    show,
    close,
    propsFor: (dialog) => ({ open: current === dialog, onOpenChange: (open) => (open ? show(dialog) : close()) }),
  };
}
