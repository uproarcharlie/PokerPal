/**
 * How often a screen that follows a running tournament asks again: the public page, and the TD's own
 * tournament page, so the pool, the counts and the next high-hand award the TD reads out are the ones
 * the server is working from (QR sign-ups and requests confirmed elsewhere included: P2REV1-MONEY-01).
 * The server counts this polling under its `live` limit, not the per-visitor budget.
 */
export const LIVE_REFRESH_MS = 5000;
