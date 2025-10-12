import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  clubs, seasons, players, tournaments, tournamentRegistrations,
  pointsSystems, pointsAllocations, pendingActions, activityLog, users,
  type Club, type InsertClub,
  type Season, type InsertSeason,
  type Player, type InsertPlayer,
  type Tournament, type InsertTournament,
  type TournamentRegistration, type InsertTournamentRegistration,
  type PointsSystem, type InsertPointsSystem,
  type PointsAllocation, type InsertPointsAllocation,
  type PendingAction, type InsertPendingAction,
  type ActivityLog, type InsertActivityLog,
  type User
} from "@shared/schema";

export interface IStorage {
  // Clubs
  getClub(id: string): Promise<Club | undefined>;
  getClubs(): Promise<Club[]>;
  createClub(club: InsertClub): Promise<Club>;
  updateClub(id: string, club: Partial<InsertClub>): Promise<Club | undefined>;
  deleteClub(id: string): Promise<boolean>;
  getClubMembersCount(clubId: string): Promise<number>;

  // Seasons
  getSeason(id: string): Promise<Season | undefined>;
  getSeasons(): Promise<Season[]>;
  getSeasonsByClub(clubId: string): Promise<Season[]>;
  createSeason(season: InsertSeason): Promise<Season>;
  updateSeason(id: string, season: Partial<InsertSeason>): Promise<Season | undefined>;
  deleteSeason(id: string): Promise<boolean>;

  // Players
  getPlayer(id: string): Promise<Player | undefined>;
  getPlayers(): Promise<Player[]>;
  getPlayerByEmail(email: string): Promise<Player | undefined>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayer(id: string, player: Partial<InsertPlayer>): Promise<Player | undefined>;
  deletePlayer(id: string): Promise<boolean>;

  // Tournaments
  getTournament(id: string): Promise<Tournament | undefined>;
  getTournaments(): Promise<Tournament[]>;
  getTournamentsByClub(clubId: string): Promise<Tournament[]>;
  getTournamentsBySeason(seasonId: string): Promise<Tournament[]>;
  createTournament(tournament: InsertTournament): Promise<Tournament>;
  updateTournament(id: string, tournament: Partial<InsertTournament>): Promise<Tournament | undefined>;
  deleteTournament(id: string): Promise<boolean>;

  // Tournament Registrations
  getTournamentRegistration(id: string): Promise<TournamentRegistration | undefined>;
  getTournamentRegistrations(tournamentId: string): Promise<TournamentRegistration[]>;
  getPlayerRegistrations(playerId: string): Promise<TournamentRegistration[]>;
  createTournamentRegistration(registration: InsertTournamentRegistration): Promise<TournamentRegistration>;
  updateTournamentRegistration(id: string, registration: Partial<InsertTournamentRegistration>): Promise<TournamentRegistration | undefined>;
  deleteTournamentRegistration(id: string): Promise<boolean>;

  // Points Systems
  getPointsSystem(id: string): Promise<PointsSystem | undefined>;
  getPointsSystemsBySeason(seasonId: string): Promise<PointsSystem[]>;
  createPointsSystem(pointsSystem: InsertPointsSystem): Promise<PointsSystem>;
  updatePointsSystem(id: string, pointsSystem: Partial<InsertPointsSystem>): Promise<PointsSystem | undefined>;
  deletePointsSystem(id: string): Promise<boolean>;

  // Points Allocations
  getPointsAllocation(id: string): Promise<PointsAllocation | undefined>;
  getPointsAllocationsBySystem(pointsSystemId: string): Promise<PointsAllocation[]>;
  createPointsAllocation(allocation: InsertPointsAllocation): Promise<PointsAllocation>;
  updatePointsAllocation(id: string, allocation: Partial<InsertPointsAllocation>): Promise<PointsAllocation | undefined>;
  deletePointsAllocation(id: string): Promise<boolean>;

  // Pending Actions
  getPendingActions(tournamentId: string): Promise<PendingAction[]>;
  createPendingAction(action: InsertPendingAction): Promise<PendingAction>;
  deletePendingAction(id: string): Promise<boolean>;

  // Activity Log
  getActivityLog(tournamentId: string): Promise<ActivityLog[]>;
  createActivityLog(activity: InsertActivityLog): Promise<ActivityLog>;

  // Users (for admin management)
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, userData: Partial<User>): Promise<User | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Clubs
  async getClub(id: string): Promise<Club | undefined> {
    const [club] = await db.select().from(clubs).where(eq(clubs.id, id));
    return club || undefined;
  }

  async getClubs(): Promise<Club[]> {
    return await db.select().from(clubs);
  }

  async createClub(insertClub: InsertClub): Promise<Club> {
    const [club] = await db.insert(clubs).values(insertClub).returning();
    return club;
  }

  async updateClub(id: string, clubData: Partial<InsertClub>): Promise<Club | undefined> {
    const [club] = await db.update(clubs).set(clubData).where(eq(clubs.id, id)).returning();
    return club || undefined;
  }

  async deleteClub(id: string): Promise<boolean> {
    const result = await db.delete(clubs).where(eq(clubs.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getClubMembersCount(clubId: string): Promise<number> {
    // Get all tournaments for this club
    const clubTournaments = await db.select().from(tournaments).where(eq(tournaments.clubId, clubId));
    const tournamentIds = clubTournaments.map(t => t.id);

    if (tournamentIds.length === 0) {
      return 0;
    }

    // Get all unique player IDs from tournament registrations
    const registrations = await db.select({
      playerId: tournamentRegistrations.playerId
    })
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, tournamentIds[0])); // Start with first tournament

    // Get registrations from all tournaments and collect unique player IDs
    const uniquePlayerIds = new Set<string>();

    for (const tournamentId of tournamentIds) {
      const tournamentRegs = await db.select({
        playerId: tournamentRegistrations.playerId
      })
      .from(tournamentRegistrations)
      .where(eq(tournamentRegistrations.tournamentId, tournamentId));

      tournamentRegs.forEach(reg => uniquePlayerIds.add(reg.playerId));
    }

    return uniquePlayerIds.size;
  }

  // Seasons
  async getSeason(id: string): Promise<Season | undefined> {
    const [season] = await db.select().from(seasons).where(eq(seasons.id, id));
    return season || undefined;
  }

  async getSeasons(): Promise<Season[]> {
    return await db.select().from(seasons);
  }

  async getSeasonsByClub(clubId: string): Promise<Season[]> {
    return await db.select().from(seasons).where(eq(seasons.clubId, clubId));
  }

  async createSeason(insertSeason: InsertSeason): Promise<Season> {
    const [season] = await db.insert(seasons).values(insertSeason).returning();
    return season;
  }

  async updateSeason(id: string, seasonData: Partial<InsertSeason>): Promise<Season | undefined> {
    const [season] = await db.update(seasons).set(seasonData).where(eq(seasons.id, id)).returning();
    return season || undefined;
  }

  async deleteSeason(id: string): Promise<boolean> {
    const result = await db.delete(seasons).where(eq(seasons.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Players
  async getPlayer(id: string): Promise<Player | undefined> {
    const [player] = await db.select().from(players).where(eq(players.id, id));
    return player || undefined;
  }

  async getPlayers(): Promise<Player[]> {
    return await db.select().from(players);
  }

  async getPlayerByEmail(email: string): Promise<Player | undefined> {
    const [player] = await db.select().from(players).where(eq(players.email, email));
    return player || undefined;
  }

  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const [player] = await db.insert(players).values(insertPlayer).returning();
    return player;
  }

  async updatePlayer(id: string, playerData: Partial<InsertPlayer>): Promise<Player | undefined> {
    const [player] = await db.update(players).set(playerData).where(eq(players.id, id)).returning();
    return player || undefined;
  }

  async deletePlayer(id: string): Promise<boolean> {
    const result = await db.delete(players).where(eq(players.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Tournaments
  async getTournament(id: string): Promise<Tournament | undefined> {
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, id));
    return tournament || undefined;
  }

  async getTournaments(): Promise<Tournament[]> {
    return await db.select().from(tournaments);
  }

  async getTournamentsByClub(clubId: string): Promise<Tournament[]> {
    return await db.select().from(tournaments).where(eq(tournaments.clubId, clubId));
  }

  async getTournamentsBySeason(seasonId: string): Promise<Tournament[]> {
    return await db.select().from(tournaments).where(eq(tournaments.seasonId, seasonId));
  }

  async createTournament(insertTournament: InsertTournament): Promise<Tournament> {
    const [tournament] = await db.insert(tournaments).values(insertTournament).returning();
    return tournament;
  }

  async updateTournament(id: string, tournamentData: Partial<InsertTournament>): Promise<Tournament | undefined> {
    const [tournament] = await db.update(tournaments).set(tournamentData).where(eq(tournaments.id, id)).returning();
    return tournament || undefined;
  }

  async deleteTournament(id: string): Promise<boolean> {
    const result = await db.delete(tournaments).where(eq(tournaments.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Tournament Registrations
  async getTournamentRegistration(id: string): Promise<TournamentRegistration | undefined> {
    const [registration] = await db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id));
    return registration || undefined;
  }

  async getTournamentRegistrations(tournamentId: string): Promise<TournamentRegistration[]> {
    return await db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournamentId));
  }

  async getPlayerRegistrations(playerId: string): Promise<TournamentRegistration[]> {
    return await db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.playerId, playerId));
  }

  async createTournamentRegistration(insertReg: InsertTournamentRegistration): Promise<TournamentRegistration> {
    const [registration] = await db.insert(tournamentRegistrations).values(insertReg).returning();
    return registration;
  }

  async updateTournamentRegistration(id: string, regData: Partial<InsertTournamentRegistration>): Promise<TournamentRegistration | undefined> {
    const [registration] = await db.update(tournamentRegistrations).set(regData).where(eq(tournamentRegistrations.id, id)).returning();
    return registration || undefined;
  }

  async deleteTournamentRegistration(id: string): Promise<boolean> {
    const result = await db.delete(tournamentRegistrations).where(eq(tournamentRegistrations.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Points Systems
  async getPointsSystem(id: string): Promise<PointsSystem | undefined> {
    const [pointsSystem] = await db.select().from(pointsSystems).where(eq(pointsSystems.id, id));
    return pointsSystem || undefined;
  }

  async getPointsSystemsBySeason(seasonId: string): Promise<PointsSystem[]> {
    return await db.select().from(pointsSystems).where(eq(pointsSystems.seasonId, seasonId));
  }

  async createPointsSystem(insertPS: InsertPointsSystem): Promise<PointsSystem> {
    const [pointsSystem] = await db.insert(pointsSystems).values(insertPS).returning();
    return pointsSystem;
  }

  async updatePointsSystem(id: string, psData: Partial<InsertPointsSystem>): Promise<PointsSystem | undefined> {
    const [pointsSystem] = await db.update(pointsSystems).set(psData).where(eq(pointsSystems.id, id)).returning();
    return pointsSystem || undefined;
  }

  async deletePointsSystem(id: string): Promise<boolean> {
    const result = await db.delete(pointsSystems).where(eq(pointsSystems.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Points Allocations
  async getPointsAllocation(id: string): Promise<PointsAllocation | undefined> {
    const [allocation] = await db.select().from(pointsAllocations).where(eq(pointsAllocations.id, id));
    return allocation || undefined;
  }

  async getPointsAllocationsBySystem(pointsSystemId: string): Promise<PointsAllocation[]> {
    return await db.select().from(pointsAllocations).where(eq(pointsAllocations.pointsSystemId, pointsSystemId));
  }

  async createPointsAllocation(insertPA: InsertPointsAllocation): Promise<PointsAllocation> {
    const [allocation] = await db.insert(pointsAllocations).values(insertPA).returning();
    return allocation;
  }

  async updatePointsAllocation(id: string, paData: Partial<InsertPointsAllocation>): Promise<PointsAllocation | undefined> {
    const [allocation] = await db.update(pointsAllocations).set(paData).where(eq(pointsAllocations.id, id)).returning();
    return allocation || undefined;
  }

  async deletePointsAllocation(id: string): Promise<boolean> {
    const result = await db.delete(pointsAllocations).where(eq(pointsAllocations.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Pending Actions
  async getPendingActions(tournamentId: string): Promise<PendingAction[]> {
    return await db.select().from(pendingActions).where(eq(pendingActions.tournamentId, tournamentId));
  }

  async createPendingAction(insertAction: InsertPendingAction): Promise<PendingAction> {
    const [action] = await db.insert(pendingActions).values(insertAction).returning();
    return action;
  }

  async deletePendingAction(id: string): Promise<boolean> {
    const result = await db.delete(pendingActions).where(eq(pendingActions.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Activity Log
  async getActivityLog(tournamentId: string): Promise<ActivityLog[]> {
    return await db.select().from(activityLog)
      .where(eq(activityLog.tournamentId, tournamentId))
      .orderBy(desc(activityLog.timestamp), desc(activityLog.id));
  }

  async createActivityLog(insertActivity: InsertActivityLog): Promise<ActivityLog> {
    const [activity] = await db.insert(activityLog).values(insertActivity).returning();
    return activity;
  }

  // Users (for admin management)
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUser(id: string, userData: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set(userData).where(eq(users.id, id)).returning();
    return user || undefined;
  }
}

export const storage = new DatabaseStorage();
