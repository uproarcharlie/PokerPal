/**
 * How screens that follow a running tournament keep up with it: the public page, and the TD's own
 * tournament page, so the pool, the counts and the next high-hand award the TD reads out are the ones
 * the server is working from (QR sign-ups and requests confirmed elsewhere included: P2REV1-MONEY-01).
 * The server counts this polling under its `live` limit, not the per-visitor budget.
 */
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { isApiError, isLastingRefusal } from "@/lib/api/http";

/** How often an open tournament is asked again. */
export const LIVE_REFRESH_MS = 5000;

/**
 * A finished tournament is still asked again this often for a while (CLOSED_FOLLOW_MS after its
 * results were written), so a Correct Results reaches a phone or venue screen left open on it.
 */
export const CLOSED_REFRESH_MS = 60_000;
export const CLOSED_FOLLOW_MS = 6 * 60 * 60_000;

type Followed = Pick<TournamentDetailDto, "status" | "finalizedAt">;

/**
 * The refetch interval of a followed tournament: every LIVE_REFRESH_MS while it is open, every
 * CLOSED_REFRESH_MS for a few hours after it was finalized, then never. A tournament that never
 * loaded (missing, or the first request failed) is not polled: its page offers to try again.
 */
export function liveTournamentInterval(tournament: Followed | undefined, now = Date.now()): number | false {
  if (tournament === undefined) return false;
  if (!isClosedStatus(tournament.status)) return LIVE_REFRESH_MS;
  const finalizedAt = tournament.finalizedAt ? Date.parse(tournament.finalizedAt) : Number.NaN;
  return tournament.status === "completed" && now - finalizedAt < CLOSED_FOLLOW_MS ? CLOSED_REFRESH_MS : false;
}

/**
 * How often a followed tournament's registrations are asked again: while it is open. Once it closes they
 * are asked for once more (resultsVersion), not polled.
 */
export function liveRegistrationsInterval(tournament: Followed | undefined): number | false {
  return tournament !== undefined && !isClosedStatus(tournament.status) ? LIVE_REFRESH_MS : false;
}

/**
 * How often a poll the server turned away for too many requests asks again. Every phone on the venue's
 * Wi-Fi shares one budget, and once it is spent the server refuses them all for the rest of its
 * window (up to 15 minutes): asking every few seconds only spends the next window faster
 * (P3REV-PERF-LIVE-BUDGET-429).
 */
export const RATE_LIMITED_REFRESH_MS = 60_000;

/** The server refused the request for too many requests (429), from this device or its network. */
export const isRateLimited = (error: unknown): boolean => isApiError(error) && error.status === 429;

/**
 * A poll's interval as the server's last answer allows: false once it has refused the poll for good
 * (the tournament was deleted, or the viewer may no longer see it: asking every few seconds cannot
 * change that, and the page says so instead of "reconnecting", P3REV4-PERF-D); at most once every
 * RATE_LIMITED_REFRESH_MS while it is refusing too many requests. A later success (a refocus) starts
 * the usual polling again.
 */
export function unlessRefused(error: unknown, interval: number | false): number | false {
  if (isLastingRefusal(error)) return false;
  if (interval !== false && isRateLimited(error)) return Math.max(interval, RATE_LIMITED_REFRESH_MS);
  return interval;
}

/**
 * What a followed tournament's results depend on: it changes when the tournament closes, whenever its
 * results are written again (a Correct Results sets a new `finalizedAt`) and when it opens again, so
 * whoever shows the registrations knows to fetch them once more (P3REV0-PARITY-01). Start and Pause
 * write no results, so every open status is one version: they no longer made every phone following
 * the tournament ask for its results and leaderboards again (P3REV-PERF-RESULTS-VERSION).
 */
export const resultsVersion = (tournament: Followed): string =>
  isClosedStatus(tournament.status) ? `${tournament.status}|${tournament.finalizedAt ?? ""}` : "open";
