import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, NETWORK_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE } from "./http";
import { createQueryClient, retryDelay, shouldRetry, STALE_TIME_MS } from "./query-client";

describe("the query defaults", () => {
  it("keep data fresh for 30 seconds and refetch when the window regains focus", () => {
    const options = createQueryClient().getDefaultOptions().queries;

    expect(options?.staleTime).toBe(STALE_TIME_MS);
    expect(STALE_TIME_MS).toBe(30_000);
    expect(options?.refetchOnWindowFocus).toBe(true);
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("never retry an answer the server will give again (4xx), and retry trouble twice", () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(shouldRetry(0, new ApiError({ status, error: "No" }))).toBe(false);
    }
    expect(shouldRetry(0, new ApiError({ status: 503, error: "Busy" }))).toBe(true);
    expect(shouldRetry(1, new ApiError({ status: 0, error: "Offline" }))).toBe(true);
    expect(shouldRetry(2, new ApiError({ status: 500, error: "Oops" }))).toBe(false);
  });

  it("do not ask again at once after a timeout, which already waited the whole limit (P3REV-PERF-TIMEOUT-RETRIES)", () => {
    expect(shouldRetry(0, new ApiError({ status: 0, error: TIMEOUT_ERROR_MESSAGE }))).toBe(false);
    expect(shouldRetry(0, new ApiError({ status: 0, error: NETWORK_ERROR_MESSAGE }))).toBe(true);
  });

  it("wait 1 s, then 2 s, before asking again: the one backoff, which the session check uses too (P3REV5-CQ-14)", () => {
    expect([0, 1, 2].map(retryDelay)).toEqual([1000, 2000, 4000]);
    expect(retryDelay(10)).toBe(30_000);
    expect(createQueryClient().getDefaultOptions().queries?.retryDelay).toBe(retryDelay);
  });

  it("have no default fetcher: a query keyed by its URL is never fetched from the key", async () => {
    const client = createQueryClient({ queries: { retry: false } });

    await expect(client.fetchQuery({ queryKey: ["/api/tournaments", "t1", "registrations"] })).rejects.toThrow(/Missing queryFn/);
    await expect(client.fetchQuery({ queryKey: ["tournaments", "detail", "t1"] })).rejects.toThrow(/Missing queryFn/);
  });
});

describe("with the browser offline (P3REV-PERF-OFFLINE-PAUSE)", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("still sends reads and changes, so they fail fast instead of waiting, paused, for the connection", async () => {
    onlineManager.setOnline(false);
    const client = createQueryClient({ queries: { retry: false } });
    const offline = new ApiError({ status: 0, error: NETWORK_ERROR_MESSAGE });
    let asked = 0;
    let sent = 0;

    await expect(
      client.fetchQuery({
        queryKey: ["tournaments", "detail", "t1"],
        queryFn: () => {
          asked += 1;
          throw offline;
        },
      }),
    ).rejects.toBe(offline);
    const change = client.getMutationCache().build(client, {
      mutationFn: () => {
        sent += 1;
        return Promise.reject(offline);
      },
    });
    await expect(change.execute(undefined)).rejects.toBe(offline);

    expect([asked, sent]).toEqual([1, 1]);
    expect(change.state.isPaused).toBe(false);
  });
});
