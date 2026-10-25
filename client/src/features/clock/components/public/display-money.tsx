import type { ClockDisplaySettings } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import type { Cents } from "@shared/domain/money";
import { formatMoney, ordinal } from "@/lib/format";
import { undistributedNote } from "@/lib/prize-pool";
import { cn } from "@/lib/utils";

/** How many places the TV lists beside the clock (the payouts overlay lists them all). */
export const PAYOUTS_SHOWN = 5;

type Money = LiveDisplayDto["money"];

/**
 * The part of the pool no place is paid while fewer players are in than the structure pays (Top 9 with
 * 8 entries): the places listed are every place finalize would pay, and they add up to the pool less
 * that part (payouts sum exactly to the pool). Zero while the places are not shown, and once paid.
 */
export function unpaidCents(money: Pick<Money, "netCents" | "payouts">): Cents {
  if (money.netCents === null || !money.payouts) return 0;
  return Math.max(0, money.netCents - money.payouts.reduce((sum, payout) => sum + payout.amountCents, 0));
}

/** The admin and public pages' wording for it (lib/prize-pool), for the room: null when every dollar is paid (MONEY-AP-05). */
export function unpaidNote(money: Pick<Money, "netCents" | "payouts">, entrants: number): string | null {
  return undistributedNote({ source: "live", undistributedCents: unpaidCents(money) }, entrants);
}

interface DisplayMoneyProps {
  money: Money;
  /** Players entered: the unpaid part of the pool is said in their number. */
  entrants: number;
  /** The clock's setting, to say when a hidden pool will be shown; null without a clock. */
  showPrizePool: ClockDisplaySettings["showPrizePool"] | null;
  className?: string;
}

/**
 * The prize pool ("est." while it can still change), the top places (and what of the pool no place is
 * paid yet), and the club's take under its own name ("AP"), or what the club adds to a guaranteed
 * pool, when the TD chose to show it. All amounts are the server's.
 */
export function DisplayMoney({ money, entrants, showPrizePool, className }: DisplayMoneyProps) {
  const payouts = money.payouts?.slice(0, PAYOUTS_SHOWN) ?? [];
  const hiddenUntilLocked = !money.show && showPrizePool !== "never";
  const unpaid = unpaidNote(money, entrants);
  if (!money.show && !hiddenUntilLocked && money.apCents === null) return null;

  return (
    <section aria-label="Prize pool" className={cn("space-y-[1vh]", className)} data-testid="display-money">
      {money.show && money.netCents !== null ? (
        <div className="rounded-lg border border-border bg-card/60 px-4 py-[1vh]">
          <p className="flex items-center gap-2 text-[clamp(0.75rem,min(1.3vw,1.9vh),1.25rem)] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
            Prize pool
            {money.estimated ? <span className="rounded border border-border px-1.5 text-[0.8em] normal-case tracking-normal">est.</span> : null}
          </p>
          <p className="text-[clamp(1.6rem,min(4vw,5.4vh),3.75rem)] font-bold leading-tight tabular-nums text-accent-text">{formatMoney(money.netCents)}</p>
          {payouts.length > 0 ? (
            <ol role="list" className="mt-1 space-y-0.5 text-[clamp(1rem,min(1.8vw,2.6vh),1.75rem)] leading-snug" aria-label="Payouts">
              {payouts.map((payout) => (
                <li key={payout.position} className="flex justify-between gap-4 tabular-nums">
                  <span className="text-muted-foreground">{ordinal(payout.position)}</span>
                  <span className="font-semibold text-foreground">{formatMoney(payout.amountCents)}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {unpaid ? (
            <p className="mt-1 text-[clamp(0.8rem,min(1.3vw,1.9vh),1.2rem)] leading-snug text-muted-foreground" data-testid="display-unpaid">
              {unpaid}
            </p>
          ) : null}
        </div>
      ) : hiddenUntilLocked ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-[1vh] text-[clamp(0.9rem,1.5vw,1.4rem)] text-muted-foreground">
          The prize pool is shown once it is locked
        </p>
      ) : null}
      {money.apCents !== null ? (
        // A pool guaranteed above what came in leaves the club no AP: the room is told what the club adds instead.
        <div className="rounded-lg border border-border bg-card/60 px-4 py-[1vh]" data-testid="display-ap">
          <p className="text-[clamp(0.75rem,min(1.3vw,1.9vh),1.25rem)] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
            {money.clubAddedCents !== null ? "Added by the club" : money.rakeLabel}
          </p>
          <p className="text-[clamp(1.2rem,min(2.4vw,3.4vh),2.25rem)] font-bold leading-tight tabular-nums text-foreground">
            {formatMoney(money.clubAddedCents ?? money.apCents)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
