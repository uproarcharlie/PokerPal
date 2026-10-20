import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError } from "@test/helpers/web";
import {
  ApiError,
  apiGet,
  apiSend,
  errorMessage,
  hasErrorCode,
  NETWORK_ERROR_MESSAGE,
  onSessionExpired,
  REQUEST_TIMEOUT_MS,
  SEND_TIMEOUT_MS,
  TIMEOUT_ERROR_MESSAGE,
  segment,
  withQuery,
} from "./http";

const subscriptions: Array<() => void> = [];
afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
});

async function failure(call: Promise<unknown>): Promise<ApiError> {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("apiGet and apiSend", () => {
  it("send JSON with the session cookie and resolve with the parsed body", async () => {
    let seen: { contentType: string | null; body: unknown; credentials: RequestCredentials } | undefined;
    server.use(
      http.put("/api/clubs/c1", async ({ request }) => {
        seen = { contentType: request.headers.get("content-type"), body: await request.json(), credentials: request.credentials };
        return HttpResponse.json({ id: "c1", name: "Central Stars" });
      }),
      http.get("/api/clubs/c1", () => HttpResponse.json({ id: "c1" })),
    );

    await expect(apiSend<{ name: string }>("PUT", "/api/clubs/c1", { name: "Central Stars" })).resolves.toEqual({ id: "c1", name: "Central Stars" });
    await expect(apiGet("/api/clubs/c1")).resolves.toEqual({ id: "c1" });
    expect(seen).toEqual({ contentType: "application/json", body: { name: "Central Stars" }, credentials: "include" });
  });

  it("send FormData as it is, so the browser sets the multipart boundary", async () => {
    let contentType: string | null = null;
    server.use(
      http.post("/api/images/club_logo", ({ request }) => {
        contentType = request.headers.get("content-type");
        return HttpResponse.json({ url: "/uploads/x.webp" }, { status: 201 });
      }),
    );
    const form = new FormData();
    form.append("image", new Blob(["x"], { type: "image/png" }), "x.png");

    await apiSend("POST", "/api/images/club_logo", form);

    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("resolve a 204 with undefined", async () => {
    server.use(http.delete("/api/seasons/s1", () => new HttpResponse(null, { status: 204 })));

    await expect(apiSend("DELETE", "/api/seasons/s1")).resolves.toBeUndefined();
  });

  it("throw the server's sentence, code and details", async () => {
    server.use(
      http.post("/api/tournaments/t1/finalize", () =>
        apiError(409, "ACTIVE_PLAYERS_NEED_ORDER", "Choose the finishing order", { activePlayers: [] }),
      ),
    );

    const error = await failure(apiSend("POST", "/api/tournaments/t1/finalize", {}));

    expect(error).toMatchObject({ status: 409, code: "ACTIVE_PLAYERS_NEED_ORDER", error: "Choose the finishing order", details: { activePlayers: [] } });
    expect(error.message).toBe("Choose the finishing order");
    expect(hasErrorCode(error, "PLAN_CHANGED", "ACTIVE_PLAYERS_NEED_ORDER")).toBe(true);
    expect(hasErrorCode(error, "PLAN_CHANGED")).toBe(false);
  });

  it("add the first validation problem to the message, keeping the sentence apart", async () => {
    server.use(
      http.put("/api/clubs/c1", () =>
        apiError(400, "VALIDATION", "Invalid club data", [{ code: "custom", path: ["websiteUrl"], message: "Only http and https links are allowed" }]),
      ),
    );

    const error = await failure(apiSend("PUT", "/api/clubs/c1", {}));

    expect(error.message).toBe("Invalid club data (websiteUrl: Only http and https links are allowed)");
    expect(error.error).toBe("Invalid club data");
  });

  it("never show markup from a body that is not the API's JSON", async () => {
    server.use(http.get("/api/x", () => new HttpResponse("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" })));

    const error = await failure(apiGet("/api/x"));

    expect(error.message).toBe("Bad Gateway");
    expect(error.code).toBeUndefined();
  });

  it("turn no answer at all into a status-0 error people can read", async () => {
    server.use(http.get("/api/x", () => HttpResponse.error()));

    const error = await failure(apiGet("/api/x"));

    expect(error).toMatchObject({ status: 0, message: NETWORK_ERROR_MESSAGE });
  });

  it("let a cancelled request reject as an abort, not as an error to show", async () => {
    server.use(http.get("/api/x", () => new Promise<Response>(() => {})));
    const controller = new AbortController();

    const call = apiGet("/api/x", { signal: controller.signal });
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: "AbortError" });
  });

  it("give up on a request with no answer in time, as no answer, so the next poll or retry can go (P3REV4-PERF-03)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(http.get("/api/x", () => new Promise<Response>(() => {})));

    const call = failure(apiGet("/api/x"));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);

    expect(await call).toMatchObject({ status: 0, message: TIMEOUT_ERROR_MESSAGE });
    vi.useRealTimers();
  });

  it("give a change longer, then give up on it the same way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settled = false;
    server.use(http.post("/api/x", () => new Promise<Response>(() => {})));

    const call = failure(apiSend("POST", "/api/x", {})).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);

    expect(await call).toMatchObject({ status: 0, message: TIMEOUT_ERROR_MESSAGE });
    vi.useRealTimers();
  });
});

describe("onSessionExpired", () => {
  it("is told about a 401 that means the session has gone", async () => {
    const listener = vi.fn();
    subscriptions.push(onSessionExpired(listener));
    server.use(http.get("/api/dashboard/stats", () => apiError(401, "UNAUTHENTICATED", "Please sign in")));

    await failure(apiGet("/api/dashboard/stats"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is not told about a wrong password or a refusal", async () => {
    const listener = vi.fn();
    subscriptions.push(onSessionExpired(listener));
    server.use(
      http.post("/api/auth/change-password", () => apiError(401, "WRONG_PASSWORD", "Current password is incorrect")),
      http.put("/api/clubs/c1", () => apiError(403, "FORBIDDEN", "You do not manage this club")),
    );

    await failure(apiSend("POST", "/api/auth/change-password", {}));
    await failure(apiSend("PUT", "/api/clubs/c1", {}));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("errorMessage shows the server's sentence, or the fallback for anything else", () => {
    expect(errorMessage(new ApiError({ status: 409, error: "Already registered" }))).toBe("Already registered");
    expect(errorMessage(new Error("TypeError: x is undefined"), "Please try again")).toBe("Please try again");
  });

  it("withQuery leaves out empty parameters", () => {
    expect(withQuery("/api/tournaments", { clubId: "c1", seasonId: undefined, status: null, q: "", upcoming: true, limit: 6 })).toBe(
      "/api/tournaments?clubId=c1&upcoming=true&limit=6",
    );
    expect(withQuery("/api/clubs", {})).toBe("/api/clubs");
  });

  it("segment keeps an id from changing which endpoint is called", () => {
    expect(`/api/clubs/slug/${segment("a/b?c")}`).toBe("/api/clubs/slug/a%2Fb%3Fc");
  });
});
