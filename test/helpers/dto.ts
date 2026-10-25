/**
 * API bodies for the web tests, one typed factory per DTO (P3REV2-CQ-05): each gives a complete body
 * as the server sends it, so a DTO that gains or changes a field breaks the typecheck here, in one
 * place, and every MSW handler built from these follows. Tests override only what they are about. A
 * feature's own scenario (the TD's $100 game, a club the viewer owns) is a preset over these in its
 * helper file, never a second copy of the shape.
 */
import type { AdminUserRow } from "@shared/api/admin";
import type { SessionUser } from "@shared/api/auth";
import type { ClubStaffDto } from "@shared/api/clubs";
import type { PendingActionDto } from "@shared/api/pending-actions";
import type { ClubPlayer } from "@shared/api/players";
import type { ClubDto, PublicPointsAllocation, PublicPointsSystem, PublicRegistration, PublicSeason } from "@shared/api/public";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import type { TournamentDetailDto, TournamentListItemDto } from "@shared/api/tournaments";
import { FINALIZE_SNAPSHOT_VERSION, type PrizePoolSnapshot } from "@shared/domain/finalize";
import { PAYOUT_ALGORITHM } from "@shared/domain/payouts";

export const VISITOR_VIEW = { canManage: false, canOwn: false } as const;
export const MANAGER_VIEW = { canManage: true, canOwn: false } as const;
export const OWNER_VIEW = { canManage: true, canOwn: true } as const;

export function clubDto(overrides: Partial<ClubDto> = {}): ClubDto {
  return {
    id: "c1",
    name: "Central Stars",
    slug: "central-stars",
    description: null,
    imageUrl: null,
    timezone: "Pacific/Auckland",
    address: null,
    discordUrl: null,
    twitterUrl: null,
    facebookUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    rakeLabel: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    viewer: VISITOR_VIEW,
    ...overrides,
  };
}

/** A $50 freezeout with no AP, open for registration, seen by a visitor. */
export function tournamentDto(overrides: Partial<TournamentDetailDto> = {}): TournamentDetailDto {
  return {
    id: "t1",
    name: "Friday Freezeout",
    description: null,
    imageUrl: null,
    clubId: "c1",
    seasonId: null,
    pointsSystemId: null,
    startDateTime: "2026-10-23T07:00:00.000Z",
    status: "registration",
    buyInAmount: "50.00",
    rebuyAmount: null,
    addonAmount: null,
    maxRebuys: null,
    maxAddons: null,
    rebuyOrAddon: null,
    rebuyPeriodMinutes: null,
    rakeType: "none",
    rakeAmount: "0.00",
    rebuyRakeType: "none",
    rebuyRakeAmount: "0.00",
    addonRakeType: "none",
    addonRakeAmount: "0.00",
    payoutStructure: "standard",
    customPayouts: null,
    enableHighHand: false,
    highHandAmount: null,
    highHandRakeType: "none",
    highHandRakeAmount: "0.00",
    highHandPayouts: 1,
    enableLateRegistration: false,
    trackPoints: false,
    minPlayers: 2,
    maxPlayers: 40,
    prizePoolLocked: false,
    prizePoolLockedAt: null,
    manualPrizePool: null,
    rakeOverride: null,
    prizePoolAdjustmentReason: null,
    prizePoolAdjustedAt: null,
    finalizedAt: null,
    useClubAddress: true,
    address: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    prizePoolSnapshot: null,
    viewer: VISITOR_VIEW,
    ...overrides,
  };
}

/** What finalize froze: a $475 pool ($25 AP from $500 of buy-ins), the standard 50/30/20 for three entrants. */
export function prizePoolSnapshotDto(overrides: Partial<PrizePoolSnapshot> = {}): PrizePoolSnapshot {
  return {
    v: FINALIZE_SNAPSHOT_VERSION,
    algorithm: PAYOUT_ALGORITHM,
    finalizedAt: "2026-10-23T11:00:00.000Z",
    entrants: 3,
    finishOrderSource: "explicit",
    pool: {
      grossCents: 50_000,
      rakeCalculatedCents: 2_500,
      rakeOverrideCents: null,
      manualPrizePoolCents: null,
      netCents: 47_500,
      netSource: "calculated",
      impliedRakeCents: 2_500,
      structure: { requested: "standard", used: "standard", basisPoints: [5000, 3000, 2000] },
    },
    paid: [],
    warnings: [],
    ...overrides,
  };
}

/** A row of GET /api/tournaments: the tournament's public fields and its counts. */
export function tournamentListItemDto(overrides: Partial<TournamentListItemDto> = {}): TournamentListItemDto {
  const { viewer: _viewer, prizePoolSnapshot: _snapshot, ...tournament } = tournamentDto();
  return { ...tournament, confirmedPlayerCount: null, registeredCount: 0, ...overrides };
}

/** One entry with one buy-in, still in. */
export function registrationDto(id: string, name: string, overrides: Partial<PublicRegistration> = {}): PublicRegistration {
  return {
    id,
    tournamentId: "t1",
    playerId: `p-${id}`,
    registrationTime: "2026-10-23T06:30:00.000Z",
    buyIns: 1,
    rebuys: 0,
    addons: 0,
    finalPosition: null,
    prizeAmount: null,
    pointsAwarded: null,
    isEliminated: false,
    eliminationTime: null,
    eliminatedBy: null,
    knockouts: 0,
    enteringHighHands: false,
    highHandWinner: false,
    highHandAmount: null,
    earlyBird: false,
    player: { id: `p-${id}`, name, imageUrl: null },
    ...overrides,
  };
}

export function pendingActionDto(id: string, actionType: string, overrides: Partial<PendingActionDto> = {}): PendingActionDto {
  return {
    id,
    tournamentId: "t1",
    playerId: "p1",
    actionType,
    targetPlayerId: null,
    timestamp: "2026-10-23T08:00:00.000Z",
    player: { id: "p1", name: "Ann", imageUrl: null },
    targetPlayer: null,
    ...overrides,
  };
}

/** A season as the date boxes save it: days at midnight UTC. */
export function seasonDto(overrides: Partial<PublicSeason> = {}): PublicSeason {
  return {
    id: "s1",
    name: "Summer 2026",
    clubId: "c1",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: null,
    isActive: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function pointsSystemDto(overrides: Partial<PublicPointsSystem> = {}): PublicPointsSystem {
  return {
    id: "ps1",
    seasonId: "s1",
    name: "Standard Points",
    description: null,
    participationPoints: 0,
    knockoutPoints: 0,
    createdAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

export function pointsAllocationDto(overrides: Partial<PublicPointsAllocation> = {}): PublicPointsAllocation {
  return { id: "a1", pointsSystemId: "ps1", position: 1, positionEnd: null, points: 100, description: null, ...overrides };
}

export function leaderboardEntryDto(rank: number, name: string, points: number, overrides: Partial<LeaderboardEntryDto> = {}): LeaderboardEntryDto {
  return { rank, player: { id: `p-${name.toLowerCase().replace(/\s+/g, "-")}`, name, imageUrl: null }, points, tournaments: 1, ...overrides };
}

export function clubStaffDto(overrides: Partial<ClubStaffDto> = {}): ClubStaffDto {
  return { clubId: "c1", owner: null, managers: [], invites: [], ...overrides };
}

export function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    name: "Tess TD",
    email: "tess@club.test",
    phone: null,
    imageUrl: null,
    role: "full_member",
    isActive: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function clubPlayer(overrides: Partial<Extract<ClubPlayer, { canEdit: true }>> = {}): ClubPlayer {
  return {
    id: "p1-0000-0000",
    name: "Aroha Smith",
    email: "aroha@example.com",
    phone: "021 555 0101",
    imageUrl: null,
    createdAt: "2026-03-04T05:00:00.000Z",
    canEdit: true,
    ...overrides,
  };
}

export function visitingPlayer(overrides: Partial<Extract<ClubPlayer, { canEdit: false }>> = {}): ClubPlayer {
  return {
    id: "p9-0000-0000",
    name: "Vic Visitor",
    email: null,
    phone: null,
    imageUrl: null,
    createdAt: "2026-03-04T05:00:00.000Z",
    canEdit: false,
    ...overrides,
  };
}

export type AccountRow = Extract<AdminUserRow, { type: "user" }>;
export type PlayerRow = Extract<AdminUserRow, { type: "player" }>;

export function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    type: "user",
    id: "u2",
    name: "Olly Owner",
    email: "olly@club.test",
    phone: null,
    role: "full_member",
    isActive: true,
    lastLoginAt: "2026-10-01T02:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function playerRow(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    type: "player",
    id: "p1",
    name: "Aroha Smith",
    email: "aroha@example.com",
    phone: "021 555 0101",
    role: "club_member",
    isActive: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    ...overrides,
  };
}
