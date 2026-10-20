/**
 * How a tournament is shown, and the rules every tournament service shares (./tournaments,
 * ./prize-pool, ./finalize, ./registrations, ./pending-actions), kept here so those services never
 * import each other in a cycle.
 */
import type { Viewer } from "@shared/api/common";
import { PUBLIC_SNAPSHOT_FIELDS } from "@shared/api/finalize";
import { pickFields, PUBLIC_TOURNAMENT_FIELDS } from "@shared/api/public";
import { CLOSED_STATUSES } from "@shared/domain/tournaments";
import { formatMoney, toCents, type MoneyInput } from "@shared/domain/money";
import {
  computePrizePool,
  highHandAwardsProblem,
  type EntryInput,
  type HighHandAwardsProblem,
  type PrizePoolInput,
} from "@shared/domain/prize-pool";
import type { Tournament } from "@shared/schema";
import { conflict, type HttpError } from "../http/errors";

/** A tournament as anyone may see it: no audit user ids, no snapshot. */
export const toPublicTournament = (row: Tournament) => pickFields(row, PUBLIC_TOURNAMENT_FIELDS);

/**
 * The finalize snapshot as `viewer` may see it: whole for someone who runs the club, else without its
 * warnings, which are staff bookkeeping (unconfirmed payments, discarded player requests).
 */
function snapshotFor(row: Tournament, viewer: Viewer) {
  const snapshot = row.prizePoolSnapshot;
  if (!snapshot) return null;
  return viewer.canManage ? snapshot : pickFields(snapshot, PUBLIC_SNAPSHOT_FIELDS);
}

/** GET /api/tournaments/:id and every staff response about one tournament (`TournamentDetailDto`). */
export const toTournamentDetail = (row: Tournament, viewer: Viewer) => ({
  ...toPublicTournament(row),
  prizePoolSnapshot: snapshotFor(row, viewer),
  viewer,
});

export type TournamentDetail = ReturnType<typeof toTournamentDetail>;

export const isClosed = (tournament: Pick<Tournament, "status">): boolean =>
  (CLOSED_STATUSES as readonly string[]).includes(tournament.status);

/** "This tournament has finished" (or "was cancelled"), with ", so <what> can no longer change" when given. */
export function closedMessage(tournament: Pick<Tournament, "status">, what?: string): string {
  const base = `This tournament ${tournament.status === "cancelled" ? "was cancelled" : "has finished"}`;
  return what ? `${base}, so ${what} can no longer change` : base;
}

/** 409 TOURNAMENT_CLOSED once the tournament is completed or cancelled: the one rule every service uses. */
export function assertOpen(tournament: Pick<Tournament, "status">, what?: string): void {
  if (isClosed(tournament)) throw conflict("TOURNAMENT_CLOSED", closedMessage(tournament, what));
}

/** A tournament and its registrations, either side of a change to its high-hand pot. */
export interface HighHandPotState {
  tournament: PrizePoolInput;
  registrations: ReadonlyArray<EntryInput & { highHandWinner?: boolean | null; highHandAmount?: MoneyInput }>;
}

/**
 * The 409 for high-hand awards that break highHandAwardsProblem's rule: more awarded than the pot
 * (HIGH_HAND_OVER_POOL), or every prize awarded and the awards not adding up to the pot exactly
 * (HIGH_HAND_AWARDED). The one wording for every change that can break it: a change to the pot, and a
 * winner's amount set by hand (P2REV4-CQ2-01).
 */
export function highHandAwardsConflict(problem: HighHandAwardsProblem): HttpError {
  const awards = formatMoney(problem.awardedCents);
  const pot = formatMoney(problem.potCents);
  return conflict(
    problem.code,
    problem.code === "HIGH_HAND_OVER_POOL"
      ? `The high-hand awards already made (${awards}) would be more than the ${pot} pot: take an award back first`
      : `Every high-hand prize has been awarded, so the awards (${awards}) must add up to the ${pot} pot: take an award back first`,
  );
}

/**
 * 409 when a change to the high-hand pot (an entry ticked or unticked, a registration added or
 * removed, the fee, its rake or the number of prizes) leaves the awards already made not fitting it
 * (highHandAwardsConflict). Nothing is checked when the pot and the number of prizes stay the same,
 * so a change that does not touch the high hand is never refused for it.
 */
export function assertHighHandAwardsFit(before: HighHandPotState, after: HighHandPotState): void {
  const was = computePrizePool(before.tournament, before.registrations).highHand;
  const now = computePrizePool(after.tournament, after.registrations).highHand;
  if (was.net === now.net && was.winners === now.winners) return;
  const awarded = after.registrations.filter((r) => r.highHandWinner === true).map((r) => toCents(r.highHandAmount));
  const problem = highHandAwardsProblem(now, awarded);
  if (problem) throw highHandAwardsConflict(problem);
}
