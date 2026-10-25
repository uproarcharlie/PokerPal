import type { RefObject } from "react";
import { Banknote, CheckCircle2, Plus, RefreshCw, ShoppingCart, UserPlus, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { offersAddons, offersRebuys } from "@shared/domain/player-actions";
import type { WaitingCount } from "../desk/desk-actions";
import type { DeskDialog } from "../desk/tournament-actions-bar";

/** Clear of the bottom tab bar (56 px and the home indicator), at the right edge: where a thumb rests. */
const ABOVE_TAB_BAR = "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]";

interface QuickActionsProps {
  tournament: Pick<TournamentDetailDto, "rebuyAmount" | "addonAmount">;
  waitingRequests: WaitingCount;
  /** Players in the field whose payment is not confirmed (their money is not in the prize pool yet: round 6); 0 for none. */
  awaitingPayment: number;
  onOpen: (dialog: DeskDialog) => void;
  /** The button: the sheets opened from its menu give focus back to it. */
  triggerRef: RefObject<HTMLButtonElement>;
}

const ITEM = "min-h-12 gap-3 text-base md:min-h-12 [&_svg]:size-5";

/**
 * The phone's quick actions (round5-contracts §8.1): one round button above the tab bar, in thumb
 * reach, opening the night's most used things: register a player, bust one, sell a re-buy or an
 * add-on (when the tournament has them), take a payment (how many have not paid beside it: only paid
 * players are in the pool; under "once they've paid" also the step that seats a late arrival, which sat
 * at the foot of the Money tab: R5REV-HOST-09), and the player requests waiting. Each opens its own sheet.
 */
export function QuickActions({ tournament, waitingRequests, awaitingPayment, onOpen, triggerRef }: QuickActionsProps) {
  const waiting = typeof waitingRequests === "number" ? waitingRequests : 0;
  return (
    // Not modal: an item opens a sheet, which must get the focus and the pointer.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          size="icon"
          className={`fixed right-4 z-30 h-14 w-14 rounded-full shadow-lg [&_svg]:size-6 ${ABOVE_TAB_BAR}`}
          aria-label="Quick actions"
          data-testid="quick-actions"
        >
          <Plus aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-64">
        <DropdownMenuItem className={ITEM} onSelect={() => onOpen("register")} data-testid="quick-register">
          <UserPlus aria-hidden="true" />
          Register player
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={() => onOpen("bust")} data-testid="quick-bust">
          <UserX aria-hidden="true" />
          Bust a player
        </DropdownMenuItem>
        {offersRebuys(tournament) ? (
          <DropdownMenuItem className={ITEM} onSelect={() => onOpen("rebuy")} data-testid="quick-rebuy">
            <RefreshCw aria-hidden="true" />
            Re-buy
          </DropdownMenuItem>
        ) : null}
        {offersAddons(tournament) ? (
          <DropdownMenuItem className={ITEM} onSelect={() => onOpen("addon")} data-testid="quick-addon">
            <ShoppingCart aria-hidden="true" />
            Add-on
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className={ITEM} onSelect={() => onOpen("payments")} data-testid="quick-payments">
          <Banknote aria-hidden="true" />
          Take payment
          {awaitingPayment > 0 ? (
            <Badge variant="destructive" className="ml-auto">
              {awaitingPayment}
              <span className="sr-only"> waiting to pay</span>
            </Badge>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={() => onOpen("requests")} data-testid="quick-requests">
          <CheckCircle2 aria-hidden="true" />
          Approve requests
          {waiting > 0 ? (
            <Badge variant="destructive" className="ml-auto">
              {waiting}
              <span className="sr-only"> waiting</span>
            </Badge>
          ) : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
