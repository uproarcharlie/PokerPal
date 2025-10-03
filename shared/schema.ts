import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Clubs table
export const clubs = pgTable("clubs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Seasons table
export const seasons = pgTable("seasons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  clubId: varchar("club_id").references(() => clubs.id).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Players table
export const players = pgTable("players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Tournaments table
export const tournaments = pgTable("tournaments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  clubId: varchar("club_id").references(() => clubs.id).notNull(),
  seasonId: varchar("season_id").references(() => seasons.id),
  startDateTime: timestamp("start_date_time").notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled, registration, in_progress, completed, cancelled
  buyInAmount: decimal("buy_in_amount", { precision: 10, scale: 2 }).notNull(),
  rebuyAmount: decimal("rebuy_amount", { precision: 10, scale: 2 }),
  addonAmount: decimal("addon_amount", { precision: 10, scale: 2 }),
  maxRebuys: integer("max_rebuys"),
  rebuyPeriodMinutes: integer("rebuy_period_minutes"),
  rakeType: text("rake_type").notNull().default("none"), // percentage, fixed, none
  rakeAmount: decimal("rake_amount", { precision: 10, scale: 2 }).default("0"),
  payoutStructure: text("payout_structure").notNull().default("standard"), // standard, top3, top5, custom
  customPayouts: text("custom_payouts"), // JSON string for custom payout percentages
  enableHighHand: boolean("enable_high_hand").default(false),
  highHandAmount: decimal("high_hand_amount", { precision: 10, scale: 2 }),
  enableLateRegistration: boolean("enable_late_registration").default(false),
  trackPoints: boolean("track_points").default(true),
  minPlayers: integer("min_players").default(8),
  maxPlayers: integer("max_players").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Tournament registrations
export const tournamentRegistrations = pgTable("tournament_registrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: varchar("tournament_id").references(() => tournaments.id).notNull(),
  playerId: varchar("player_id").references(() => players.id).notNull(),
  registrationTime: timestamp("registration_time").defaultNow(),
  buyIns: integer("buy_ins").default(1),
  rebuys: integer("rebuys").default(0),
  addons: integer("addons").default(0),
  finalPosition: integer("final_position"),
  prizeAmount: decimal("prize_amount", { precision: 10, scale: 2 }),
  pointsAwarded: integer("points_awarded"),
  isEliminated: boolean("is_eliminated").default(false),
  eliminationTime: timestamp("elimination_time"),
});

// Points systems
export const pointsSystems = pgTable("points_systems", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seasonId: varchar("season_id").references(() => seasons.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  participationPoints: integer("participation_points").default(0),
  knockoutPoints: integer("knockout_points").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Points allocations
export const pointsAllocations = pgTable("points_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pointsSystemId: varchar("points_system_id").references(() => pointsSystems.id).notNull(),
  position: integer("position").notNull(), // Can be range like 4 for positions 4-10
  positionEnd: integer("position_end"), // For position ranges
  points: integer("points").notNull(),
  description: text("description"),
});

// Insert schemas
export const insertClubSchema = createInsertSchema(clubs).omit({
  id: true,
  createdAt: true,
});

export const insertSeasonSchema = createInsertSchema(seasons).omit({
  id: true,
  createdAt: true,
});

export const insertPlayerSchema = createInsertSchema(players).omit({
  id: true,
  createdAt: true,
});

export const insertTournamentSchema = createInsertSchema(tournaments).omit({
  id: true,
  createdAt: true,
});

export const insertTournamentRegistrationSchema = createInsertSchema(tournamentRegistrations).omit({
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

// Types
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
