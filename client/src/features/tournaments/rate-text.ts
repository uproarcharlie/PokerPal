/** How every form shows a stored AP rate: the tournament form, the AP rates sheet and the high-hand editor. */
import { RAKE_TYPES, type RakeType } from "@shared/api/common";
import { centsToDecimalString, isAmountSet, toBasisPoints, toCents, type MoneyInput } from "@shared/domain/money";

/** A stored rate type the forms offer; anything older reads as none. */
export function rakeTypeOf(value: string | null | undefined): RakeType {
  return (RAKE_TYPES as readonly string[]).includes(value ?? "") ? (value as RakeType) : "none";
}

/**
 * A stored rate's amount as every form's box shows it: "10" for 10%, "5.00" for $5, blank for no rate
 * (P4REV4-CQ-03: one rule for the tournament form and the AP rates sheet).
 */
export function rateAmountText(type: RakeType, amount: MoneyInput): string {
  if (type === "none" || !isAmountSet(amount)) return "";
  return type === "percentage" ? String(toBasisPoints(amount) / 100) : centsToDecimalString(toCents(amount));
}
