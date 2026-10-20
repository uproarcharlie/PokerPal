import type { TournamentListItemDto } from "@shared/api/tournaments";

type Listed = Pick<TournamentListItemDto, "status" | "startDateTime">;

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
