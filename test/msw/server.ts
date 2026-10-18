import { setupServer } from "msw/node";

/**
 * The MSW server for component tests. It starts with no handlers and fails any
 * request a test has not mocked, so add what a test needs with
 * `server.use(http.get("/api/...", () => HttpResponse.json(...)))`. Handlers
 * added that way are removed after each test (test/setup/dom.ts).
 */
export const server = setupServer();
