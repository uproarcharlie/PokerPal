/**
 * How a tournament is shown, and the rules every tournament service shares (./tournaments,
 * ./prize-pool, ./finalize, ./registrations, ./pending-actions), kept here so those services never
 * import each other in a cycle.
 */
import type { Viewer } from "@shared/api/common";
import { pickFields, PUBLIC_TOURNAMENT_FIELDS, TOURNAMENT_TAKINGS_FIELDS } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { CLOSED_STATUSES, type TournamentStatus } from "@shared/domain/tournaments";
import { highHandAwardsOf, highHandLabel, listsHighHands, potsAwardsProblem, type PotAwardsProblem } from "@shared/domain/high-hands";
import { formatMoney, toCents, type MoneyInput } from "@shared/domain/money";
import {
  computePrizePool,
  highHandAwardsProblem,
  type EntryInput,
  type HighHandAwardsProblem,
  type PrizePoolInput,
} from "@shared/domain/prize-pool";
import type { Tournament, TournamentHighHand } from "@shared/schema";
import { conflict, type HttpError } from "../http/errors";
import { toHighHandDtos } from "./high-hands";

/**
 * A tournament as its viewer may see it: no audit user ids, no snapshot, and the club's takings (its AP
 * rates, a manual AP total, why the pool was adjusted, where a prize difference goes) only for someone
 * who runs the club (`canManage`; round 6). Whether it shows bank transfer details after sign-up (round
 * 8) is for everyone; the details are not. Its listed high hands (round 10: null while it lists none)
 * are for everyone too, each one's AP rule only for someone who runs the club: `row` carries them
 * (./high-hands withHighHands), so no answer can leave them out.
 */
export const toPublicTournament = (row: Tournament & { highHands: readonly TournamentHighHand[] | null }, canManage: boolean) => ({
  ...pickFields(row, PUBLIC_TOURNAMENT_FIELDS),
  showBankTransfer: row.showBankTransfer === true,
  highHands: toHighHandDtos(row.highHands, canManage),
  ...(canManage ? pickFields(row, TOURNAMENT_TAKINGS_FIELDS) : {}),
});

/**
 * The finalize snapshot, for someone who runs the club only: it records what the club took, kept and
 * carried over, and the TD's bookkeeping (unconfirmed payments, discarded player requests). Everyone
 * else reads what was paid, and the deal, from the public prize pool (./public-prizes; round 6).
 */
const snapshotFor = (row: Tournament, viewer: Viewer): TournamentDetailDto["prizePoolSnapshot"] => (viewer.canManage ? row.prizePoolSnapshot : null);

/** GET /api/tournaments/:id and every staff response about one tournament (`TournamentDetailDto`). */
export const toTournamentDetail = (row: Tournament & { highHands: readonly TournamentHighHand[] | null }, viewer: Viewer) => ({
  ...toPublicTournament(row, viewer.canManage),
  prizePoolSnapshot: snapshotFor(row, viewer),
  viewer,
});

export type TournamentDetail = ReturnType<typeof toTournamentDetail>;

/**
 * The tournament's status as the DTOs type it, narrowed in this one place: tournaments.status is a text
 * column (typing the column would retype every client DTO built from the row), and every writer stores
 * one of TOURNAMENT_STATUSES (the create and update schemas, finalize and the clock).
 */
export const tournamentStatusOf = (tournament: Pick<Tournament, "status">): TournamentStatus => tournament.status as TournamentStatus;

export const isClosed = (tournament: Pick<Tournament, "status">): boolean =>
  (CLOSED_STATUSES as readonly string[]).includes(tournament.status);

const STATUS_LABELS: Readonly<Record<TournamentStatus, string>> = {
  scheduled: "Scheduled",
  registration: "Registration Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** The activity feed's `status_change` line, for every writer of a status (the clock's "also start the tournament" and its undo too). */
export const statusChangeDescription = (status: TournamentStatus): string => `Tournament status changed to ${STATUS_LABELS[status]}`;

/** "This tournament has finished" (or "was cancelled"), with ", so <what> can no longer change" when given. */
export function closedMessage(tournament: Pick<Tournament, "status">, what?: string): string {
  const base = `This tournament ${tournament.status === "cancelled" ? "was cancelled" : "has finished"}`;
  return what ? `${base}, so ${what} can no longer change` : base;
}

/**
 * 409 ENTRIES_REPRICED (details.changes): a new price for entries already recorded, which the TD
 * confirms with `repriceEntries: true`. `sentences` say each change ("3 buy-ins from $50 to $60", "2
 * First half high-hand entries from $5 to $6"); one 409 may carry the tournament form's prices and the
 * high hands' fees (round 10) together.
 */
export function entriesRepricedConflict(sentences: readonly string[], changes: readonly object[]): HttpError {
  const sentence = sentences.length === 1 ? sentences[0] : `${sentences.slice(0, -1).join(", ")} and ${sentences[sentences.length - 1]}`;
  return conflict(
    "ENTRIES_REPRICED",
    `This re-prices what is already recorded: ${sentence}. The prize pool and what players owe change with it.`,
    { changes },
  );
}

/** 409 TOURNAMENT_CLOSED once the tournament is completed or cancelled: the one rule every service uses. */
export function assertOpen(tournament: Pick<Tournament, "status">, what?: string): void {
  if (isClosed(tournament)) throw conflict("TOURNAMENT_CLOSED", closedMessage(tournament, what));
}

/**
 * A tournament and its registrations, either side of a change to its high-hand pots: for a tournament
 * that lists its high hands, with them (./high-hands MoneyState).
 */
export interface HighHandPotState {
  tournament: PrizePoolInput;
  registrations: ReadonlyArray<EntryInput & { id: string; highHandWinner?: boolean | null; highHandAmount?: MoneyInput }>;
}

/**
 * The 409 for high-hand awards that break highHandAwardsProblem's rule: more awarded than the pot
 * (HIGH_HAND_OVER_POOL), or every prize awarded and the awards not adding up to the pot exactly
 * (HIGH_HAND_AWARDED). The one wording for every change that can break it: a change to a pot, and a
 * winner's amount set by hand (P2REV4-CQ2-01). A listed high hand's (round 10) is named ("First half
 * high hand: …") with details { highHandId, name, awardedCents, potCents }; the legacy one's as before.
 */
export function highHandAwardsConflict(problem: HighHandAwardsProblem | PotAwardsProblem): HttpError {
  const awards = formatMoney(problem.awardedCents);
  const pot = formatMoney(problem.potCents);
  if ("highHandId" in problem) {
    const { code, highHandId, name, awardedCents, potCents } = problem;
    const message =
      code === "HIGH_HAND_OVER_POOL"
        ? `the awards already made (${awards}) would be more than the ${pot} pot: take an award back first`
        : `every prize has been awarded, so the awards (${awards}) must add up to the ${pot} pot: take an award back first`;
    return conflict(code, `${highHandLabel(name)}: ${message}`, { highHandId, name, awardedCents, potCents });
  }
  return conflict(
    problem.code,
    problem.code === "HIGH_HAND_OVER_POOL"
      ? `The high-hand awards already made (${awards}) would be more than the ${pot} pot: take an award back first`
      : `Every high-hand prize has been awarded, so the awards (${awards}) must add up to the ${pot} pot: take an award back first`,
  );
}

/**
 * 409 when a change to the high-hand pots (an entry ticked or unticked, a registration added or
 * removed, a fee, its rake or the number of prizes) leaves the awards already made not fitting them
 * (highHandAwardsConflict). Nothing is checked for a pot whose money and number of prizes stay the
 * same, so a change that does not touch a high hand is never refused for it. A tournament that lists
 * its high hands (after the change) is checked pot by pot (potsAwardsProblem); the legacy high hand as
 * before.
 */
export function assertHighHandAwardsFit(before: HighHandPotState, after: HighHandPotState): void {
  if (listsHighHands(after.tournament)) {
    const problem = potsAwardsProblem(
      computePrizePool(before.tournament, before.registrations).highHands,
      computePrizePool(after.tournament, after.registrations).highHands,
      highHandAwardsOf(after.tournament, after.registrations),
    );
    if (problem) throw highHandAwardsConflict(problem);
    return;
  }
  const was = computePrizePool(before.tournament, before.registrations).highHand;
  const now = computePrizePool(after.tournament, after.registrations).highHand;
  if (was.net === now.net && was.winners === now.winners) return;
  const awarded = after.registrations.filter((r) => r.highHandWinner === true).map((r) => toCents(r.highHandAmount));
  const problem = highHandAwardsProblem(now, awarded);
  if (problem) throw highHandAwardsConflict(problem);
}
