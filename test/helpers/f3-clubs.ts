/**
 * The clubs feature's web-test scenario (F3), over the shared DTO factories (./dto): tests override
 * only what they are about.
 */
import type { ClubDto, PublicSeason } from "@shared/api/public";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import * as base from "./dto";

export const LOGO_URL = "/uploads/club_logo/0b9f6a6e-1d2c-4c39-9a4e-2f6f5e0c1a11/512.webp";
export const NEW_LOGO_URL = "/uploads/club_logo/1c2e3f40-5a6b-4c7d-8e9f-a0b1c2d3e4f5/512.webp";

export const { OWNER_VIEW, MANAGER_VIEW } = base;
export { leaderboardEntryDto as leaderboardEntry, clubStaffDto as staffDto } from "./dto";

/** Central Stars, founded in January 2026, seen by a visitor. */
export function clubDto(overrides: Partial<ClubDto> = {}): ClubDto {
  return base.clubDto({ createdAt: "2026-01-15T00:00:00.000Z", ...overrides });
}

/** A points-scoring tournament open for registration on Saturday, as the club lists show it. */
export function tournamentItem(overrides: Partial<TournamentListItemDto> = {}): TournamentListItemDto {
  return base.tournamentListItemDto({ startDateTime: "2026-10-24T06:30:00.000Z", trackPoints: true, minPlayers: 4, maxPlayers: 30, ...overrides });
}

/** The season that started on 1 October. */
export function seasonDto(overrides: Partial<PublicSeason> = {}): PublicSeason {
  return base.seasonDto({ startDate: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", ...overrides });
}
