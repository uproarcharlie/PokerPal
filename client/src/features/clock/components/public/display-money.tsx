import type { ClockDisplaySettings } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import type { Cents } from "@shared/domain/money";
import { formatMoney, ordinal } from "@/lib/format";
import { undistributedNote } from "@/lib/prize-pool";
import { cn } from "@/lib/utils";
import { LINE, px, type MoneyPlan, type MoneyText } from "./screen-plan";

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

/** Said where the pool would be while the TD shows it only once it is locked. */
export const POOL_HIDDEN_NOTE = "The prize pool is shown once it is locked";

/**
 * What the money panel says, for the screen to plan its room: the pool ("est." while it can still
 * change), the top places, the pool's breakdown (what was carried in, what the club keeps, what is
 * carried over, what the club adds), the club's take under its own name ("AP") or what the club adds
 * to a guaranteed pool, and what of the pool no place pays yet; null when there is nothing to say.
 */
export function moneyText(money: Money, entrants: number, showPrizePool: ClockDisplaySettings["showPrizePool"] | null): MoneyText | null {
  const hiddenUntilLocked = !money.show && showPrizePool !== "never";
  const shown = money.show && money.netCents !== null;
  const ap = money.apCents !== null ? { label: money.clubAddedCents !== null ? "Added by the club" : money.rakeLabel, amount: formatMoney(money.clubAddedCents ?? money.apCents) } : null;
  if (!shown && !hiddenUntilLocked && !ap) return null;
  return {
    pool: shown ? { label: money.estimated ? "Prize pool est." : "Prize pool", amount: formatMoney(money.netCents ?? 0) } : null,
    payouts: shown ? (money.payouts ?? []).slice(0, PAYOUTS_SHOWN).map((payout) => ({ place: ordinal(payout.position), amount: formatMoney(payout.amountCents) })) : [],
    lines: shown ? (money.lines ?? []).map((line) => ({ label: line.label, amount: formatMoney(line.cents) })) : [],
    ap,
    note: shown ? unpaidNote(money, entrants) : hiddenUntilLocked ? POOL_HIDDEN_NOTE : null,
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
 * The prize pool, the top places that fit, the pool's breakdown (and what of the pool no place is paid
 * yet), and the club's take under its own name ("AP"), or what the club adds to a guaranteed pool, when
 * the TD chose to show it. All amounts are the server's.
 */
export function DisplayMoney({ money, text, plan, className }: DisplayMoneyProps) {
  const pad = `${px(plan.padY)} ${px(plan.padX)}`;
  const payouts = text.payouts.slice(0, plan.payouts);
  const lines = text.lines.slice(0, plan.lines);
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
          {lines.length > 0 ? (
            <ul role="list" aria-label="Prize pool breakdown" style={{ fontSize: px(plan.small), lineHeight: LINE.row }} data-testid="display-pool-lines">
              {lines.map((line, index) => (
                <li key={`${index}-${line.label}`} className="flex justify-between gap-4 tabular-nums">
                  <span className="min-w-0 truncate font-semibold text-muted-foreground">{line.label}</span>
                  <span className="shrink-0 font-bold text-foreground">{line.amount}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {plan.note && text.note ? (
            <p className="line-clamp-3 font-semibold text-muted-foreground" style={{ fontSize: px(plan.small), lineHeight: LINE.row }} data-testid="display-unpaid">
              {text.note}
            </p>
          ) : null}
        </div>
      ) : plan.note && text.note ? (
        <p className="line-clamp-3 rounded-lg border border-dashed border-border font-semibold text-muted-foreground" style={{ fontSize: px(plan.small), lineHeight: LINE.row, padding: pad }}>
          {text.note}
        </p>
      ) : null}
      {plan.ap && text.ap ? (
        // A pool guaranteed above what came in leaves the club no AP: the room is told what the club adds instead.
        <div className="rounded-lg border border-border bg-card/60" style={{ padding: pad }} data-testid="display-ap">
          <p className="truncate font-bold uppercase tracking-wider text-muted-foreground" style={{ fontSize: px(plan.label), lineHeight: LINE.label }}>
            {text.ap.label}
          </p>
          <p className="truncate font-extrabold tabular-nums text-foreground" style={{ fontSize: px(plan.label * (5 / 3)), lineHeight: 1.1 }}>
            {text.ap.amount}
          </p>
        </div>
      ) : null}
    </section>
  );
}
