/**
 * A New Zealand bank account number as people write it: bank (2 digits), branch (4), account (7) and
 * suffix (2 or 3), e.g. 12-3456-7890123-00 or 12-3456-7890123-001. The Payments tab lays the digits
 * out as they are typed, so a phone's number pad (which has no dash) gives the written form.
 */

/** Digits in each part, the suffix at its longest. */
const PARTS = [2, 4, 7, 3] as const;
const MAX_DIGITS = PARTS.reduce((sum, part) => sum + part, 0);

/**
 * What was typed (or pasted), laid out with a dash before each part as it starts: "1234" → "12-34",
 * "12 3456 7890123 00" → "12-3456-7890123-00". Anything but digits is dropped, and digits past the
 * longest number (16) are ignored.
 */
export function formatBankAccountInput(typed: string): string {
  const digits = typed.replace(/\D/g, "").slice(0, MAX_DIGITS);
  const parts: string[] = [];
  let at = 0;
  for (const length of PARTS) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + length));
    at += length;
  }
  return parts.join("-");
}
