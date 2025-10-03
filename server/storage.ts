import { randomUUID } from "crypto";
import type {
  Club, InsertClub,
  Season, InsertSeason,
  Player, InsertPlayer,
  Tournament, InsertTournament,
  TournamentRegistration, InsertTournamentRegistration,
  PointsSystem, InsertPointsSystem,
  PointsAllocation, InsertPointsAllocation
} from "@shared/schema";

export interface IStorage {
  // Clubs
  getClub(id: string): Promise<Club | undefined>;
  getClubs(): Promise<Club[]>;
  createClub(club: InsertClub): Promise<Club>;
  updateClub(id: string, club: Partial<InsertClub>): Promise<Club | undefined>;
  deleteClub(id: string): Promise<boolean>;

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
}

export class MemStorage implements IStorage {
  private clubs: Map<string, Club> = new Map();
  private seasons: Map<string, Season> = new Map();
  private players: Map<string, Player> = new Map();
  private tournaments: Map<string, Tournament> = new Map();
  private tournamentRegistrations: Map<string, TournamentRegistration> = new Map();
  private pointsSystems: Map<string, PointsSystem> = new Map();
  private pointsAllocations: Map<string, PointsAllocation> = new Map();

  // Clubs
  async getClub(id: string): Promise<Club | undefined> {
    return this.clubs.get(id);
  }

  async getClubs(): Promise<Club[]> {
    return Array.from(this.clubs.values());
  }

  async createClub(insertClub: InsertClub): Promise<Club> {
    const id = randomUUID();
    const club: Club = {
      ...insertClub,
      description: insertClub.description ?? null,
      id,
      createdAt: new Date(),
    };
    this.clubs.set(id, club);
    return club;
  }

  async updateClub(id: string, clubData: Partial<InsertClub>): Promise<Club | undefined> {
    const club = this.clubs.get(id);
    if (!club) return undefined;

    const updatedClub = { ...club, ...clubData };
    this.clubs.set(id, updatedClub);
    return updatedClub;
  }

  async deleteClub(id: string): Promise<boolean> {
    return this.clubs.delete(id);
  }

  // Seasons
  async getSeason(id: string): Promise<Season | undefined> {
    return this.seasons.get(id);
  }

  async getSeasons(): Promise<Season[]> {
    return Array.from(this.seasons.values());
  }

  async getSeasonsByClub(clubId: string): Promise<Season[]> {
    return Array.from(this.seasons.values()).filter(season => season.clubId === clubId);
  }

  async createSeason(insertSeason: InsertSeason): Promise<Season> {
    const id = randomUUID();
    const season: Season = {
      ...insertSeason,
      endDate: insertSeason.endDate ?? null,
      isActive: insertSeason.isActive ?? null,
      id,
      createdAt: new Date(),
    };
    this.seasons.set(id, season);
    return season;
  }

  async updateSeason(id: string, seasonData: Partial<InsertSeason>): Promise<Season | undefined> {
    const season = this.seasons.get(id);
    if (!season) return undefined;

    const updatedSeason = { ...season, ...seasonData };
    this.seasons.set(id, updatedSeason);
    return updatedSeason;
  }

  async deleteSeason(id: string): Promise<boolean> {
    return this.seasons.delete(id);
  }

  // Players
  async getPlayer(id: string): Promise<Player | undefined> {
    return this.players.get(id);
  }

  async getPlayers(): Promise<Player[]> {
    return Array.from(this.players.values());
  }

  async getPlayerByEmail(email: string): Promise<Player | undefined> {
    return Array.from(this.players.values()).find(player => player.email === email);
  }

  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const id = randomUUID();
    const player: Player = {
      ...insertPlayer,
      email: insertPlayer.email ?? null,
      phone: insertPlayer.phone ?? null,
      id,
      createdAt: new Date(),
    };
    this.players.set(id, player);
    return player;
  }

  async updatePlayer(id: string, playerData: Partial<InsertPlayer>): Promise<Player | undefined> {
    const player = this.players.get(id);
    if (!player) return undefined;

    const updatedPlayer = { ...player, ...playerData };
    this.players.set(id, updatedPlayer);
    return updatedPlayer;
  }

  async deletePlayer(id: string): Promise<boolean> {
    return this.players.delete(id);
  }

  // Tournaments
  async getTournament(id: string): Promise<Tournament | undefined> {
    return this.tournaments.get(id);
  }

  async getTournaments(): Promise<Tournament[]> {
    return Array.from(this.tournaments.values());
  }

  async getTournamentsByClub(clubId: string): Promise<Tournament[]> {
    return Array.from(this.tournaments.values()).filter(tournament => tournament.clubId === clubId);
  }

  async getTournamentsBySeason(seasonId: string): Promise<Tournament[]> {
    return Array.from(this.tournaments.values()).filter(tournament => tournament.seasonId === seasonId);
  }

  async createTournament(insertTournament: InsertTournament): Promise<Tournament> {
    const id = randomUUID();
    const tournament: Tournament = {
      ...insertTournament,
      seasonId: insertTournament.seasonId ?? null,
      description: insertTournament.description ?? null,
      rebuyAmount: insertTournament.rebuyAmount ?? null,
      addonAmount: insertTournament.addonAmount ?? null,
      maxRebuys: insertTournament.maxRebuys ?? null,
      rebuyPeriodMinutes: insertTournament.rebuyPeriodMinutes ?? null,
      customPayouts: insertTournament.customPayouts ?? null,
      highHandAmount: insertTournament.highHandAmount ?? null,
      status: insertTournament.status ?? 'scheduled',
      rakeType: insertTournament.rakeType ?? 'none',
      rakeAmount: insertTournament.rakeAmount ?? '0',
      payoutStructure: insertTournament.payoutStructure ?? 'standard',
      enableHighHand: insertTournament.enableHighHand ?? false,
      enableLateRegistration: insertTournament.enableLateRegistration ?? false,
      trackPoints: insertTournament.trackPoints ?? true,
      minPlayers: insertTournament.minPlayers ?? 8,
      id,
      createdAt: new Date(),
    };
    this.tournaments.set(id, tournament);
    return tournament;
  }

  async updateTournament(id: string, tournamentData: Partial<InsertTournament>): Promise<Tournament | undefined> {
    const tournament = this.tournaments.get(id);
    if (!tournament) return undefined;

    const updatedTournament = { ...tournament, ...tournamentData };
    this.tournaments.set(id, updatedTournament);
    return updatedTournament;
  }

  async deleteTournament(id: string): Promise<boolean> {
    return this.tournaments.delete(id);
  }

  // Tournament Registrations
  async getTournamentRegistration(id: string): Promise<TournamentRegistration | undefined> {
    return this.tournamentRegistrations.get(id);
  }

  async getTournamentRegistrations(tournamentId: string): Promise<TournamentRegistration[]> {
    return Array.from(this.tournamentRegistrations.values())
      .filter(reg => reg.tournamentId === tournamentId);
  }

  async getPlayerRegistrations(playerId: string): Promise<TournamentRegistration[]> {
    return Array.from(this.tournamentRegistrations.values())
      .filter(reg => reg.playerId === playerId);
  }

  async createTournamentRegistration(insertReg: InsertTournamentRegistration): Promise<TournamentRegistration> {
    const id = randomUUID();
    const registration: TournamentRegistration = {
      ...insertReg,
      buyIns: insertReg.buyIns ?? null,
      rebuys: insertReg.rebuys ?? null,
      addons: insertReg.addons ?? null,
      finalPosition: insertReg.finalPosition ?? null,
      prizeAmount: insertReg.prizeAmount ?? null,
      pointsAwarded: insertReg.pointsAwarded ?? null,
      isEliminated: insertReg.isEliminated ?? null,
      eliminationTime: insertReg.eliminationTime ?? null,
      id,
      registrationTime: new Date(),
    };
    this.tournamentRegistrations.set(id, registration);
    return registration;
  }

  async updateTournamentRegistration(id: string, regData: Partial<InsertTournamentRegistration>): Promise<TournamentRegistration | undefined> {
    const registration = this.tournamentRegistrations.get(id);
    if (!registration) return undefined;

    const updatedRegistration = { ...registration, ...regData };
    this.tournamentRegistrations.set(id, updatedRegistration);
    return updatedRegistration;
  }

  async deleteTournamentRegistration(id: string): Promise<boolean> {
    return this.tournamentRegistrations.delete(id);
  }

  // Points Systems
  async getPointsSystem(id: string): Promise<PointsSystem | undefined> {
    return this.pointsSystems.get(id);
  }

  async getPointsSystemsBySeason(seasonId: string): Promise<PointsSystem[]> {
    return Array.from(this.pointsSystems.values()).filter(ps => ps.seasonId === seasonId);
  }

  async createPointsSystem(insertPS: InsertPointsSystem): Promise<PointsSystem> {
    const id = randomUUID();
    const pointsSystem: PointsSystem = {
      ...insertPS,
      description: insertPS.description ?? null,
      participationPoints: insertPS.participationPoints ?? null,
      knockoutPoints: insertPS.knockoutPoints ?? null,
      id,
      createdAt: new Date(),
    };
    this.pointsSystems.set(id, pointsSystem);
    return pointsSystem;
  }

  async updatePointsSystem(id: string, psData: Partial<InsertPointsSystem>): Promise<PointsSystem | undefined> {
    const pointsSystem = this.pointsSystems.get(id);
    if (!pointsSystem) return undefined;

    const updatedPS = { ...pointsSystem, ...psData };
    this.pointsSystems.set(id, updatedPS);
    return updatedPS;
  }

  async deletePointsSystem(id: string): Promise<boolean> {
    return this.pointsSystems.delete(id);
  }

  // Points Allocations
  async getPointsAllocation(id: string): Promise<PointsAllocation | undefined> {
    return this.pointsAllocations.get(id);
  }

  async getPointsAllocationsBySystem(pointsSystemId: string): Promise<PointsAllocation[]> {
    return Array.from(this.pointsAllocations.values())
      .filter(pa => pa.pointsSystemId === pointsSystemId);
  }

  async createPointsAllocation(insertPA: InsertPointsAllocation): Promise<PointsAllocation> {
    const id = randomUUID();
    const allocation: PointsAllocation = {
      ...insertPA,
      description: insertPA.description ?? null,
      positionEnd: insertPA.positionEnd ?? null,
      id,
    };
    this.pointsAllocations.set(id, allocation);
    return allocation;
  }

  async updatePointsAllocation(id: string, paData: Partial<InsertPointsAllocation>): Promise<PointsAllocation | undefined> {
    const allocation = this.pointsAllocations.get(id);
    if (!allocation) return undefined;

    const updatedPA = { ...allocation, ...paData };
    this.pointsAllocations.set(id, updatedPA);
    return updatedPA;
  }

  async deletePointsAllocation(id: string): Promise<boolean> {
    return this.pointsAllocations.delete(id);
  }
}

export const storage = new MemStorage();
