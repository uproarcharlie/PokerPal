/**
 * The test workers run in a fixed locale (vitest.config.ts), so components that
 * format with the default locale, such as `amount.toLocaleString()`, give the
 * same text on every machine. Run under a German host locale
 * (`LC_ALL=de_DE.UTF-8 npx vitest run --project unit`), this fails without the pin.
 */
import { describe, expect, it } from "vitest";
import config, { WEB_TIMEOUT_MS } from "../../vitest.config";

describe("the test environment", () => {
  it("formats numbers and dates in en-US, whatever the host's locale", () => {
    expect(new Intl.NumberFormat().resolvedOptions().locale).toBe("en-US");
    expect((1200).toLocaleString()).toBe("1,200");
    expect(new Date(Date.UTC(2026, 0, 31, 12)).toLocaleDateString(undefined, { timeZone: "UTC" })).toBe("1/31/2026");
  });
});

describe("the web project's time limits (P3REV3-CQ-07)", () => {
  const [web] = (config.test?.projects ?? []).flatMap((project) =>
    typeof project === "object" && !(project instanceof Promise) && project.test?.name === "web" ? [project.test] : [],
  );

  it("gives a form test that types through a dialog room to finish on a busy machine, not Vitest's 5 s", () => {
    expect(web?.testTimeout).toBe(WEB_TIMEOUT_MS);
    expect(web?.hookTimeout).toBe(WEB_TIMEOUT_MS);
    expect(WEB_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
  });
});
