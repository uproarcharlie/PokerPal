/**
 * The test workers run in a fixed locale (vitest.config.ts), so components that
 * format with the default locale, such as `amount.toLocaleString()`, give the
 * same text on every machine. Run under a German host locale
 * (`LC_ALL=de_DE.UTF-8 npx vitest run --project unit`), this fails without the pin.
 */
import { describe, expect, it } from "vitest";

describe("the test environment", () => {
  it("formats numbers and dates in en-US, whatever the host's locale", () => {
    expect(new Intl.NumberFormat().resolvedOptions().locale).toBe("en-US");
    expect((1200).toLocaleString()).toBe("1,200");
    expect(new Date(Date.UTC(2026, 0, 31, 12)).toLocaleDateString(undefined, { timeZone: "UTC" })).toBe("1/31/2026");
  });
});
