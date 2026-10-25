/**
 * U-AP's API bodies for the web tests: a prize pool exactly as the server works it out (the shared/domain
 * functions toPrizePoolDto calls), the AP endpoints' answer, and the public season leaderboard. Presets over
 * test/helpers/dto.ts's factories, so a DTO that changes breaks the typecheck in one place.
 */
import type { PublicSeasonLeaderboardDto } from "@shared/api/live-display";
import type { ApUpdateResponse, PrizePoolDto } from "@shared/api/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto, TournamentStatus } from "@shared/api/tournaments";
import { computePrizePool, payoutsForDisplay } from "@shared/domain/prize-pool";
import { leaderboardEntryDto, MANAGER_VIEW, registrationDto, tournamentDto } from "./dto";

/**
 * A night at Central Stars, run by one of its managers: $100 buy-ins with 10% AP, and one $25 re-buy or
 * add-on each with $5 AP per entry.
 */
export function apTournament(overrides: Partial<TournamentDetailDto> = {}): TournamentDetailDto {
  return tournamentDto({
    name: "One Life Line",
    status: "in_progress",
    buyInAmount: "100.00",
    rebuyAmount: "25.00",
    addonAmount: "25.00",
    maxRebuys: 1,
    rakeType: "percentage",
    rakeAmount: "10.00",
    rebuyRakeType: "fixed",
    rebuyRakeAmount: "5.00",
    addonRakeType: "fixed",
    addonRakeAmount: "5.00",
    viewer: MANAGER_VIEW,
    ...overrides,
  });
}

/** `count` players with one buy-in each; the first `rebuys` re-bought once and the first `addons` took the add-on. */
export function entrants(count: number, { rebuys = 0, addons = 0 }: { rebuys?: number; addons?: number } = {}): PublicRegistration[] {
  return Array.from({ length: count }, (_, index) =>
    registrationDto(`r${index + 1}`, `Player ${index + 1}`, { rebuys: index < rebuys ? 1 : 0, addons: index < addons ? 1 : 0 }),
  );
}

/** GET /api/tournaments/:id/prize-pool for `tournament` and `registrations`, labelled "AP" unless overridden. */
export function prizePoolDto(
  tournament: TournamentDetailDto,
  registrations: readonly PublicRegistration[],
  overrides: Partial<PrizePoolDto> = {},
): PrizePoolDto {
  const breakdown = computePrizePool(tournament, registrations);
  const locked = tournament.prizePoolLocked === true;
  return {
    tournamentId: tournament.id,
    status: tournament.status as TournamentStatus,
    rakeLabel: "AP",
    locked,
    estimated: !locked && tournament.status !== "completed",
    breakdown,
    display: payoutsForDisplay(tournament, breakdown, registrations),
    adjustment: tournament.prizePoolAdjustedAt
      ? { reason: tournament.prizePoolAdjustmentReason, adjustedAt: tournament.prizePoolAdjustedAt }
      : null,
    ...overrides,
  };
}

/** What PUT …/prize-pool/adjustment and …/rates answer: the tournament after the change, and its pool. */
export function apUpdateResponse(tournament: TournamentDetailDto, registrations: readonly PublicRegistration[]): ApUpdateResponse {
  return { tournament, prizePool: prizePoolDto(tournament, registrations) };
}

/** GET /api/public/seasons/:id/leaderboard: Central Stars' running season, five of its twelve tournaments played. */
export function publicSeasonLeaderboardDto(overrides: Partial<PublicSeasonLeaderboardDto> = {}): PublicSeasonLeaderboardDto {
  return {
    season: { id: "s1", name: "Summer 2026", startDate: "2026-09-01T00:00:00.000Z", endDate: "2027-03-31T00:00:00.000Z", isActive: true },
    club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null },
    entries: [
      leaderboardEntryDto(1, "Ann Smith", 120, { tournaments: 5 }),
      leaderboardEntryDto(2, "Bea Jones", 95, { tournaments: 4 }),
      leaderboardEntryDto(2, "Cal Brown", 95, { tournaments: 5 }),
      leaderboardEntryDto(4, "Dee White", 40, { tournaments: 2 }),
    ],
    tournaments: { completed: 5, total: 12 },
    generatedAt: "2026-10-20T08:00:00.000Z",
    ...overrides,
  };
}
