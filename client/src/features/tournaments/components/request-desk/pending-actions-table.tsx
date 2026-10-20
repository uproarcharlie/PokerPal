import { Check, RefreshCw, ShoppingCart, Skull, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/shared/money-text";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { formatTime } from "@/lib/format";
import type { PendingActionDto } from "@shared/api/pending-actions";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isPlayerActionType, PLAYER_ACTION_LABELS, type PlayerActionType } from "@shared/domain/player-actions";
import { playerName } from "../../player-name";

const ICONS: Readonly<Record<PlayerActionType, LucideIcon>> = { rebuy: RefreshCw, addon: ShoppingCart, knockout: Skull };

/** "Re-buy", "Add-on", "Knockout"; an action type from before Phase 2 as it was stored. */
function actionLabel(actionType: string): string {
  const label = isPlayerActionType(actionType) ? PLAYER_ACTION_LABELS[actionType] : actionType;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ActionName({ actionType }: { actionType: string }) {
  const Icon = isPlayerActionType(actionType) ? ICONS[actionType] : null;
  return (
    <span className="flex items-center gap-2 font-medium">
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {actionLabel(actionType)}
    </span>
  );
}

interface PendingActionsTableProps {
  actions: readonly PendingActionDto[];
  tournament: Pick<TournamentDetailDto, "rebuyAmount" | "addonAmount">;
  timeZone: string;
  /** Why the server last refused each request, shown beside it until it is confirmed or dismissed. */
  refusals: Readonly<Record<string, string>>;
  /** The requests being confirmed or dismissed: only their own buttons wait for the server. */
  busyIds: ReadonlySet<string>;
  onConfirm: (actionId: string) => void;
  onDismiss: (actionId: string) => void;
}

/** The requests players sent from their phones, each with Confirm (apply it, once) and Dismiss. */
export function PendingActionsTable({ actions, tournament, timeZone, refusals, busyIds, onConfirm, onDismiss }: PendingActionsTableProps) {
  const priceOf = (action: PendingActionDto) =>
    action.actionType === "rebuy" ? tournament.rebuyAmount : action.actionType === "addon" ? tournament.addonAmount : null;

  const columns: ResponsiveColumn<PendingActionDto>[] = [
    { id: "action", header: "Action", phone: "title", cell: (action) => <ActionName actionType={action.actionType} /> },
    {
      id: "time",
      header: "Time",
      className: "text-sm text-muted-foreground",
      cell: (action) => (action.timestamp ? formatTime(action.timestamp, timeZone) : "-"),
    },
    {
      id: "player",
      header: "Player",
      cell: (action) => (
        <div>
          <p className="font-medium">{playerName(action)}</p>
          {action.actionType === "knockout" && action.targetPlayer ? <p className="text-xs text-muted-foreground">Knockout by</p> : null}
        </div>
      ),
    },
    {
      id: "details",
      header: "Details",
      className: "text-sm",
      cell: (action) =>
        action.actionType === "knockout" && action.targetPlayer ? (
          <div>
            <p className="font-medium text-destructive">{action.targetPlayer.name}</p>
            <p className="text-xs text-muted-foreground">Knocked out</p>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: "amount",
      header: "Amount",
      cell: (action) => {
        const price = priceOf(action);
        return price ? <MoneyText amount={price} forceCents className="font-semibold" /> : null;
      },
    },
    {
      id: "decide",
      header: "Decision",
      className: "text-right",
      // On a phone the buttons close the card in their own row, never squeezed beside a label (MA-REV-01).
      phone: "actions",
      cell: (action) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={() => onConfirm(action.id)} busy={busyIds.has(action.id)}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Confirm
            </Button>
            <Button variant="outline" onClick={() => onDismiss(action.id)} busy={busyIds.has(action.id)} data-testid={`dismiss-action-${action.id}`}>
              <X className="h-4 w-4" aria-hidden="true" />
              Dismiss
            </Button>
          </div>
          {refusals[action.id] ? (
            <p className="text-xs text-destructive" role="alert" data-testid={`refusal-${action.id}`}>
              {refusals[action.id]}
            </p>
          ) : null}
        </div>
      ),
    },
  ];

  return <ResponsiveTable rows={actions} columns={columns} rowKey={(action) => action.id} caption="Player requests waiting" />;
}
