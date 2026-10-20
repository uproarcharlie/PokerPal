/**
 * The people-and-shell web-test scenario (dashboard, players, users, account, landing), over the
 * shared DTO factories (./dto).
 */
import type { ClubDto } from "@shared/api/public";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import * as base from "./dto";

export { accountRow, clubPlayer, playerRow, seasonDto, sessionUser, visitingPlayer } from "./dto";

/** A club the viewer owns. */
export function clubDto(overrides: Partial<ClubDto> = {}): ClubDto {
  return base.clubDto({ viewer: base.OWNER_VIEW, ...overrides });
}

/** A points-scoring tournament open for registration, 12 of 15 sign-ups paid, as the club's staff see it. */
export function tournamentListItem(overrides: Partial<TournamentListItemDto> = {}): TournamentListItemDto {
  return base.tournamentListItemDto({
    startDateTime: "2026-10-23T06:30:00.000Z",
    trackPoints: true,
    minPlayers: null,
    confirmedPlayerCount: 12,
    registeredCount: 15,
    ...overrides,
  });
}

export function leaderboardEntry(rank: number, name: string, points: number): LeaderboardEntryDto {
  return base.leaderboardEntryDto(rank, name, points, { player: { id: `lp-${rank}-${name}`, name, imageUrl: null }, tournaments: 3 });
}
