import { useId } from "react";
import { ArrowDownToLine, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { useApplyCarryOver, useCarryOvers, useRemoveCarryOver } from "../staff-hooks";

interface CarryOverPanelProps {
  tournament: TournamentDetailDto;
  prizePool: PrizePoolDto;
}

/**
 * Money carried over between tournaments (round 5, item 16), on the TD's money screen: what other
 * tournaments of the club carried over that this pool may take ("$50 from Test Wednesday", Add to this
 * prize pool), and what the pool already holds (Take it out, which frees it for another tournament).
 * Staff only; money can be added while the tournament is open and taken out until it is completed (a
 * cancelled tournament never paid it). Nothing shows when there is nothing to say.
 */
export function CarryOverPanel({ tournament, prizePool }: CarryOverPanelProps) {
  const ids = useId();
  const { toast } = useToast();
  const canAdd = tournament.viewer.canManage && tournament.status !== "completed" && tournament.status !== "cancelled";
  const canTakeOut = tournament.viewer.canManage && tournament.status !== "completed";
  const offers = useCarryOvers(tournament.id, { enabled: canAdd });
  const apply = useApplyCarryOver(tournament.id);
  const remove = useRemoveCarryOver(tournament.id);
  const held = prizePool.breakdown.carriedIn;
  const available = canAdd ? (offers.data?.available ?? []) : [];
  if (held.length === 0 && available.length === 0) return null;

  const busyWith = apply.isPending ? apply.variables : remove.isPending ? remove.variables : null;
  const run = (action: typeof apply, carryOverId: string, title: string) =>
    action.mutate(carryOverId, {
      onSuccess: ({ prizePool: pool }) => toast({ title, description: `The prize pool is now ${formatMoney(pool.breakdown.net)}.` }),
      onError: (error) => toast({ title: "Could not change the prize pool", description: errorMessage(error), variant: "destructive" }),
    });

  return (
    <section aria-labelledby={`${ids}-title`} className="space-y-2 rounded-lg border border-border p-3" data-testid="carry-overs">
      <h3 id={`${ids}-title`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Carried over from other tournaments
      </h3>
      <ul role="list" className="divide-y divide-border">
        {held.map((entry) => (
          <li key={entry.carryOverId} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2" data-testid={`carried-in-${entry.carryOverId}`}>
            <span className="min-w-0 text-sm">
              <span className="block font-medium text-foreground">
                {formatMoney(entry.amountCents)} from {entry.fromName}
              </span>
              <span className="block text-xs text-muted-foreground">In this prize pool</span>
            </span>
            {canTakeOut ? (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                busy={busyWith === entry.carryOverId}
                disabled={busyWith !== null}
                onClick={() => run(remove, entry.carryOverId, `${formatMoney(entry.amountCents)} taken out of the prize pool`)}
                aria-label={`Take the ${formatMoney(entry.amountCents)} from ${entry.fromName} out of the prize pool`}
              >
                <Undo2 aria-hidden="true" />
                Take it out
              </Button>
            ) : null}
          </li>
        ))}
        {available.map((offer) => (
          <li key={offer.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2" data-testid={`carry-over-${offer.id}`}>
            <span className="min-w-0 text-sm">
              <span className="block font-medium text-foreground">
                {formatMoney(offer.amountCents)} from {offer.fromName}
              </span>
              <span className="block text-xs text-muted-foreground">{offer.seasonName ? `Carried over to ${offer.seasonName}` : "Carried over to the next tournament"}</span>
            </span>
            <Button
              type="button"
              className="h-11"
              busy={busyWith === offer.id}
              disabled={busyWith !== null}
              onClick={() => run(apply, offer.id, `${formatMoney(offer.amountCents)} added to the prize pool`)}
              aria-label={`Add the ${formatMoney(offer.amountCents)} from ${offer.fromName} to this prize pool`}
            >
              <ArrowDownToLine aria-hidden="true" />
              Add to this prize pool
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
