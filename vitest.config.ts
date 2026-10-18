import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const fromRoot = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

// Numbers and dates are formatted in the host's locale, which ICU reads from these when a process starts.
// Pinned here, before Vitest starts its workers, so no test result depends on the machine it runs on.
process.env.LC_ALL = "en_US.UTF-8";
process.env.LANG = "en_US.UTF-8";

/**
 * Three projects (`vitest run --project <name>`), all sharing the aliases below:
 * - unit: pure Node tests, no database.
 * - api:  supertest against createApp() on a real, guarded local Postgres;
 *         every test file gets its own clone of the migrated schema.
 * - web:  React components, hooks and client modules in jsdom with Testing Library and MSW.
 * test/unit/test-files.test.ts fails for any test file that no project picks up.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./client/src"),
      "@shared": fromRoot("./shared"),
      "@test": fromRoot("./test"),
    },
  },
  // Tests never read the developer's .env (e.g. a real VITE_GOOGLE_MAPS_API_KEY); test/ has none.
  envDir: fromRoot("./test"),
  test: {
    // Console output (e.g. the API request log) is printed only for failing tests.
    silent: "passed-only",
    coverage: {
      provider: "v8",
      include: ["shared/**", "server/**", "client/src/**"],
      exclude: ["client/src/components/ui/**", "**/*.test.{ts,tsx}", "**/*.d.ts"],
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      // Report-only for now, except the money/domain code, which must stay well covered.
      thresholds: {
        "shared/domain/**": { lines: 95, branches: 90 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["shared/**/*.test.ts", "server/**/*.unit.test.ts", "test/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          environment: "node",
          include: ["test/api/**/*.api.test.ts", "server/**/*.api.test.ts"],
          globalSetup: ["test/setup/global-db.ts"],
          setupFiles: ["test/setup/api.ts"],
          pool: "forks",
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["client/src/**/*.test.{ts,tsx}"],
          setupFiles: ["test/setup/dom.ts"],
        },
      },
    ],
  },
});
