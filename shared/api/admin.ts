/** /api/admin/*: platform admins only (users.role = 'admin', read from the database on every request). */
import { z } from "zod";
import type { PrizePoolSnapshot } from "../domain/finalize";
import type { Cents } from "../domain/money";
import type { NetSource } from "../domain/prize-pool";
import type { AuditLogEntry, TournamentRegistration } from "../schema";
import { dateSchema, limitSchema, requiredText, type Json } from "./common";
import { accountEmailSchema, phoneSchema, type SessionUser } from "./auth";

export const USER_ROLES = ["admin", "full_member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * PUT /api/admin/users/:userId. Every field is optional and an absent one keeps the stored value
 * (today a missing phone wipes it: SEC-14). A changed email must be well-formed; the unchanged one is
 * accepted as stored. An admin cannot demote or deactivate themselves, and the last active admin
 * cannot be demoted or deactivated (409 LAST_ADMIN).
 */
export const adminUpdateUserSchema = z
  .object({
    name: requiredText(100).optional(),
    email: accountEmailSchema.optional(),
    phone: phoneSchema,
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), "Nothing to update");
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

/** GET /api/admin/users: accounts and players in one list, newest first (today's shape, kept). */
export type AdminUserRow =
  | {
      type: "user";
      id: string;
      name: string;
      email: string;
      phone: string | null;
      role: UserRole;
      isActive: boolean | null;
      lastLoginAt: string | null;
      createdAt: string | null;
    }
  | {
      type: "player";
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      role: "club_member";
      isActive: true;
      lastLoginAt: null;
      createdAt: string | null;
      /** The account this player was linked to, if any. Admin-only. */
      userId: string | null;
    };

/** PUT /api/admin/users/:userId (200). Never contains the password hash. */
export interface AdminUpdateUserResponse {
  message: string;
  user: SessionUser;
}

/** POST /api/admin/users/:userId/impersonate and POST /api/admin/stop-impersonation (200). */
export interface ImpersonationResponse {
  message: string;
  user: SessionUser;
}

/** GET /api/admin/audit-log: newest first; `before` pages backwards by created_at. */
export const auditLogQuerySchema = z.object({
  limit: limitSchema(100, 500),
  before: dateSchema.optional(),
  actorUserId: z.string().trim().min(1).max(64).optional(),
  targetType: z.string().trim().min(1).max(40).optional(),
  targetId: z.string().trim().min(1).max(64).optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export type AuditLogEntryDto = Json<AuditLogEntry>;

/**
 * audit_log.action values. Written in the same transaction as the change they record. Each one's
 * `data` is typed in `AuditData`; `ip` is clientIp(req).
 */
export const AUDIT_ACTIONS = [
  "user.update",
  "impersonation.start", // actor = admin, target = user
  "impersonation.stop",
  "club.owner_set",
  "club.manager_added",
  "club.manager_removed",
  "club.invite_created",
  "club.invite_revoked",
  "club.delete",
  "season.delete",
  "tournament.delete",
  "prize_pool.adjust",
  "prize_pool.rates",
  "tournament.finalize",
  "tournament.refinalize",
  "player.update",
  "registration.remove",
  "pending_action.dismiss",
  "high_hand.split", // target = tournament
  "seed_club_owner", // boot seed (server/db/seeds.ts), actor NULL
  "seed_player_home_clubs", // boot seed, actor NULL
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The before/after of the fields a change touched, keyed by field. */
type FieldChanges = { before: Record<string, unknown>; after: Record<string, unknown> };

/** What finalize records about the pool it paid. */
type FinalizedPool = {
  netCents: Cents;
  netSource: NetSource;
  planHash: string;
  /** Player requests still waiting that finalize discarded. */
  requestsCleared: number;
};

/**
 * Each audit action's `data`, as its writer records it (null: none), so a disputed payout or staff
 * change can be read back from the log by these names (P2REV4-CQ2-04). While an admin impersonates
 * someone, `recordAudit` adds `asUserId` (the impersonated user) to it.
 */
export type AuditData = {
  /** `via: "profile"` for the user's own edit. */
  "user.update": FieldChanges & { via?: "profile" };
  "impersonation.start": null;
  "impersonation.stop": { startedAt: string | null; endedBy: "stop" | "sign-out" | "sign-in"; restored: boolean };
  /** `inviteId` when the new owner accepted an owner invitation. */
  "club.owner_set": { previousOwnerId: string | null; ownerId: string | null; inviteId?: string };
  /** `inviteId`: the invitation they accepted. */
  "club.manager_added": { userId: string; inviteId: string };
  "club.manager_removed": { userId: string };
  "club.invite_created": { inviteId: string; role: string; email: string; expiresAt: string };
  "club.invite_revoked": { inviteId: string; role: string; email: string };
  "club.delete": { name: string; slug: string; imageUrl: string | null; tournamentImageUrls: string[] };
  "season.delete": { name: string; clubId: string };
  "tournament.delete": { name: string; clubId: string; status: string; imageUrl: string | null };
  "prize_pool.adjust": {
    mode: "calculated" | "ap_override" | "manual_pool";
    /** The amount set, null when going back to the calculated pool. */
    amountCents: Cents | null;
    reason: string | null;
    previous: { manualPrizePool: string | null; rakeOverride: string | null; reason: string | null };
    netCentsBefore: Cents;
    netCentsAfter: Cents;
  };
  /** The AP rate columns before and after, and whether the manual AP total was cleared. */
  "prize_pool.rates": FieldChanges & { clearedOverride: boolean; reason: string | null };
  "tournament.finalize": FinalizedPool;
  /** What the correction overwrote: the previous snapshot in full and every registration's previous result. */
  "tournament.refinalize": FinalizedPool & {
    previous: {
      finalizedAt: string | null;
      snapshot: PrizePoolSnapshot | null;
      results: Array<{
        registrationId: string;
        playerId: string;
        finalPosition: number | null;
        prizeAmount: string | null;
        pointsAwarded: number | null;
      }>;
    };
  };
  /** The changed name, phone, email and photo. */
  "player.update": FieldChanges;
  /** The whole registration row as it was. */
  "registration.remove": { tournamentId: string; playerName: string; requestsRemoved: number; registration: TournamentRegistration };
  /** target = tournament: the request staff dismissed without applying it. */
  "pending_action.dismiss": { actionId: string; actionType: string; playerId: string; targetPlayerId: string | null; requestedAt: string | null };
  "high_hand.split": {
    registrationId: string;
    splitWithRegistrationId: string;
    shareCents: Cents;
    keepCents: Cents;
    highHandPayouts: { before: number; after: number };
  };
  "seed_club_owner": { previousOwnerId: null; ownerId: string; email: string };
  /** How many players were given a home club. */
  "seed_player_home_clubs": { recorded: number };
};
