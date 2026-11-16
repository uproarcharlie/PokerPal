import type { ClockDisplaySettings } from "@shared/api/clock";
import { carriedInNote, type LiveDisplayDto } from "@shared/api/live-display";
import { formatMoney, ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LINE, px, type MoneyPlan, type MoneyText } from "./screen-plan";

/** How many places the TV lists beside the clock (the payouts overlay lists them all). */
export const PAYOUTS_SHOWN = 5;

type Money = LiveDisplayDto["money"];

/** Said where the pool would be while the TD shows it only once it is locked. */
export const POOL_HIDDEN_NOTE = "The prize pool is shown once it is locked";

/**
 * What the money panel says, for the screen to plan its room: the pool ("est." while it can still
 * change), the top places and the money carried in from an earlier game ("Includes $200 carried over
 * from Week 3"), or that the pool is shown once locked; null when there is nothing to say. The places
 * listed add up to the pool (round 7: places with no player in it are not paid, and what they would pay
 * is the club's, which the TV never says). Never what the club takes (round 6): the server sends the
 * TV none of it.
 */
export function moneyText(money: Money, showPrizePool: ClockDisplaySettings["showPrizePool"] | null): MoneyText | null {
  const hiddenUntilLocked = !money.show && showPrizePool !== "never";
  const shown = money.show && money.netCents !== null;
  if (!shown && !hiddenUntilLocked) return null;
  return {
    pool: shown ? { label: money.estimated ? "Prize pool est." : "Prize pool", amount: formatMoney(money.netCents ?? 0) } : null,
    payouts: shown ? (money.payouts ?? []).slice(0, PAYOUTS_SHOWN).map((payout) => ({ place: ordinal(payout.position), amount: formatMoney(payout.amountCents) })) : [],
    carried: shown ? carriedInNote(money.carriedIn ?? []) : null,
    note: hiddenUntilLocked ? POOL_HIDDEN_NOTE : null,
  };
}


interface DisplayMoneyProps {
  money: Money;
  text: MoneyText;
  /** The screen plan's money: what fits, and the sizes. */
  plan: MoneyPlan;
  className?: string;
}

/**
 * The prize pool, the top places that fit and the money carried in from an earlier game, or that the
 * pool is shown once locked. All amounts are the server's.
 */
export function DisplayMoney({ money, text, plan, className }: DisplayMoneyProps) {
  const pad = `${px(plan.padY)} ${px(plan.padX)}`;
  const payouts = text.payouts.slice(0, plan.payouts);
  return (
    <section aria-label="Prize pool" className={cn("flex min-w-0 flex-col", className)} style={{ gap: px(plan.gap) }} data-testid="display-money">
      {plan.pool && text.pool ? (
        <div className="rounded-lg border border-border bg-card/60" style={{ padding: pad }}>
          <p className="flex items-center gap-2 truncate font-bold uppercase tracking-wider text-muted-foreground" style={{ fontSize: px(plan.label), lineHeight: LINE.label }}>
            Prize pool
            {money.estimated ? <span className="rounded border border-border px-1.5 text-[0.8em] normal-case tracking-normal">est.</span> : null}
          </p>
          <p className="truncate font-extrabold tabular-nums text-accent-text" style={{ fontSize: px(plan.amount), lineHeight: 1.1 }}>
            {text.pool.amount}
          </p>
          {payouts.length > 0 ? (
            <ol role="list" aria-label="Payouts" style={{ fontSize: px(plan.row), lineHeight: LINE.row }}>
              {payouts.map((payout) => (
                <li key={payout.place} className="flex justify-between gap-4 tabular-nums">
                  <span className="font-semibold text-muted-foreground">{payout.place}</span>
                  <span className="font-bold text-foreground">{payout.amount}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {plan.carried && text.carried ? (
            <p className="line-clamp-2 font-semibold text-muted-foreground" style={{ fontSize: px(plan.small), lineHeight: LINE.row }} data-testid="display-carried-in">
              {text.carried}
            </p>
          ) : null}
        </div>
      ) : plan.note && text.note ? (
        <p className="line-clamp-3 rounded-lg border border-dashed border-border font-semibold text-muted-foreground" style={{ fontSize: px(plan.small), lineHeight: LINE.row, padding: pad }}>
          {text.note}
        </p>
      ) : null}
    </section>
  );
}
