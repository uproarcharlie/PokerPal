import { useEffect, useState } from "react";
import type { ClockDisplaySettings } from "@shared/api/clock";
import { carriedInNote, type LiveDisplayDto } from "@shared/api/live-display";
import { formatMoney, ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LINE, px, type MoneyPlan, type MoneyText } from "./screen-plan";

/**
 * How long the TV shows each group of places when they do not all fit beside the clock (the owner:
 * "make the prize pool scroll down … it only shows the top 5"): it then moves on to the next places,
 * and after the last group back to 1st.
 */
export const PAYOUT_PAGE_MS = 7000;

/** The places to show now: every place when they fit, else the `page`th group of `perPage` (wrapping round). */
export function payoutPage<T>(payouts: readonly T[], perPage: number, page: number): { rows: readonly T[]; pages: number; start: number } {
  if (perPage <= 0 || payouts.length === 0) return { rows: [], pages: 0, start: 0 };
  const pages = Math.ceil(payouts.length / perPage);
  const start = (page % pages) * perPage;
  return { rows: payouts.slice(start, start + perPage), pages, start };
}

type Money = LiveDisplayDto["money"];

/** Said where the pool would be while the TD shows it only once it is locked. */
export const POOL_HIDDEN_NOTE = "The prize pool is shown once it is locked";

/**
 * What the money panel says, for the screen to plan its room: the pool ("est." while it can still
 * change), every place paid (the panel shows the ones that fit, a group at a time) and the money carried in from an earlier game ("Includes $200 carried over
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
    payouts: shown ? (money.payouts ?? []).map((payout) => ({ place: ordinal(payout.position), amount: formatMoney(payout.amountCents) })) : [],
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
 * The prize pool, its places and the money carried in from an earlier game, or that the pool is shown
 * once locked. When the places do not all fit, they are shown as many at a time as fit, moving on to the
 * next group every PAYOUT_PAGE_MS. All amounts are the server's.
 */
export function DisplayMoney({ money, text, plan, className }: DisplayMoneyProps) {
  const pad = `${px(plan.padY)} ${px(plan.padX)}`;
  const [page, setPage] = useState(0);
  const { rows: payouts, pages, start } = payoutPage(text.payouts, plan.payouts, page);
  useEffect(() => {
    if (pages <= 1) return;
    const timer = window.setInterval(() => setPage((current) => current + 1), PAYOUT_PAGE_MS);
    return () => window.clearInterval(timer);
  }, [pages]);
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
            <ol
              key={start}
              role="list"
              aria-label="Payouts"
              className={pages > 1 ? "animate-in fade-in slide-in-from-bottom-4 duration-700 motion-reduce:animate-none" : undefined}
              style={{ fontSize: px(plan.row), lineHeight: LINE.row }}
              data-testid="display-payouts"
            >
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
