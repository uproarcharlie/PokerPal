import { Banknote, Landmark, MoreHorizontal, Trophy, Undo2, UserPen } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PAYMENT_METHODS, type PaymentMethod } from "@shared/api/registrations";
import type { EntryFixOptions } from "./entry-fixes";

/** Each way of paying as the menu offers it. */
const METHODS: Readonly<Record<PaymentMethod, { label: string; Icon: typeof Banknote }>> = {
  cash: { label: "Cash", Icon: Banknote },
  transfer: { label: "Bank transfer", Icon: Landmark },
};

const isPaymentMethod = (value: string): value is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(value);

/** A menu item's words, and under them why it is greyed out. */
function ItemText({ children, unavailable }: { children: ReactNode; unavailable: string | null }) {
  return (
    <span className="min-w-0">
      <span className="block">{children}</span>
      {unavailable ? <span className="block text-xs text-muted-foreground">{unavailable}</span> : null}
    </span>
  );
}

export interface EntryFixHandlers {
  onNotPaid: () => void;
  onPaidBy: (paidBy: PaymentMethod) => void;
  onHighHand: (entered: boolean) => void;
  onEditPlayer: () => void;
}

interface EntryFixMenuProps extends EntryFixHandlers {
  /** The player's name, for the menu's label and the button's accessible name. */
  name: string;
  registrationId: string;
  triggerTestId: string;
  options: EntryFixOptions;
  /** A correction of this entry is on its way: the menu's changes wait for it. */
  busy: boolean;
  /** A game with no buy-in accepts players rather than taking their money (round 7, item 8). */
  freeTournament: boolean;
}

/**
 * The ⋯ Fix menu on an entry (round 9, item 1), for the club's staff: take a payment back (asked
 * first), change how it was paid, tick or untick the high hand, or edit the player's details. What the
 * game's rules do not allow now is greyed out, saying why.
 */
export function EntryFixMenu({ name, registrationId, triggerTestId, options, busy, freeTournament, onNotPaid, onPaidBy, onHighHand, onEditPlayer }: EntryFixMenuProps) {
  const { notPaid, paidBy, highHand, editPlayer } = options;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 gap-1 px-3 md:h-10" busy={busy} aria-label={`Fix ${name}'s entry`} data-testid={triggerTestId}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          Fix
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]" data-testid={`fix-entry-menu-${registrationId}`}>
        <DropdownMenuLabel className="truncate">Fix {name}&rsquo;s entry</DropdownMenuLabel>
        {notPaid ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11" disabled={busy || notPaid.unavailable !== null} onSelect={onNotPaid} data-testid={`fix-not-paid-${registrationId}`}>
              <Undo2 aria-hidden="true" />
              <ItemText unavailable={notPaid.unavailable}>{freeTournament ? "Mark as not accepted…" : "Mark as not paid…"}</ItemText>
            </DropdownMenuItem>
          </>
        ) : null}
        {paidBy ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">How they paid</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={paidBy.current ?? ""}
              onValueChange={(value) => {
                if (isPaymentMethod(value) && value !== paidBy.current) onPaidBy(value);
              }}
            >
              {PAYMENT_METHODS.map((method) => {
                const { label, Icon } = METHODS[method];
                return (
                  <DropdownMenuRadioItem key={method} value={method} className="min-h-11" disabled={busy} data-testid={`fix-paid-by-${method}-${registrationId}`}>
                    <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                    {label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        {highHand ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              className="min-h-11"
              checked={highHand.entered}
              disabled={busy || highHand.unavailable !== null}
              onCheckedChange={(checked) => onHighHand(checked)}
              data-testid={`fix-high-hand-${registrationId}`}
            >
              <Trophy className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
              <ItemText unavailable={highHand.unavailable}>High hand entered</ItemText>
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" disabled={editPlayer.unavailable !== null} onSelect={onEditPlayer} data-testid={`fix-edit-player-${registrationId}`}>
          <UserPen aria-hidden="true" />
          <ItemText unavailable={editPlayer.unavailable}>Edit player details…</ItemText>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
