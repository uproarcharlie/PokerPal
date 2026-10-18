# Tests

PokerPal has four kinds of test. All of them run in CI on every push and pull request to `main`.

| Kind | Tool | Where tests live | What they exercise |
|---|---|---|---|
| **unit** | Vitest (node) | `shared/**/*.test.ts`, `server/**/*.unit.test.ts`, `test/unit/**/*.test.ts` | Pure functions. No database, no network. |
| **api** | Vitest (node) + supertest | `test/api/**/*.api.test.ts`, `server/**/*.api.test.ts` | HTTP routes through `createApp()` on a real, local Postgres built by the production migrations. |
| **web** | Vitest (jsdom) + Testing Library + MSW | `client/src/**/*.test.{ts,tsx}` | React components, hooks and client modules in a simulated browser. Network calls are mocked. |
| **e2e** | Playwright (Chromium) | `test/e2e/**/*.spec.ts` | The production build (`node dist/index.js`, `NODE_ENV=production`) in a real browser. |

Vitest silently skips a file that matches none of these patterns, so `test/unit/test-files.test.ts` fails for any test file outside them (for example `server/services/x.test.ts`, which is neither `.unit` nor `.api`).

Every Vitest worker runs in the `en_US.UTF-8` locale (`vitest.config.ts`), so text formatted with the default locale, such as `amount.toLocaleString()`, is the same on every machine; `test/unit/test-environment.test.ts` checks it.

## Commands

```bash
npm test                 # unit + api + web (vitest run)
npm run test:unit        # one project: --project unit | api | web
npm run test:api
npm run test:web
npm run test:watch       # re-run on change
npm run test:coverage    # all projects, with a v8 coverage report in coverage/
npm run test:e2e         # builds, starts the production server on :4710 (E2E_PORT), runs Playwright
npm run typecheck        # tsc over the app, the tests and the scripts
npm run verify           # typecheck + test + build, i.e. what CI checks
```

Run one file or one test with `npx vitest run test/api/health.api.test.ts` or `npx vitest run -t "reports a healthy"`.

## The test database (api and e2e)

The api and e2e tests need a Postgres server **on this machine**. Every database they create, truncate or drop goes through `test/setup/db-guard.ts`, which refuses to run unless all of these hold:

- the host is `localhost`, `127.0.0.1` or `::1`. The guard parses the connection string with the same parser `pg` uses, so a `?host=` override counts;
- the database name ends in `_test` or `_test_<suffix>`, using only `a-z`, `0-9` and `_`;
- `NODE_ENV` is `test`. Vitest sets it, and the seed scripts set it in their npm script;
- no `RAILWAY_*` variable is set.

It finds the server like this:

1. **`TEST_DATABASE_URL`** if it is set. CI uses this.
2. Otherwise **`DATABASE_URL`**, from the shell or from the repo's `.env` (only the database settings are read from `.env`, never `NODE_ENV` or secrets), with the database name replaced by **`TEST_DB_NAME`**. The default name is `pokerpal_test`.

`TEST_DB_NAME`, when set, always names the database. Use it to keep parallel runs apart, for example `TEST_DB_NAME=pokerpal_test_mybranch npm test`. The e2e run adds `_e2e` to the same name (`pokerpal_test_mybranch_e2e`); give a parallel e2e run its own port with `E2E_PORT` as well.

A run names all its other databases after this one by adding a segment, `_w<n>`, `_template` or `_e2e` (`test/setup/database-names.ts`), and drops them freely. So the guard refuses a name that already has one of those segments: `pokerpal_test_w2`, for instance, is the default run's second worker clone, which that run would drop mid-test. `test/unit/database-names.test.ts` checks that no run's databases can ever be another's.

A run holds its name until it ends (`test/setup/run-lock.ts`, an advisory lock on the server's `postgres` database that Postgres drops with the connection, so a crashed run never leaves it behind). A second run with the same name, for example `npm test` while `npm run test:watch` is open, stops at once with "Another test run is using …" instead of dropping the first run's databases.

With the usual local dev setup (`DATABASE_URL=postgresql://you@localhost:5432/pokerpal`), `npm test` works as-is and never touches the `pokerpal` database.

### No local Postgres? Use Docker

`docker-compose.test.yml` runs a throwaway Postgres 16 on `127.0.0.1:5433`. Its data lives in tmpfs and fsync is off.

```bash
npm run db:test:up
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/pokerpal_test
npm test && npm run test:e2e
npm run db:test:down
```

### How the api tests get their databases

- **Once per run** (`test/setup/global-db.ts`): the guard runs, then `<name>_template` is recreated and built by **the real boot migration runner** (`server/db/migrate.ts` over `migrations/*.sql`). So the tests run against exactly the schema production gets.
- **Per test file** (`test/setup/api.ts`): Vitest runs every file in a fresh process. Each file clones the template into its worker's own database, `<name>_w<VITEST_POOL_ID>`, so files run in parallel without seeing each other. The server's env is pointed at the clone (`NODE_ENV=test`, `SESSION_SECRET=test`, local file storage, a pool of 4).
- **Between tests**: call `resetDb()` in `beforeEach` when tests must not see each other's rows. It truncates every table except `_app_migrations`.
- **Scratch databases**: a test that needs an empty database of its own (the migration runner tests, for example) calls `createScratchDatabase(suffix)` from `test/helpers/scratch-db.ts`. It is named `<worker database>_<suffix>`, so the guard accepts it and no other worker sees it. Drop it with `dropScratchDatabase` when the test ends.
- **At the end**: the clones, any scratch databases left beside them, and the template are dropped. The base `<name>` database itself is never created or touched.

### Schema parity

`test/api/schema-parity.api.test.ts` runs drizzle-kit's `pushSchema` with `shared/schema.ts` against a freshly migrated database and expects nothing to change. The only exceptions are:

- the tables schema.ts deliberately does not model: `session` and `_app_migrations`;
- two constraints on `clubs` that are named differently but defined identically.

If you change `shared/schema.ts`, add a migration that makes the same change, or this test fails.

### The migration runner

`test/api/migrate.api.test.ts` runs the boot runner on scratch databases. It checks that:

- an applied, unchanged file is skipped, so a boot takes no table locks, even with a write transaction open;
- every shipped file can also run a second time without failing or changing any rows (an edited file runs again);
- a database built the old way (drizzle-kit push plus connect-pg-simple's session table) gains only `_app_migrations`;
- a failing file rolls back whole, stays out of the ledger, is named with its line, and leaves no lock behind;
- `-- runner:no-transaction` is honoured, an edited file runs again with a warning, and a dry run creates nothing;
- a UNIQUE index on a table that already exists is refused before anything runs, even after the same file's `CREATE TABLE IF NOT EXISTS` (which creates nothing then), while a file whose first run built the table and index can run again;
- a file cannot switch the runner's timeouts off, and a file stuck behind a table lock gives up after 5s, so the live site's reads flow again;
- a seed INSERT the guard accepts adds its rows once however often its file runs, and conflict columns that are not a unique key fail the boot;
- a boot waits for the migration lock, but gives up after `lockWaitMs` and names the session holding it;
- a database that refuses or never answers connections counts as unreachable, which a boot retries for up to 3 minutes, and so does a connection cut while the runner holds it (for example while it waits for the lock), which must not crash the process;
- an INVALID index (what a `CREATE INDEX CONCURRENTLY` that failed part-way leaves) stops a file that would create an index of that name, which `IF NOT EXISTS` would otherwise skip, until it is dropped;
- the guard refuses an `ADD COLUMN` exactly when Postgres would rewrite the table to add it (a volatile default, serial, identity or generated columns);
- a failed boot's log names `MIGRATE_ON_BOOT=false`, the way to start without migrating.

The guard itself (which statements a migration may contain) is unit-tested in `server/db/migrate.unit.test.ts`.

## Writing api tests

```ts
import { beforeEach, expect, it } from "vitest";
import { createClub, createTournamentScenario } from "../factories";
import { anon, asJson, resetDb, signIn } from "../helpers";

beforeEach(resetDb);

it("lists a tournament's registrations", async () => {
  const { tournament } = await createTournamentScenario({ players: 6, rebuys: { 0: 1 }, eliminations: [5] });

  const response = await (await anon()).get(`/api/tournaments/${tournament.id}/registrations`);

  expect(response.status).toBe(200);
  expect(response.body).toHaveLength(6);
});

it("returns a club exactly as stored", async () => {
  const club = await createClub();
  expect((await (await anon()).get(`/api/clubs/${club.id}`)).body).toEqual(asJson(club));
});

it("lets admins list users", async () => {
  const { agent } = await signIn({ role: "admin" });
  expect((await agent.get("/api/admin/users")).status).toBe(200);
});
```

- **`getApp()`** returns the Express app from `createApp()`, built once per file with the production Postgres session store.
- **`anon()`** returns a supertest client with no session cookie, i.e. an anonymous visitor: `(await anon()).get("/api/clubs")`.
- **`signIn(overrides?)`** creates a factory user (`createUser(overrides)`, e.g. `{ role: "admin" }`) and logs them in. It returns `{ agent, user }` like `loginAs`, and is the fast default, because nothing goes through registration's cost-12 bcrypt hash.
- **`loginAs(role | { email, password? })`** returns `{ agent, user }`. The agent is a supertest agent holding a session cookie.
  - `"full_member"` registers through `POST /api/auth/register`. Use it when the test is about registration; otherwise `signIn()` is faster.
  - `"admin"` registers, gets promoted in the database, then logs in again, because the session caches the role at login.
  - An existing user (e.g. from `createUser()`) logs in with `FACTORY_PASSWORD`.
- **`asJson(row)`** turns a row into what the API sends (Dates become ISO strings), so `expect(response.body).toEqual(asJson(row))` compares like with like.
- **`UNKNOWN_ID`** is a well-formed uuid that no row ever has, for 404 and "unknown id" cases.
- **`testDb()`** returns the drizzle instance on the worker database.
- **Factories** (`test/factories`):
  - `buildX(overrides)` returns a row you can insert; `createX(overrides)` inserts it and returns it.
  - They exist for users, clubs (with a unique slug), seasons, players, points systems and allocations, tournaments and registrations.
  - Money columns take decimal strings (`"50.00"`), as drizzle returns them.
  - Factory users share one bcrypt hash at cost 4, so logging them in is fast.
  - `createTournamentScenario({ players, buyIn, rake, rebuys, addons, paid, eliminations, points, owner, tournament })` builds a full tournament in a given state. It does not finalize it.
- Console output is shown only for failing tests (`silent: "passed-only"`).

### Known bugs: `it.fails`

The api tests characterize today's behaviour, bugs included, so that later refactors can prove they changed nothing by accident. A known bug from the audit is written as the behaviour we want, wrapped in `it.fails`:

```ts
it.fails("refuses an anonymous visitor (SEC-02)", async () => {
  const response = await (await anon()).post(`/api/tournaments/${tournament.id}/finalize`);
  expect(response.status).toBe(401);
});
```

- **Tag it.** Put the audit finding id in the test name, e.g. `(SEC-02)`, or in the name of its `describe` block (`"known bug money-04: …"`), so every open bug can be traced to its finding. `grep -n "it.fails" test/api/*.api.test.ts` lists them all. Where today's exact behaviour matters, a plain `"today: …"` test beside it pins that too.
- **Check why it fails.** Vitest passes an `it.fails` test whenever it throws, for any reason, so a typo or a broken setup step passes just as well as the bug does. When you write one, change it to `it` once and run it: it must fail on the intended assertion (for example "expected 201 to be 401"), not earlier. Then put `.fails` back.
- **When the fix lands**, the test starts failing, because it no longer throws. Switch it to `it`, and delete the `"today: …"` test beside it, if any.

### Rate limits are shared within a file

`getApp()` builds one app per test file, so every test in that file shares the app's in-memory rate limiters:

- the global `/api` limiter: 500 requests per IP per 15 minutes, counting only successful responses;
- `/api/upload/public`: 50 requests per IP per 15 minutes, counting failures too.

A file that would go past either budget, or a test that checks a limit, should build an app of its own so its counters start at zero: `createApp({ env: loadEnv(process.env), sessionStore: new session.MemoryStore() })`, as `auth.api.test.ts` and `uploads.api.test.ts` do.

## Writing component tests

Put `Thing.test.tsx` next to `Thing.tsx` and use Testing Library (`render`, `screen`, `@testing-library/user-event`). The jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, …) are already loaded.

The MSW server **fails any request a test has not mocked**. Add handlers per test; they are reset after each one:

```ts
import { http, HttpResponse } from "msw";
import { server } from "@test/msw/server";

server.use(http.get("/api/clubs", () => HttpResponse.json([])));
```

`test/setup/dom.ts` stubs the browser APIs jsdom lacks:

- `matchMedia` and `ResizeObserver`;
- `HTMLMediaElement.play` and `pause`;
- a canvas 2D context and `toBlob`, which returns a tiny JPEG blob;
- `navigator.mediaDevices.getUserMedia`, a `vi.fn` that resolves a fake stream whose tracks record `stop()`.

The developer's `.env` is not loaded into `import.meta.env`.

## End-to-end tests

`npm run test:e2e` (`playwright.config.ts`) works like this:

The webServer command, `test/e2e/start-server.ts`, does this:

1. It runs the guard and holds the name of **`<test database>_e2e`** (`pokerpal_test_e2e` by default, or `TEST_DB_NAME` plus `_e2e`) for the whole run, as an api run holds its own. It recreates that database empty on the test database server. It is left in place afterwards for debugging.
2. It empties the server's working directory, **`tmp/e2e/<e2e database>/`** (git-ignored). Local-disk uploads are written to and served from `uploads/` there, never the repo's own `uploads/`.
3. `npm run build` runs. Set `E2E_SKIP_BUILD=1` to reuse an existing `dist/`; CI does this with the build job's output.
4. `node dist/index.js` starts from that directory with `NODE_ENV=production` on **port 4710**, or `E2E_PORT`. Its boot migrations build the schema, as on a fresh deploy. Its R2 variables are set to empty (`test/e2e/server-env.ts`), so uploads stay on local disk even when the shell holds R2 credentials. Parallel runs still share `dist/`: build once, then run the others with `E2E_SKIP_BUILD=1`.
5. Playwright waits for `/api/health`, then runs Chromium. Every request carries `X-Forwarded-Proto: https`, as Railway's proxy sends, so the production session cookie (`Secure`) is set over plain `http://localhost`. The browser has a fake camera (`--use-fake-device-for-media-stream`, `camera` permission granted). Traces are kept on the first retry.

`test/e2e/smoke.spec.ts` checks that:

- the landing page renders with no console errors and no CSP violations;
- `/api/health` reports the app, the database and the boot migrations as ok;
- a visitor who registers is signed in, and still is on the next page load;
- a self-registration photo is stored in, and served from, the server's own `uploads/`;
- a request with an `Upgrade` header gets an ordinary answer (production has no websockets).

One violation is known and allowed, and it is listed in the test: production's CSP blocks the Google Fonts stylesheet that `client/src/index.css` imports. The test fails once that stops happening, so the allowance gets removed.

Reports go to `playwright-report/` (`npx playwright show-report`), traces to `test-results/`.

## Demo seed scripts

The old `test/tournament-*.test.ts` scripts are now **seeders** in `scripts/seed/`. They had no assertions, and Vitest must never pick them up. They write demo clubs, players and tournaments, and most of them leave the data behind. They use the same guard, so they only write to a local `*_test` database. That database is created if missing and migrated first.

```bash
npm run seed:tournament          # full lifecycle, data kept
npm run seed:tournament:cleanup  # full lifecycle, then deletes its data
npm run seed:tournament:setup    # tournament open for registration
npm run seed:tournament:active   # tournament in progress
npm run seed:tournament:final    # down to the final table
```

To browse seeded data, run the app against the test database:

```bash
DATABASE_URL=postgresql://you@localhost:5432/pokerpal_test npm run dev
```

## Layout

```
test/
  setup/      db-guard.ts (the guard), database-names.ts (the names a run derives),
              databases.ts (create/drop/migrate helpers), run-lock.ts (one run per database name),
              global-db.ts + api.ts (api project), dom.ts (web project)
  helpers/    getApp, anon, signIn, loginAs, resetDb, testDb, asJson, UNKNOWN_ID;
              media.ts (fake camera stream); scratch-db.ts (empty databases, drizzle-kit push)
  factories/  build*/create* and createTournamentScenario
  msw/        the MSW server for component tests
  api/        api tests (*.api.test.ts)
  unit/       unit tests for the test infrastructure, the test environment and the deploy configuration
  e2e/        Playwright specs, the e2e database, port, working directory and server env, and start-server.ts
```

## CI

`.github/workflows/ci.yml` runs on Node from `.nvmrc`, and a newer push cancels the run in progress. It has five jobs:

- **Typecheck**: `npm run typecheck`.
- **Tests**: `vitest run --coverage` against a `postgres:16-alpine` service, with `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/pokerpal_test`.
- **Build**: `npm run build`. The resulting `dist/` is uploaded.
- **Docker image**: builds the `Dockerfile` Railway deploys (alpine, production dependencies only, running as the `node` user), boots it against an empty `postgres:16-alpine` database until `/api/health` passes, then uploads a photo through `/api/upload/public`, which exercises sharp's alpine build and the `node` user writing `uploads/`. `test/unit/deploy-config.test.ts` checks the job is there.
- **E2E**: runs after Tests and Build. It installs Chromium and runs Playwright on the built `dist/`, and uploads the report when it fails.

Coverage is report-only, except `shared/domain/**` (the money code), which must keep 95% line and 90% branch coverage.
