import { defineConfig, devices } from "@playwright/test";
import { guardEnv } from "./test/setup/db-guard";
import { e2ePort } from "./test/e2e/server-env";

const PORT = e2ePort(guardEnv());
const baseURL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

/**
 * End-to-end tests against the production build (`node dist/index.js` with
 * NODE_ENV=production), so CSP, static serving, the Secure session cookie and
 * boot migrations are all exercised. test/e2e/start-server.ts starts it on a
 * guarded local database, `<test database>_e2e`, recreated empty on every run,
 * from its own working directory (so uploads stay out of the repo), on E2E_PORT
 * (default 4710), and never with cloud storage (test/e2e/server-env.ts).
 */
export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // What Railway's proxy sends: it terminates TLS, and with trust proxy the app then sees a secure request.
    // Without it, the production session cookie (Secure) is never set over plain http://localhost.
    extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // "Take Photo" gets a synthetic camera instead of a permission prompt.
        permissions: ["camera"],
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
  ],
  webServer: {
    // Builds unless E2E_SKIP_BUILD=1 (CI downloads the build job's dist/ instead).
    command: "NODE_ENV=test npx tsx test/e2e/start-server.ts",
    url: `${baseURL}/api/health`,
    // Always the freshly built server on the e2e database, never something already on the port.
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
  },
});
