import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/http";
import {
  CLOSED_FOLLOW_MS,
  CLOSED_REFRESH_MS,
  LIVE_REFRESH_MS,
  liveTournamentInterval,
  RATE_LIMITED_REFRESH_MS,
  resultsVersion,
  unlessRefused,
} from "./live-refresh";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("following a tournament", () => {
  it("asks again every few seconds while it is open", () => {
    for (const status of ["scheduled", "registration", "in_progress"]) {
      expect(liveTournamentInterval({ status, finalizedAt: null }, NOW)).toBe(LIVE_REFRESH_MS);
    }
  });

  it("never polls a tournament that has not loaded", () => {
    expect(liveTournamentInterval(undefined, NOW)).toBe(false);
  });

  it("keeps a recently finalized tournament on a slow poll, then stops (P3REV0-PARITY-01)", () => {
    expect(liveTournamentInterval({ status: "completed", finalizedAt: ago(60_000) }, NOW)).toBe(CLOSED_REFRESH_MS);
    expect(liveTournamentInterval({ status: "completed", finalizedAt: ago(CLOSED_FOLLOW_MS + 1) }, NOW)).toBe(false);
    expect(liveTournamentInterval({ status: "completed", finalizedAt: null }, NOW)).toBe(false);
    expect(liveTournamentInterval({ status: "cancelled", finalizedAt: null }, NOW)).toBe(false);
  });

  it("names the results by status and finalize time, so a close or a correction is noticed", () => {
    expect(resultsVersion({ status: "in_progress", finalizedAt: null })).not.toBe(resultsVersion({ status: "completed", finalizedAt: ago(0) }));
    expect(resultsVersion({ status: "completed", finalizedAt: ago(10) })).not.toBe(resultsVersion({ status: "completed", finalizedAt: ago(0) }));
  });

  it("stays the same through Start and Pause, which write no results, and changes when it opens again (P3REV-PERF-RESULTS-VERSION)", () => {
    const open = ["scheduled", "registration", "in_progress"].map((status) => resultsVersion({ status, finalizedAt: null }));
    expect(new Set(open).size).toBe(1);
    expect(resultsVersion({ status: "cancelled", finalizedAt: null })).not.toBe(open[0]);
    expect(resultsVersion({ status: "registration", finalizedAt: ago(10) })).toBe(open[0]);
  });
});

describe("a poll the server refused", () => {
  const refused = (status: number, code?: ConstructorParameters<typeof ApiError>[0]["code"]) =>
    new ApiError({ status, error: "Refused", code });

  it("stops for good when what it follows is gone or no longer the viewer's (P3REV4-PERF-D)", () => {
    for (const status of [403, 404, 410]) expect(unlessRefused(refused(status), LIVE_REFRESH_MS)).toBe(false);
  });

  it("backs off while the venue's request budget is spent, instead of spending the next one faster (P3REV-PERF-LIVE-BUDGET-429)", () => {
    expect(unlessRefused(refused(429, "RATE_LIMITED"), LIVE_REFRESH_MS)).toBe(RATE_LIMITED_REFRESH_MS);
    // Never sooner than it would have asked anyway, and never a poll that was not running.
    expect(unlessRefused(refused(429, "RATE_LIMITED"), 2 * RATE_LIMITED_REFRESH_MS)).toBe(2 * RATE_LIMITED_REFRESH_MS);
    expect(unlessRefused(refused(429, "RATE_LIMITED"), false)).toBe(false);
  });

  it("keeps its pace through a failure that may pass, and after a success", () => {
    expect(unlessRefused(refused(500), LIVE_REFRESH_MS)).toBe(LIVE_REFRESH_MS);
    expect(unlessRefused(refused(0), LIVE_REFRESH_MS)).toBe(LIVE_REFRESH_MS);
    expect(unlessRefused(null, LIVE_REFRESH_MS)).toBe(LIVE_REFRESH_MS);
  });
});
