import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { formatMoney, formatNumber, ordinal } from "@/lib/format";
import type { FinalizePreviewDto } from "@shared/api/finalize";
import type { Dealable } from "@shared/domain/deal";
import { UNKNOWN_PLAYER } from "../../player-name";

export const PLAN_CHANGED_NOTICE =
  "The results changed since this plan was worked out (for example a late re-buy or an elimination). Check the new payouts and confirm again.";

/** Whether two finishing orders are the same, player for player. */
export function sameOrder(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((id, i) => id === b[i]);
}

/** `order` with the player at `index` swapped with the one `delta` places away (unchanged at either end). */
export function moved(order: readonly string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  const next = [...order];
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

interface FinishOrderListProps {
  order: readonly string[];
  nameOf: ReadonlyMap<string, string>;
  onMove: (index: number, delta: -1 | 1) => void;
  disabled: boolean;
}

/** The end of the list a move button would leave it at: there it says so, but keeps focus. */
/** A thumb's 44 px on a phone; an end of the list says so without leaving the tab order. */
const MOVE_BUTTON = "h-11 w-11 aria-disabled:cursor-not-allowed";

/**
 * An up/down list of players, best first. A button at an end of the list (the first's Up, the last's
 * Down) is aria-disabled, not disabled: moving a player to the top leaves focus on that button, where
 * `disabled` would drop it to the page (MA-REV-03). Each move is said aloud ("Ann moved to 1st").
 */
export function FinishOrderList({ order, nameOf, onMove, disabled }: FinishOrderListProps) {
  const [said, setSaid] = useState("");
  const move = (index: number, delta: -1 | 1, name: string) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    onMove(index, delta);
    setSaid(`${name} moved to ${ordinal(target + 1)}`);
  };
  return (
    <>
      <ol role="list" className="divide-y divide-border rounded-md border border-border" aria-label="Finishing order">
        {order.map((registrationId, index) => {
          const name = nameOf.get(registrationId) ?? UNKNOWN_PLAYER;
          const first = index === 0;
          const last = index === order.length - 1;
          return (
            <li key={registrationId} className="flex items-center gap-3 p-2" data-testid={`finish-order-${index + 1}`}>
              <span className="w-10 text-sm font-semibold text-muted-foreground">{ordinal(index + 1)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={MOVE_BUTTON}
                onClick={() => move(index, -1, name)}
                aria-disabled={first || undefined}
                disabled={disabled}
                aria-label={`Move ${name} up`}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={MOVE_BUTTON}
                onClick={() => move(index, 1, name)}
                aria-disabled={last || undefined}
                disabled={disabled}
                aria-label={`Move ${name} down`}
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ol>
      <p role="status" className="sr-only" data-testid="finish-order-moved">
        {said}
      </p>
    </>
  );
}

/** Why the plan cannot be finalized: for a deal that cannot be paid, what to fix first. */
export function refusalText(plan: Pick<FinalizePreviewDto, "code" | "message" | "dealProblems">): string | undefined {
  return plan.code === "DEAL_INVALID" ? (plan.dealProblems[0]?.message ?? plan.message) : plan.message;
}

/** The preview's warnings (pool not locked, requests that will be discarded, points that change, ...). */
export function PlanWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>
        <ul role="list" className="list-disc space-y-1 pl-4" data-testid="finalize-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/**
 * What finalize will write: every place, prize and points. On a correction each row's points sit
 * beside the points stored before, and the column stays whenever either has points, so points that
 * would go away are never hidden (P2REV1-01). With `deal` (the plan pays one), each player in it shows
 * what their place pays beside what the deal gives them.
 */
export function PlanTable({ plan, deal = null }: { plan: FinalizePreviewDto; deal?: Dealable | null }) {
  if (plan.rows.length === 0) return null;
  const planned = new Map((deal?.players ?? []).map((player) => [player.registrationId, player.plannedCents]));
  const before = new Map((plan.previous?.results ?? []).map((result) => [result.registrationId, result.pointsAwarded]));
  const correcting = plan.previous !== null;
  const showPoints = plan.rows.some((row) => row.pointsAwarded !== null || (before.get(row.registrationId) ?? null) !== null);
  const points = (value: number | null | undefined) => (value === null || value === undefined ? "-" : formatNumber(value));
  return (
    // No height of its own: the dialog scrolls, so a long plan is not a scroller inside a scroller that a
    // keyboard cannot reach (MA-REV-07); a plan too wide for a phone scrolls sideways in a focusable region.
    <ScrollRegion label="Payout plan" className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm" data-testid="finalize-plan">
        <caption className="sr-only">What finalize will pay and score</caption>
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className="px-3 py-2 text-left">Place</th>
            <th scope="col" className="px-3 py-2 text-left">Player</th>
            <th scope="col" className="px-3 py-2 text-right">Prize</th>
            {showPoints ? <th scope="col" className="px-3 py-2 text-right">Points</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {plan.rows.map((row) => (
            <tr key={row.registrationId}>
              <td className="px-3 py-2">{ordinal(row.finalPosition)}</td>
              <td className="px-3 py-2">{row.playerName}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {row.amountCents > 0 ? formatMoney(row.amountCents) : "-"}
                {planned.has(row.registrationId) ? (
                  <span className="block text-xs font-normal text-muted-foreground" data-testid={`plan-deal-${row.registrationId}`}>
                    Deal (place pays {formatMoney(planned.get(row.registrationId) ?? 0)})
                  </span>
                ) : null}
              </td>
              {showPoints ? (
                <td className="px-3 py-2 text-right tabular-nums" data-testid={`plan-points-${row.registrationId}`}>
                  {points(row.pointsAwarded)}
                  {correcting && (before.get(row.registrationId) ?? null) !== row.pointsAwarded ? (
                    <span className="ml-1 text-xs text-muted-foreground">(was {points(before.get(row.registrationId))})</span>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
