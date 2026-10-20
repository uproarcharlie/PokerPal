/**
 * Every query key the client uses, from one factory, so a key is spelled once and invalidation by
 * prefix always reaches what it means to: `qk.tournaments.detail(id)` is the prefix of that
 * tournament's registrations, activity, prize pool and staff lists, so invalidating it refreshes all
 * of them. Keys name resources, never URLs: each feature's `api.ts` pairs a key with its fetcher.
 *
 * Filters are part of a list's key as an object (TanStack Query compares keys structurally), with
 * undefined fields dropped so `{}` and `{ clubId: undefined }` are the same list.
 */
import type { AuditLogQuery } from "@shared/api/admin";
import type { ClubsQuery } from "@shared/api/clubs";
import type { FinalizePreviewInput } from "@shared/api/finalize";
import type { PlayersQuery } from "@shared/api/players";
import type { TournamentsQuery } from "@shared/api/tournaments";

/** A filter object without its undefined fields, so equal filters make equal keys. */
function filter<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

export const qk = {
  auth: {
    /** GET /api/auth/me */
    me: () => ["auth", "me"] as const,
  },

  admin: {
    all: () => ["admin"] as const,
    /** GET /api/admin/users */
    users: () => ["admin", "users"] as const,
    /** GET /api/admin/audit-log */
    auditLog: (query?: Partial<AuditLogQuery>) => ["admin", "audit-log", filter(query)] as const,
  },

  clubs: {
    all: () => ["clubs"] as const,
    lists: () => ["clubs", "list"] as const,
    /** GET /api/clubs */
    list: (query?: ClubsQuery) => ["clubs", "list", filter(query)] as const,
    /** GET /api/clubs/:id */
    detail: (id: string) => ["clubs", "detail", id] as const,
    /** GET /api/clubs/slug/:slug (slugs ignore case on the server, so the key does too) */
    bySlug: (slug: string) => ["clubs", "slug", slug.toLowerCase()] as const,
    /** GET /api/clubs/member-counts */
    memberCounts: () => ["clubs", "member-counts"] as const,
    /** GET /api/clubs/:id/members-count */
    membersCount: (id: string) => ["clubs", "detail", id, "members-count"] as const,
    /** GET /api/clubs/:id/managers (owner or admin): staff and open invitations */
    staff: (id: string) => ["clubs", "detail", id, "staff"] as const,
  },

  seasons: {
    all: () => ["seasons"] as const,
    lists: () => ["seasons", "list"] as const,
    /** GET /api/seasons?clubId= */
    list: (query?: { clubId?: string }) => ["seasons", "list", filter(query)] as const,
    /** GET /api/seasons/:id */
    detail: (id: string) => ["seasons", "detail", id] as const,
    /** GET /api/seasons/:id/leaderboard */
    leaderboard: (id: string) => ["seasons", "detail", id, "leaderboard"] as const,
    /** GET /api/seasons/:id/points-systems */
    pointsSystems: (id: string) => ["seasons", "detail", id, "points-systems"] as const,
  },

  pointsSystems: {
    all: () => ["points-systems"] as const,
    /** GET /api/points-systems/:id */
    detail: (id: string) => ["points-systems", "detail", id] as const,
    /** GET /api/points-systems/:id/allocations */
    allocations: (id: string) => ["points-systems", "detail", id, "allocations"] as const,
  },

  players: {
    all: () => ["players"] as const,
    /** GET /api/players?clubId=&q= (staff) */
    list: (query?: PlayersQuery) => ["players", "list", filter(query)] as const,
  },

  tournaments: {
    all: () => ["tournaments"] as const,
    lists: () => ["tournaments", "list"] as const,
    /** GET /api/tournaments?clubId=&seasonId=&status=&upcoming=&limit= */
    list: (query?: TournamentsQuery) => ["tournaments", "list", filter(query)] as const,
    /** GET /api/tournaments/counts: under `lists()`, so a created or deleted tournament refreshes it too */
    counts: () => ["tournaments", "list", "counts"] as const,
    /** GET /api/tournaments/:id; the prefix of everything below */
    detail: (id: string) => ["tournaments", "detail", id] as const,
    /** GET /api/tournaments/:id/registrations */
    registrations: (id: string) => ["tournaments", "detail", id, "registrations"] as const,
    /** GET /api/tournaments/:id/activity */
    activity: (id: string, query?: { limit?: number }) => ["tournaments", "detail", id, "activity", filter(query)] as const,
    /** GET /api/tournaments/:id/prize-pool */
    prizePool: (id: string) => ["tournaments", "detail", id, "prize-pool"] as const,
    /** GET /api/tournaments/:id/pending-registrations (staff) */
    pendingRegistrations: (id: string) => ["tournaments", "detail", id, "pending-registrations"] as const,
    /** GET /api/tournaments/:id/confirmed-registrations (staff) */
    confirmedRegistrations: (id: string) => ["tournaments", "detail", id, "confirmed-registrations"] as const,
    /** GET /api/tournaments/:id/pending-actions (staff) */
    pendingActions: (id: string) => ["tournaments", "detail", id, "pending-actions"] as const,
    /** GET /api/public/tournaments/:id/players?q= (the QR page's "find yourself" search) */
    playerSearch: (id: string, q: string) => ["tournaments", "detail", id, "player-search", q.trim().toLowerCase()] as const,
  },

  /**
   * POST /api/tournaments/:id/finalize/preview, read as a query by the finalize dialog. Its own root:
   * invalidating a tournament after a finalize must not re-preview it (the answer would be "already
   * finalized" while the dialog shows the result).
   */
  finalizePreview: (id: string, input: FinalizePreviewInput) => ["finalize-preview", id, input] as const,

  dashboard: {
    /** GET /api/dashboard/stats */
    stats: () => ["dashboard", "stats"] as const,
  },
} as const;
