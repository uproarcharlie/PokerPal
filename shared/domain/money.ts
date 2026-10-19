/**
 * Money primitives shared by the client and the server. PURE: no imports, no I/O.
 *
 * Exact amounts are integer cents (`Cents`), so sums never drift. Postgres decimal(10,2) columns arrive
 * as strings such as "50.00" and are parsed digit by digit, never through a float.
 */

/** A whole number of cents. */
export type Cents = number;

/** An amount or a percentage as it arrives: pg decimals are strings, client state may hold numbers. */
export type MoneyInput = string | number | null | undefined;

const DECIMAL = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/;
/** More whole digits than this and `whole * 100` could leave the safe-integer range. */
const MAX_WHOLE_DIGITS = 13;

/**
 * The old parse, `parseFloat(value || "0")` (server/routes.ts:847-871 at dddf8ad), except that input
 * parseFloat cannot read gives 0 instead of NaN. toCents falls back on it for a number, or for text
 * that is not a plain decimal, so odd input reads as it always has.
 */
export function parseAmount(value: MoneyInput): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether an optional amount is set. Strings follow today's truthiness rule, so "0.00" is set and ""
 * is not; a blank string counts as not set. A number is set when it is finite.
 */
export function isAmountSet(value: MoneyInput): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return value.trim() !== "";
}

/**
 * Rounds dollars to the nearest cent, halves away from zero. The value is first taken to 6 decimal
 * places, so a float such as 0.505 (stored as 0.50499999…) rounds as the decimal it stands for.
 * Exact below about $9 billion.
 */
export function roundToCents(dollars: number): Cents {
  if (!Number.isFinite(dollars)) return 0;
  const micros = Math.round(Math.abs(dollars) * 1_000_000);
  return withSign(dollars < 0, divideRounded(micros, 10_000));
}

/**
 * Parses an amount to integer cents: "50.00" → 5000, "5" → 500, "12.345" → 1235. Null, blank and
 * unreadable input give 0. Anything the decimal pattern rejects but parseFloat reads ("12abc", "1e3")
 * goes through parseFloat, so this always agrees with `parseAmount` to the cent.
 */
export function toCents(value: MoneyInput): Cents {
  return toHundredths(value);
}

/** Parses a percentage to integer basis points (1 bp = 0.01%): "10.00" → 1000, "2.5" → 250. */
export function toBasisPoints(value: MoneyInput): number {
  return toHundredths(value);
}

/**
 * `basisPoints` of `cents`, to the nearest cent, halves away from zero: 5% of $10.10 is 51 cents.
 * Throws a RangeError unless both are integers whose product is a safe integer.
 */
export function percentOfCents(cents: Cents, basisPoints: number): Cents {
  const product = cents * basisPoints;
  if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(basisPoints) || !Number.isSafeInteger(product)) {
    throw new RangeError(`Cannot take ${basisPoints} bp of ${cents} cents exactly`);
  }
  return withSign(product < 0, divideRounded(Math.abs(product), 10_000));
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

/** The text a decimal(10,2) column stores: 23800 → "238.00", -550 → "-5.50". */
export function centsToDecimalString(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Not a whole number of cents: ${cents}`);
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}

/**
 * Formats cents with the app's "$" and en-US grouping: whole amounts without cents ("$1,475"), others
 * with them ("$237.50"). `forceCents` always shows them.
 */
export function formatMoney(cents: Cents, options: { forceCents?: boolean } = {}): string {
  const value = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(value);
  const digits = options.forceCents === true || abs % 100 !== 0 ? 2 : 0;
  const body = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? "-" : ""}$${body}`;
}

function toHundredths(value: MoneyInput): number {
  if (typeof value === "string") {
    const match = DECIMAL.exec(value);
    if (match) {
      const sign = match[1];
      const whole = match[2];
      const fraction = match[3] ?? "";
      if ((whole !== "" || fraction !== "") && whole.length <= MAX_WHOLE_DIGITS) {
        const roundUp = fraction.length > 2 && fraction.charAt(2) >= "5" ? 1 : 0;
        const units = Number(whole || "0") * 100 + Number(`${fraction}00`.slice(0, 2)) + roundUp;
        return withSign(sign === "-", units);
      }
    }
  }
  return roundToCents(parseAmount(value));
}

/** `numerator / denominator` rounded half up, for a non-negative safe-integer numerator. */
function divideRounded(numerator: number, denominator: number): number {
  // Below 2^53, Math.floor of the float quotient is the exact integer quotient.
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

/** Applies a sign without ever producing -0. */
function withSign(negative: boolean, magnitude: number): number {
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}
