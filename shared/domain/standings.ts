/**
 * Finishing order for finalize, and which entries may still be removed. PURE: no imports, no I/O.
 *
 * Players still in (not eliminated) finish ahead of everyone who busted. When two or more are still
 * in, the order between them is the tournament director's call, so it must be given explicitly: the
 * app never guesses (bug-07). Busted players rank by elimination time, latest first; a bust with no
 * recorded time ranks after every timed one, as it always has; ties go to the lower registration id,
 * so the same data always gives the same order.
 */

/** A registration as ranking reads it. A `TournamentRegistration` row fits as it is. */
export interface FinisherInput {
  id: string;
  /** Null counts as still in, as it always has. */
  isEliminated?: boolean | null;
  eliminationTime?: Date | string | null;
}

export type FinishOrderSource = "eliminations" | "explicit";

export type FinishOrderProblem = "ACTIVE_PLAYERS_NEED_ORDER" | "INVALID_FINISH_ORDER";

export type RankedFinishers<T> = { ok: true; ordered: T[]; source: FinishOrderSource } | { ok: false; problem: FinishOrderProblem };

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Milliseconds since the epoch; a missing or unreadable time is 0, so it ranks last. */
function eliminatedAt(time: Date | string | null | undefined): number {
  if (time === null || time === undefined) return 0;
  const ms = time instanceof Date ? time.getTime() : Date.parse(time);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Ranks every registration, best finish first.
 *
 * `finishOrder` lists registration ids, best first. Either the players still in:
 * - two or more still in: required (ACTIVE_PLAYERS_NEED_ORDER), and it must name exactly those
 *   players, each once (INVALID_FINISH_ORDER);
 * - one still in: optional, but if given it must be just that player;
 * - nobody still in: must be absent or empty;
 * or every registration, each once: the whole finishing order as the TD gives it, eliminations
 * included. That is how a wrong order among busted players (a mis-tapped elimination) is corrected
 * after a tournament was finalized, when eliminations can no longer be edited (D19).
 */
export function rankFinishers<T extends FinisherInput>(
  registrations: readonly T[],
  finishOrder?: readonly string[],
): RankedFinishers<T> {
  const active = registrations.filter((r) => !r.isEliminated).sort(byId);
  const activeIds = active.map((r) => r.id);
  const given = finishOrder ?? [];

  const everyone = registrations.map((r) => r.id);
  if (given.length > 0 && given.length === everyone.length && given.length > activeIds.length && isPermutationOf(given, everyone)) {
    const byRegistrationId = new Map(registrations.map((r) => [r.id, r]));
    return { ok: true, ordered: given.map((id) => byRegistrationId.get(id) as T), source: "explicit" };
  }

  if (active.length >= 2 && given.length === 0) {
    return { ok: false, problem: "ACTIVE_PLAYERS_NEED_ORDER" };
  }
  if (given.length > 0 && !isPermutationOf(given, activeIds)) {
    return { ok: false, problem: "INVALID_FINISH_ORDER" };
  }

  const byRegistration = new Map(active.map((r) => [r.id, r]));
  const leaders = given.length > 0 ? given.map((id) => byRegistration.get(id) as T) : active;
  const busted = registrations
    .filter((r) => r.isEliminated)
    .sort((a, b) => eliminatedAt(b.eliminationTime) - eliminatedAt(a.eliminationTime) || byId(a, b));

  return { ok: true, ordered: [...leaders, ...busted], source: active.length >= 2 ? "explicit" : "eliminations" };
}

function isPermutationOf(candidate: readonly string[], ids: readonly string[]): boolean {
  if (candidate.length !== ids.length) return false;
  const remaining = new Set(ids);
  for (const id of candidate) {
    if (!remaining.delete(id)) return false;
  }
  return true;
}

/** A registration as the removal rule reads it. A `TournamentRegistration` row fits as it is. */
export interface RemovalInput {
  id: string;
  playerId: string;
  isEliminated?: boolean | null;
  eliminatedBy?: string | null;
  rebuys?: number | null;
  addons?: number | null;
  knockouts?: number | null;
  highHandWinner?: boolean | null;
  finalPosition?: number | null;
}

/**
 * Why an entry cannot simply be taken out of its tournament (DELETE /api/registrations/:id): what it
 * already has recorded ("an elimination, re-buys"), or null when nothing has happened to it yet.
 * `registrations` is every entry of the tournament: a player another entry names as its eliminator
 * keeps that knockout even if their own count was reset. One rule for the standings table's Remove
 * button and the server (CQ-P2-03).
 */
export function registrationRemovalProblem(registration: RemovalInput, registrations: readonly RemovalInput[]): string | null {
  const knockedOutOthers = registrations.some((r) => r.id !== registration.id && r.eliminatedBy === registration.playerId);
  const recorded: string[] = [];
  if (registration.isEliminated) recorded.push("an elimination");
  if ((registration.rebuys ?? 0) > 0) recorded.push("re-buys");
  if ((registration.addons ?? 0) > 0) recorded.push("add-ons");
  if ((registration.knockouts ?? 0) > 0 || knockedOutOthers) recorded.push("knockouts");
  if (registration.highHandWinner) recorded.push("a high-hand win");
  if (registration.finalPosition != null) recorded.push("a finishing position");
  return recorded.length > 0 ? recorded.join(", ") : null;
}
