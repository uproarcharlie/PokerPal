/**
 * Links people type in (a club's website and social pages, image URLs). Plain code, so a page that
 * only shows a link does not load zod with shared/api/common.ts. PURE: no runtime imports.
 */

/** The longest link the app stores or renders. */
export const URL_MAX = 2048;

/**
 * `value` when it is an absolute http(s) URL (the rule httpUrlSchema applies on write), else null.
 * For links stored before that rule existed: a club's social links went straight into the column, so
 * a stored row can hold `javascript:` or `data:` (P2REV0-SEC-05). Every response and every page that
 * renders such a link passes it through this.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > URL_MAX || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}
