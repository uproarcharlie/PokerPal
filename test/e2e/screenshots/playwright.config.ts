/**
 * Screenshots of the main pages for a visual review, at a phone's and a laptop's size, against the
 * same production build and fresh `<test database>_e2e` database the e2e suite uses (filled with
 * test/e2e/support/demo.ts). Not part of `npm run test:e2e`: run it on its own with
 *
 *   TEST_DB_NAME=pokerpal_test_<you> E2E_PORT=<port> SCREENSHOTS_DIR=<folder> NODE_ENV=test \
 *     npx playwright test -c test/e2e/screenshots/playwright.config.ts
 *
 * The PNGs land in SCREENSHOTS_DIR (default tmp/screenshots), named <page>-<width>x<height>.png.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("playwright.config.ts starts one web server");

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "capture.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // The server command runs from the repo root, as it does for the main suite.
  webServer: { ...server, cwd: REPO_ROOT },
});
