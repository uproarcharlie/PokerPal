import { test as base, expect, type BrowserContext, type BrowserContextOptions } from "@playwright/test";
import { PROXY_HEADERS } from "./api";

export { expect };

/** Opens another person's browser, e.g. a player's phone beside the TD's laptop; closed after the test. */
export type OpenBrowser = (options?: BrowserContextOptions) => Promise<BrowserContext>;

interface Fixtures {
  /** Uncaught exceptions in any page of the test's browsers: the test fails if there are any. */
  uncaughtErrors: string[];
  openBrowser: OpenBrowser;
}

export const test = base.extend<Fixtures>({
  uncaughtErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on("weberror", (error) => errors.push(error.error().message));
      await use(errors);
      expect(errors, "uncaught errors in the app").toEqual([]);
    },
    { auto: true },
  ],

  openBrowser: async ({ browser, baseURL, uncaughtErrors }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (options = {}) => {
      if (!baseURL) throw new Error("playwright.config.ts sets baseURL");
      // A context made here does not get the config's `use` options, so the base URL and proxy header are set again.
      const context = await browser.newContext({
        ...options,
        baseURL,
        extraHTTPHeaders: { ...PROXY_HEADERS, ...options.extraHTTPHeaders },
      });
      context.on("weberror", (error) => uncaughtErrors.push(error.error().message));
      opened.push(context);
      return context;
    });
    await Promise.all(opened.map((context) => context.close()));
  },
});
