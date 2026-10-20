import { formatAmount, formatMoney, type Cents } from "@/lib/format";
import { cn } from "@/lib/utils";

type MoneyTextProps = { forceCents?: boolean; className?: string } & (
  | { /** Integer cents, from shared/domain or a *Cents DTO field. */ cents: Cents; amount?: never }
  | { /** A decimal column as the API sends it ("50.00"). */ amount: string | number | null | undefined; cents?: never }
);

/** An amount of money, formatted by shared/domain/money and set in tabular figures so columns line up. */
export function MoneyText({ cents, amount, forceCents, className }: MoneyTextProps) {
  const text = cents !== undefined ? formatMoney(cents, { forceCents }) : formatAmount(amount, { forceCents });
  return <span className={cn("tabular-nums", className)}>{text}</span>;
}
