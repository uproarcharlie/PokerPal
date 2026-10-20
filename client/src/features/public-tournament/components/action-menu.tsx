import type { ReactNode } from "react";
import { RefreshCw, ShoppingCart, Skull } from "lucide-react";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { offersAddons, offersRebuys, PRIZE_POOL_LOCKED_MESSAGE, type PlayerActionType } from "@shared/domain/player-actions";
import { MoneyText } from "@/components/shared/money-text";
import { Button } from "@/components/ui/button";

function ActionTile({ icon, title, detail, disabled, onClick }: { icon: ReactNode; title: string; detail: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" className="flex h-auto w-full flex-col items-center gap-2 whitespace-normal py-6" disabled={disabled} onClick={onClick}>
      {icon}
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{detail}</span>
      </span>
    </Button>
  );
}

interface ActionMenuProps {
  tournament: TournamentDetailDto;
  onChoose: (actionType: PlayerActionType) => void;
}

/**
 * What a player can ask the TD for from their phone. Re-buys and add-ons are offered when the
 * tournament sells them, and shown closed once the pool is locked, as the server would refuse them (PUB-14).
 */
export function ActionMenu({ tournament, onChoose }: ActionMenuProps) {
  const locked = tournament.prizePoolLocked === true;
  const rebuys = offersRebuys(tournament);
  const addons = offersAddons(tournament);
  return (
    <div className="space-y-3">
      {rebuys ? (
        <ActionTile
          icon={<RefreshCw className="h-8 w-8" aria-hidden="true" />}
          title="Re-buy"
          detail={<MoneyText amount={tournament.rebuyAmount} forceCents />}
          disabled={locked}
          onClick={() => onChoose("rebuy")}
        />
      ) : null}
      {addons ? (
        <ActionTile
          icon={<ShoppingCart className="h-8 w-8" aria-hidden="true" />}
          title="Add-on"
          detail={<MoneyText amount={tournament.addonAmount} forceCents />}
          disabled={locked}
          onClick={() => onChoose("addon")}
        />
      ) : null}
      {locked && (rebuys || addons) ? (
        <p className="text-center text-sm text-muted-foreground" data-testid="requests-locked">
          {PRIZE_POOL_LOCKED_MESSAGE}
        </p>
      ) : null}
      <ActionTile
        icon={<Skull className="h-8 w-8" aria-hidden="true" />}
        title="Register Knockout"
        detail="Record an elimination"
        onClick={() => onChoose("knockout")}
      />
    </div>
  );
}
