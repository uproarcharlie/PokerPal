/**
 * A tournament's AP (rake) rates: changing them after creation, and describing them. PURE: no runtime
 * imports outside shared/domain.
 *
 * A change is merged over the stored rates one component at a time (buy-in, re-buy, add-on, high
 * hand) and then checked, so a TD can change one rate without resending the others. Every way of
 * changing the rates (PUT /api/tournaments/:id and PUT …/prize-pool/rates) goes through
 * mergeRakeRates.
 */
import { formatMoney, toBasisPoints, toCents, type MoneyInput } from "./money";

/** Each component's type and amount columns. */
export const RAKE_COMPONENTS = [
  { type: "rakeType", amount: "rakeAmount" },
  { type: "rebuyRakeType", amount: "rebuyRakeAmount" },
  { type: "addonRakeType", amount: "addonRakeAmount" },
  { type: "highHandRakeType", amount: "highHandRakeAmount" },
] as const;

export type RakeTypeKey = (typeof RAKE_COMPONENTS)[number]["type"];
export type RakeAmountKey = (typeof RAKE_COMPONENTS)[number]["amount"];

/** Every type and amount key, in component order. */
export const RAKE_RATE_KEYS: ReadonlyArray<RakeTypeKey | RakeAmountKey> = RAKE_COMPONENTS.flatMap(({ type, amount }) => [type, amount]);

/** What each component is called in activity text and labels. */
export const RAKE_COMPONENT_NAMES: Readonly<Record<RakeTypeKey, string>> = {
  rakeType: "buy-ins",
  rebuyRakeType: "re-buys",
  addonRakeType: "add-ons",
  highHandRakeType: "high hand",
};

/** "10%", "$5 per entry" ("$5" when `flat`: the high hand's one-off fee), or "none". */
export function rateText(type: string | null | undefined, amount: MoneyInput, flat = false): string {
  if (type === "percentage") return `${toBasisPoints(amount) / 100}%`;
  if (type === "fixed") return flat ? formatMoney(toCents(amount)) : `${formatMoney(toCents(amount))} per entry`;
  return "none";
}

/**
 * The AP the rates take from the prize pool, as one line: "buy-ins 10% + re-buys $5 per entry" (the
 * high hand is a separate pot, so it is not part of it). Empty when no component takes AP.
 */
export function describeApRates(rates: RakeRates): string {
  return RAKE_COMPONENTS.filter(({ type }) => type !== "highHandRakeType")
    .flatMap(({ type, amount }) =>
      rates[type] === "percentage" || rates[type] === "fixed" ? [`${RAKE_COMPONENT_NAMES[type]} ${rateText(rates[type], rates[amount])}`] : [],
    )
    .join(" + ");
}

/** The stored rates; a `Tournament` row fits as it is. Amounts are decimal(10,2) text. */
export type RakeRates = { [K in RakeTypeKey]?: string | null } & { [K in RakeAmountKey]?: MoneyInput };

/** What a rates change writes: every type and amount, amounts as decimal text or null. */
export type MergedRakeRates = { [K in RakeTypeKey]: string | null } & { [K in RakeAmountKey]: string | null };

export type RakeRatesProblem = { code: "PERCENT_OVER_100" | "AMOUNT_REQUIRED"; field: RakeAmountKey };

export type MergedRakeRatesResult = { ok: true; rates: MergedRakeRates } | ({ ok: false } & RakeRatesProblem);

const ZERO = "0.00";

function amountText(value: MoneyInput): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * Merges `changes` over `stored` and checks the result:
 * - a type of "none" stores amount "0.00", so an amount typed earlier is not kept;
 * - a percentage or fixed rate needs an amount (AMOUNT_REQUIRED), including when the type changes
 *   without a new amount: 10% must not silently become $10 per entry;
 * - a percentage cannot be over 100 (PERCENT_OVER_100).
 * Problems name the amount field, e.g. `rebuyRakeAmount`.
 */
export function mergeRakeRates(stored: RakeRates, changes: RakeRates): MergedRakeRatesResult {
  const merged = {} as MergedRakeRates;
  for (const { type: typeKey, amount: amountKey } of RAKE_COMPONENTS) {
    const storedType = stored[typeKey] ?? null;
    const type = changes[typeKey] ?? storedType;
    const amountChanged = changes[amountKey] !== undefined;
    let amount = amountText(amountChanged ? changes[amountKey] : stored[amountKey]);

    if (type === "none") {
      amount = ZERO;
    } else if (type === "percentage" || type === "fixed") {
      const typeChanged = changes[typeKey] !== undefined && changes[typeKey] !== storedType;
      if (amount === null || (typeChanged && !amountChanged)) {
        return { ok: false, code: "AMOUNT_REQUIRED", field: amountKey };
      }
      if (type === "percentage" && Number(amount) > 100) {
        return { ok: false, code: "PERCENT_OVER_100", field: amountKey };
      }
    }
    merged[typeKey] = type;
    merged[amountKey] = amount;
  }
  return { ok: true, rates: merged };
}
