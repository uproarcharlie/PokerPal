import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }), // Club owner
  createdAt: timestamp("created_at").defaultNow(),
});

// Seasons table
export const seasons = pgTable("seasons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  clubId: varchar("club_id").references(() => clubs.id, { onDelete: "cascade" }).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

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
});

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
  useClubAddress: boolean("use_club_address").default(true),
  address: text("address"),
  createdAt: timestamp("created_at").defaultNow(),
});

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
});

// Points systems
export const pointsSystems = pgTable("points_systems", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").references(() => seasons.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  participationPoints: integer("participation_points").default(0),
  knockoutPoints: integer("knockout_points").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Points allocations
export const pointsAllocations = pgTable("points_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pointsSystemId: varchar("points_system_id").references(() => pointsSystems.id, { onDelete: "cascade" }).notNull(),
  position: integer("position").notNull(), // Can be range like 4 for positions 4-10
  positionEnd: integer("position_end"), // For position ranges
  points: integer("points").notNull(),
  description: text("description"),
});

// Pending actions
export const pendingActions = pgTable("pending_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: varchar("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  playerId: varchar("player_id").references(() => players.id, { onDelete: "cascade" }).notNull(),
  actionType: text("action_type").notNull(), // rebuy, addon, knockout
  targetPlayerId: varchar("target_player_id").references(() => players.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Activity log
export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: varchar("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  playerId: varchar("player_id").references(() => players.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // registration, elimination, rebuy, addon, status_change, payment_confirmed, player_restored
  eventData: text("event_data"), // JSON string for additional event details
  description: text("description").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true, mode: 'string' }).defaultNow(),
});

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
  payoutStructure: z.enum(["standard", "top3", "top5", "top8", "top9", "custom"]).optional(),
  status: z.string().optional(),
  enableHighHand: z.boolean().optional(),
  enableLateRegistration: z.boolean().optional(),
  trackPoints: z.boolean().optional(),
}).omit({
  id: true,
  createdAt: true,
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
