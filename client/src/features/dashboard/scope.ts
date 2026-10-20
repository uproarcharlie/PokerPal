/**
 * The dashboard shows the clubs the viewer runs (owns or manages; every club for an admin), the same
 * scope the server gives its totals, so the numbers and the lists under them agree.
 */
import type { ClubDto, PublicSeason } from "@shared/api/public";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { isActiveStatus } from "@shared/domain/tournaments";

export const runByViewer = (clubs: readonly ClubDto[]): ClubDto[] => clubs.filter((club) => club.viewer.canManage);

/**
 * Which clubs' seasons to ask for: `undefined` (every season, in one request) when the viewer runs
 * every club there is, else the ids of the clubs they run.
 */
export const seasonScope = (yours: readonly ClubDto[], all: readonly ClubDto[]): string[] | undefined =>
  yours.length === all.length ? undefined : yours.map((club) => club.id);

/** Running and open-for-registration tournaments of `clubs`, soonest start first. */
export function activeTournaments(tournaments: readonly TournamentListItemDto[], clubs: readonly ClubDto[]): TournamentListItemDto[] {
  const ids = new Set(clubs.map((club) => club.id));
  return tournaments
    .filter((tournament) => ids.has(tournament.clubId) && isActiveStatus(tournament.status))
    .sort((a, b) => Date.parse(a.startDateTime) - Date.parse(b.startDateTime));
}

/** The newest `count` of `clubs`. */
export function newestClubs(clubs: readonly ClubDto[], count: number): ClubDto[] {
  return [...clubs].sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0).slice(0, count);
}

/** The active season of `clubs` that started last, if any. */
export function currentSeason(seasons: readonly PublicSeason[], clubs: readonly ClubDto[]): PublicSeason | undefined {
  const ids = new Set(clubs.map((club) => club.id));
  return seasons
    .filter((season) => season.isActive && ids.has(season.clubId))
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))[0];
}
