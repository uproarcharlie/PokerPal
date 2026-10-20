import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, boolean, timestamp, index, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { PrizePoolSnapshot } from "./api/finalize"; // type-only: no runtime import cycle
import { PAYOUT_STRUCTURE_KEYS } from "./domain/payouts";

// Clubs table
export const clubs = pgTable("clubs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  imageUrl: text("image_url"),
  timezone: text("timezone"), // Auto-detected from address
  address: text("address"),
  discordUrl: text("discord_url"),
  twitterUrl: text("twitter_url"),
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  websiteUrl: text("website_url"),
  rakeLabel: text("rake_label"), // The club's name for its rake, e.g. "AP"; null or blank shows "Rake". Display only.
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }), // Club owner
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  ownerIdx: index("idx_clubs_owner_id").on(table.ownerId),
}));

// Seasons table
export const seasons = pgTable("seasons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  clubId: varchar("club_id").references(() => clubs.id, { onDelete: "cascade" }).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  clubIdx: index("idx_seasons_club_id").on(table.clubId),
}));

// Users table - Full members with authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  imageUrl: text("image_url"),
  role: text("role").notNull().default("full_member"), // admin, full_member
  isActive: boolean("is_active").default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Players table - Club members (no auth required)
export const players = pgTable("players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  imageUrl: text("image_url"),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Link to user if they upgrade to full member
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userIdx: index("idx_players_user_id").on(table.userId),
  emailIdx: index("idx_players_email").on(table.email),
}));

/**
 * Each player's home club: the club that added them, else the club of their first surviving
 * registration, recorded once and never changed (migrations/0003). It decides who sees the player's contact details and may edit them. club_id has
 * no foreign key: a deleted club leaves the row, and the player is then admins' only.
 */
export const playerHomeClubs = pgTable("player_home_clubs", {
  playerId: varchar("player_id").primaryKey().references(() => players.id, { onDelete: "cascade" }),
  clubId: varchar("club_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => ({
  clubIdx: index("idx_player_home_clubs_club_id").on(table.clubId),
}));

// Tournaments table
export const tournaments = pgTable("tournaments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  clubId: varchar("club_id").references(() => clubs.id, { onDelete: "cascade" }).notNull(),
  seasonId: varchar("season_id").references(() => seasons.id, { onDelete: "set null" }),
  pointsSystemId: varchar("points_system_id").references(() => pointsSystems.id, { onDelete: "set null" }),
  startDateTime: timestamp("start_date_time").notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled, registration, in_progress, completed, cancelled
  buyInAmount: decimal("buy_in_amount", { precision: 10, scale: 2 }).notNull(),
  rebuyAmount: decimal("rebuy_amount", { precision: 10, scale: 2 }),
  addonAmount: decimal("addon_amount", { precision: 10, scale: 2 }),
  maxRebuys: integer("max_rebuys"),
  rebuyPeriodMinutes: integer("rebuy_period_minutes"),
  rakeType: text("rake_type").notNull().default("none"), // percentage, fixed, none
  rakeAmount: decimal("rake_amount", { precision: 10, scale: 2 }).default("0"),
  rebuyRakeType: text("rebuy_rake_type").default("none"), // percentage, fixed, none
  rebuyRakeAmount: decimal("rebuy_rake_amount", { precision: 10, scale: 2 }).default("0"),
  addonRakeType: text("addon_rake_type").default("none"), // percentage, fixed, none
  addonRakeAmount: decimal("addon_rake_amount", { precision: 10, scale: 2 }).default("0"),
  payoutStructure: text("payout_structure").notNull().default("standard"), // standard, top3, top5, top8, top9, custom
  customPayouts: text("custom_payouts"), // JSON string for custom payout percentages
  enableHighHand: boolean("enable_high_hand").default(false),
  highHandAmount: decimal("high_hand_amount", { precision: 10, scale: 2 }),
  highHandRakeType: text("high_hand_rake_type").default("none"), // percentage, fixed, none
  highHandRakeAmount: decimal("high_hand_rake_amount", { precision: 10, scale: 2 }).default("0"),
  highHandPayouts: integer("high_hand_payouts").default(1), // 1-4 payouts
  enableLateRegistration: boolean("enable_late_registration").default(false),
  trackPoints: boolean("track_points").default(true),
  minPlayers: integer("min_players").default(8),
  maxPlayers: integer("max_players").notNull(),
  prizePoolLocked: boolean("prize_pool_locked").default(false),
  prizePoolLockedAt: timestamp("prize_pool_locked_at"),
  manualPrizePool: decimal("manual_prize_pool", { precision: 10, scale: 2 }),
  // Manual AP total for the main pool (replaces buy-in, re-buy and add-on rake together); null => calculated.
  rakeOverride: decimal("rake_override", { precision: 10, scale: 2 }),
  prizePoolAdjustmentReason: text("prize_pool_adjustment_reason"),
  prizePoolAdjustedAt: timestamp("prize_pool_adjusted_at", { withTimezone: true, mode: "date" }),
  prizePoolAdjustedBy: varchar("prize_pool_adjusted_by"), // users.id, audit text (no FK)
  prizePoolSnapshot: jsonb("prize_pool_snapshot").$type<PrizePoolSnapshot>(), // written only by finalize
  finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "date" }),
  finalizedBy: varchar("finalized_by"), // users.id, audit text (no FK)
  useClubAddress: boolean("use_club_address").default(true),
  address: text("address"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  clubIdx: index("idx_tournaments_club_id").on(table.clubId),
  seasonIdx: index("idx_tournaments_season_id").on(table.seasonId),
  pointsSystemIdx: index("idx_tournaments_points_system_id").on(table.pointsSystemId),
}));

// Tournament registrations
export const tournamentRegistrations = pgTable("tournament_registrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: varchar("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  playerId: varchar("player_id").references(() => players.id, { onDelete: "cascade" }).notNull(),
  registrationTime: timestamp("registration_time").defaultNow(),
  buyIns: integer("buy_ins").default(1),
  rebuys: integer("rebuys").default(0),
  addons: integer("addons").default(0),
  finalPosition: integer("final_position"),
  prizeAmount: decimal("prize_amount", { precision: 10, scale: 2 }),
  pointsAwarded: integer("points_awarded"),
  isEliminated: boolean("is_eliminated").default(false),
  eliminationTime: timestamp("elimination_time"),
  eliminatedBy: varchar("eliminated_by").references(() => players.id, { onDelete: "set null" }),
  knockouts: integer("knockouts").default(0),
  enteringHighHands: boolean("entering_high_hands").default(false),
  paymentConfirmed: boolean("payment_confirmed").default(false),
  highHandWinner: boolean("high_hand_winner").default(false),
  highHandAmount: decimal("high_hand_amount", { precision: 10, scale: 2 }),
}, (table) => ({
  tournamentIdx: index("idx_tournament_registrations_tournament_id").on(table.tournamentId),
  playerIdx: index("idx_tournament_registrations_player_id").on(table.playerId),
  eliminatedByIdx: index("idx_tournament_registrations_eliminated_by").on(table.eliminatedBy),
}));

// Points systems
export const pointsSystems = pgTable("points_systems", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").references(() => seasons.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  participationPoints: integer("participation_points").default(0),
  knockoutPoints: integer("knockout_points").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  seasonIdx: index("idx_points_systems_season_id").on(table.seasonId),
}));

// Points allocations
export const pointsAllocations = pgTable("points_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pointsSystemId: varchar("points_system_id").references(() => pointsSystems.id, { onDelete: "cascade" }).notNull(),
  position: integer("position").notNull(), // Can be range like 4 for positions 4-10
  positionEnd: integer("position_end"), // For position ranges
  points: integer("points").notNull(),
  description: text("description"),
}, (table) => ({
  pointsSystemIdx: index("idx_points_allocations_points_system_id").on(table.pointsSystemId),
}));

// Pending actions
export const pendingActions = pgTable("pending_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: varchar("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  playerId: varchar("player_id").references(() => players.id, { onDelete: "cascade" }).notNull(),
  actionType: text("action_type").notNull(), // rebuy, addon, knockout
  targetPlayerId: varchar("target_player_id").references(() => players.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").defaultNow(),
}, (table) => ({
  tournamentIdx: index("idx_pending_actions_tournament_id").on(table.tournamentId),
  playerIdx: index("idx_pending_actions_player_id").on(table.playerId),
  targetPlayerIdx: index("idx_pending_actions_target_player_id").on(table.targetPlayerId),
}));

// Activity log
export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: varchar("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  playerId: varchar("player_id").references(() => players.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // registration, elimination, rebuy, addon, status_change, payment_confirmed, player_restored
  eventData: text("event_data"), // JSON string for additional event details
  description: text("description").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => ({
  // Matches listActivity (server/repositories/activity.ts): WHERE tournament_id = ? ORDER BY timestamp DESC, id DESC
  tournamentTimeIdx: index("idx_activity_log_tournament_id_timestamp").on(table.tournamentId, table.timestamp),
}));

// Users who may manage a club besides its owner (clubs.ownerId)
export const clubManagers = pgTable("club_managers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clubId: varchar("club_id").references(() => clubs.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull().default("manager"), // manager
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdBy: varchar("created_by"), // users.id, audit text (no FK)
}, (table) => ({
  clubUserUq: unique("uq_club_managers_club_user").on(table.clubId, table.userId),
  userIdx: index("idx_club_managers_user_id").on(table.userId),
}));

/**
 * Invitations to a club's staff (migrations/0004, SEC-P2REV-03): a role is granted only when the
 * person invited opens the link's secret and accepts, signed in to the account that uses `email`.
 * Only the secret's sha256 is stored. Open while not accepted, revoked or expired.
 */
export const clubStaffInvites = pgTable("club_staff_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clubId: varchar("club_id").references(() => clubs.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(), // manager | owner
  email: text("email").notNull(), // trimmed and lower-cased
  tokenHash: text("token_hash").notNull(), // sha256 of the link's secret, hex
  createdBy: varchar("created_by"), // users.id, audit text (no FK)
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  acceptedBy: varchar("accepted_by"), // users.id (no FK)
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (table) => ({
  tokenHashUq: unique("uq_club_staff_invites_token_hash").on(table.tokenHash),
  clubIdx: index("idx_club_staff_invites_club_id").on(table.clubId),
}));

// Staff and admin actions, for accountability. Never served publicly; no FKs, so rows outlive their subjects.
export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id"),
  action: text("action").notNull(), // e.g. impersonation.start, user.update, prize_pool.adjust, tournament.finalize
  targetType: text("target_type"),
  targetId: varchar("target_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("idx_audit_log_created_at").on(table.createdAt),
  actorIdx: index("idx_audit_log_actor_user_id").on(table.actorUserId),
  targetIdx: index("idx_audit_log_target").on(table.targetType, table.targetId),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users, {
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "full_member"]).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
});

export const insertClubSchema = createInsertSchema(clubs).omit({
  id: true,
  createdAt: true,
});

export const insertSeasonSchema = createInsertSchema(seasons, {
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
}).omit({
  id: true,
  createdAt: true,
});

export const insertPlayerSchema = createInsertSchema(players).omit({
  id: true,
  createdAt: true,
});

export const insertTournamentSchema = createInsertSchema(tournaments, {
  startDateTime: z.coerce.date(),
  prizePoolLockedAt: z.coerce.date().optional().nullable(),
  buyInAmount: z.union([z.string(), z.number()]).transform(val => String(val)),
  rebuyAmount: z.union([z.string(), z.number(), z.null()]).transform(val => val === null ? null : String(val)).optional().nullable(),
  addonAmount: z.union([z.string(), z.number(), z.null()]).transform(val => val === null ? null : String(val)).optional().nullable(),
  rakeAmount: z.union([z.string(), z.number(), z.null()]).transform(val => val === null ? null : String(val)).optional().nullable(),
  rebuyRakeAmount: z.union([z.string(), z.number(), z.null()]).transform(val => val === null ? null : String(val)).optional().nullable(),
  addonRakeAmount: z.union([z.string(), z.number(), z.null()]).transform(val => val === null ? null : String(val)).optional().nullable(),
  highHandAmount: z.union([z.string(), z.number(), z.null()]).transform(val => val === null ? null : String(val)).optional().nullable(),
  highHandRakeAmount: z.union([z.string(), z.number(), z.null()]).transform(val => val === null ? null : String(val)).optional().nullable(),
  rakeType: z.enum(["none", "percentage", "fixed"]).optional(),
  rebuyRakeType: z.enum(["none", "percentage", "fixed"]).optional(),
  addonRakeType: z.enum(["none", "percentage", "fixed"]).optional(),
  highHandRakeType: z.enum(["none", "percentage", "fixed"]).optional(),
  payoutStructure: z.enum(PAYOUT_STRUCTURE_KEYS).optional(),
  status: z.string().optional(),
  enableHighHand: z.boolean().optional(),
  enableLateRegistration: z.boolean().optional(),
  trackPoints: z.boolean().optional(),
}).omit({
  id: true,
  createdAt: true,
  // Written only by the prize-pool adjustment and finalize services, never from a request body.
  rakeOverride: true,
  prizePoolAdjustmentReason: true,
  prizePoolAdjustedAt: true,
  prizePoolAdjustedBy: true,
  prizePoolSnapshot: true,
  finalizedAt: true,
  finalizedBy: true,
});

export const insertTournamentRegistrationSchema = createInsertSchema(tournamentRegistrations, {
  eliminationTime: z.coerce.date().optional().nullable(),
  eliminatedBy: z.string().optional().nullable(),
}).omit({
  id: true,
  registrationTime: true,
});

export const insertPointsSystemSchema = createInsertSchema(pointsSystems).omit({
  id: true,
  createdAt: true,
});

export const insertPointsAllocationSchema = createInsertSchema(pointsAllocations).omit({
  id: true,
});

export const insertPendingActionSchema = createInsertSchema(pendingActions).omit({
  id: true,
  timestamp: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({
  id: true,
  timestamp: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Club = typeof clubs.$inferSelect;
export type InsertClub = z.infer<typeof insertClubSchema>;

export type Season = typeof seasons.$inferSelect;
export type InsertSeason = z.infer<typeof insertSeasonSchema>;

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;

export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = z.infer<typeof insertTournamentSchema>;

export type TournamentRegistration = typeof tournamentRegistrations.$inferSelect;
export type InsertTournamentRegistration = z.infer<typeof insertTournamentRegistrationSchema>;

export type PointsSystem = typeof pointsSystems.$inferSelect;
export type InsertPointsSystem = z.infer<typeof insertPointsSystemSchema>;

export type PointsAllocation = typeof pointsAllocations.$inferSelect;
export type InsertPointsAllocation = z.infer<typeof insertPointsAllocationSchema>;

export type PendingAction = typeof pendingActions.$inferSelect;
export type InsertPendingAction = z.infer<typeof insertPendingActionSchema>;

export type ActivityLog = typeof activityLog.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

export type ClubManager = typeof clubManagers.$inferSelect;
export type InsertClubManager = typeof clubManagers.$inferInsert;

export type ClubStaffInvite = typeof clubStaffInvites.$inferSelect;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = typeof auditLog.$inferInsert;
