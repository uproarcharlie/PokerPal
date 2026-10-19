import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError } from "@test/helpers/web";
import { apiJson, apiRequest, ApiRequestError, onSessionExpired } from "./queryClient";

const subscriptions: Array<() => void> = [];
afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
});

async function failure(call: Promise<unknown>): Promise<ApiRequestError> {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe("apiRequest errors", () => {
  it("carries the server's sentence, code and details", async () => {
    server.use(
      http.post("/api/tournaments/t1/finalize", () =>
        apiError(409, "ACTIVE_PLAYERS_NEED_ORDER", "Choose the finishing order", { activePlayers: [] }),
      ),
    );

    const error = await failure(apiRequest("POST", "/api/tournaments/t1/finalize", {}));

    expect(error.status).toBe(409);
    expect(error.code).toBe("ACTIVE_PLAYERS_NEED_ORDER");
    expect(error.message).toBe("Choose the finishing order");
    expect(error.details).toEqual({ activePlayers: [] });
  });

  it("names the first problem of a validation error", async () => {
    server.use(
      http.put("/api/clubs/c1", () =>
        apiError(400, "VALIDATION", "Invalid club data", [
          { code: "custom", path: ["websiteUrl"], message: "Only http and https links are allowed" },
        ]),
      ),
    );

    const error = await failure(apiRequest("PUT", "/api/clubs/c1", { websiteUrl: "javascript:x" }));

    expect(error.message).toBe("Invalid club data (websiteUrl: Only http and https links are allowed)");
  });

  it("never shows markup from a body that is not the API's JSON", async () => {
    server.use(http.get("/api/x", () => new HttpResponse("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" })));

    const error = await failure(apiJson("GET", "/api/x"));

    expect(error.message).toBe("Bad Gateway");
    expect(error.code).toBeUndefined();
  });
});

describe("onSessionExpired", () => {
  it("is told about a 401 that means the session has gone", async () => {
    const listener = vi.fn();
    subscriptions.push(onSessionExpired(listener));
    server.use(http.get("/api/dashboard/stats", () => apiError(401, "UNAUTHENTICATED", "Please sign in")));

    await failure(apiJson("GET", "/api/dashboard/stats"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is not told about a wrong password or a refusal", async () => {
    const listener = vi.fn();
    subscriptions.push(onSessionExpired(listener));
    server.use(
      http.post("/api/auth/change-password", () => apiError(401, "WRONG_PASSWORD", "Current password is incorrect")),
      http.put("/api/clubs/c1", () => apiError(403, "FORBIDDEN", "You do not manage this club")),
    );

    await failure(apiRequest("POST", "/api/auth/change-password", {}));
    await failure(apiRequest("PUT", "/api/clubs/c1", {}));

    expect(listener).not.toHaveBeenCalled();
  });
});
