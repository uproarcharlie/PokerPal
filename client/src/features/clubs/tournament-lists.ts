import type { TournamentListItemDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";

type Listed = Pick<TournamentListItemDto, "status" | "startDateTime">;

type Counted = Pick<TournamentListItemDto, "status" | "registeredCount" | "waitingListCount" | "maxPlayers">;

/**
 * "18 / 18 players · 1 waiting": the field against Max players, as the server counts it, and while the
 * tournament is open the waiting list behind it, never in the field ("19 / 18": round 5, item 15).
 */
export function fieldCountText({ status, registeredCount, waitingListCount, maxPlayers }: Counted): string {
  const waiting = isClosedStatus(status) ? 0 : waitingListCount;
  return `${registeredCount - waitingListCount} / ${maxPlayers} players${waiting > 0 ? ` · ${waiting} waiting` : ""}`;
}

const startTime = (tournament: Listed) => new Date(tournament.startDateTime).getTime();

/** Soonest start first. */
export const byStartAsc = (a: Listed, b: Listed) => startTime(a) - startTime(b);

/** Latest start first. */
export const byStartDesc = (a: Listed, b: Listed) => startTime(b) - startTime(a);

export interface PublicTournamentGroups<T extends Listed> {
  /** In progress now. */
  live: T[];
  /** Scheduled or open for registration, soonest first. */
  upcoming: T[];
  /** Completed, latest first. Cancelled tournaments are not listed publicly. */
  past: T[];
}

/** A club's tournaments as its public page lists them. */
export function groupForPublicPage<T extends Listed>(tournaments: readonly T[]): PublicTournamentGroups<T> {
  return {
    live: tournaments.filter((tournament) => tournament.status === "in_progress"),
    upcoming: tournaments.filter((tournament) => tournament.status === "scheduled" || tournament.status === "registration").sort(byStartAsc),
    past: tournaments.filter((tournament) => tournament.status === "completed").sort(byStartDesc),
  };
}
