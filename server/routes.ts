import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import {
  insertClubSchema,
  insertSeasonSchema,
  insertPlayerSchema,
  insertTournamentSchema,
  insertTournamentRegistrationSchema,
  insertPointsSystemSchema,
  insertPointsAllocationSchema
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Clubs routes
  app.get("/api/clubs", async (_req, res) => {
    try {
      const clubs = await storage.getClubs();
      res.json(clubs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clubs" });
    }
  });

  app.get("/api/clubs/:id", async (req, res) => {
    try {
      const club = await storage.getClub(req.params.id);
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }
      res.json(club);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch club" });
    }
  });

  app.post("/api/clubs", async (req, res) => {
    try {
      const validatedData = insertClubSchema.parse(req.body);
      const club = await storage.createClub(validatedData);
      res.status(201).json(club);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid club data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create club" });
    }
  });

  app.put("/api/clubs/:id", async (req, res) => {
    try {
      const validatedData = insertClubSchema.partial().parse(req.body);
      const club = await storage.updateClub(req.params.id, validatedData);
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }
      res.json(club);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid club data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update club" });
    }
  });

  app.delete("/api/clubs/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteClub(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Club not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete club" });
    }
  });

  // Seasons routes
  app.get("/api/seasons", async (req, res) => {
    try {
      const { clubId } = req.query;
      let seasons;
      if (clubId) {
        seasons = await storage.getSeasonsByClub(clubId as string);
      } else {
        seasons = await storage.getSeasons();
      }
      res.json(seasons);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch seasons" });
    }
  });

  app.post("/api/seasons", async (req, res) => {
    try {
      const validatedData = insertSeasonSchema.parse(req.body);
      const season = await storage.createSeason(validatedData);
      res.status(201).json(season);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid season data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create season" });
    }
  });

  // Players routes
  app.get("/api/players", async (_req, res) => {
    try {
      const players = await storage.getPlayers();
      res.json(players);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch players" });
    }
  });

  app.post("/api/players", async (req, res) => {
    try {
      const validatedData = insertPlayerSchema.parse(req.body);
      
      // Check for existing player with same phone number
      if (validatedData.phone) {
        const existingPlayers = await storage.getPlayers();
        const existingPlayer = existingPlayers.find(p => p.phone === validatedData.phone);
        if (existingPlayer) {
          return res.status(409).json({ 
            error: "Phone number already registered",
            message: `This phone number is already registered to ${existingPlayer.name}. Please use the "Existing Player" option instead.`,
            existingPlayer
          });
        }
      }
      
      const player = await storage.createPlayer(validatedData);
      res.status(201).json(player);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid player data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create player" });
    }
  });

  // Tournaments routes
  app.get("/api/tournaments", async (req, res) => {
    try {
      const { clubId, seasonId } = req.query;
      let tournaments;
      if (clubId) {
        tournaments = await storage.getTournamentsByClub(clubId as string);
      } else if (seasonId) {
        tournaments = await storage.getTournamentsBySeason(seasonId as string);
      } else {
        tournaments = await storage.getTournaments();
      }
      res.json(tournaments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tournaments" });
    }
  });

  app.get("/api/tournaments/:id", async (req, res) => {
    try {
      const tournament = await storage.getTournament(req.params.id);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }
      res.json(tournament);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tournament" });
    }
  });

  app.post("/api/tournaments", async (req, res) => {
    try {
      const validatedData = insertTournamentSchema.parse(req.body);
      const tournament = await storage.createTournament(validatedData);
      res.status(201).json(tournament);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid tournament data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create tournament" });
    }
  });

  app.patch("/api/tournaments/:id", async (req, res) => {
    try {
      const validatedData = insertTournamentSchema.partial().parse(req.body);
      const tournament = await storage.updateTournament(req.params.id, validatedData);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }
      res.json(tournament);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid tournament data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update tournament" });
    }
  });

  app.put("/api/tournaments/:id", async (req, res) => {
    try {
      const validatedData = insertTournamentSchema.partial().parse(req.body);
      const tournament = await storage.updateTournament(req.params.id, validatedData);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }
      res.json(tournament);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid tournament data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update tournament" });
    }
  });

  // Tournament registrations routes
  app.get("/api/tournaments/:tournamentId/registrations", async (req, res) => {
    try {
      const registrations = await storage.getTournamentRegistrations(req.params.tournamentId);
      
      // Get player details for each registration
      const registrationsWithPlayers = await Promise.all(
        registrations.map(async (reg) => {
          const player = await storage.getPlayer(reg.playerId);
          return {
            ...reg,
            player: player || null
          };
        })
      );
      
      res.json(registrationsWithPlayers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tournament registrations" });
    }
  });

  app.post("/api/tournaments/:tournamentId/registrations", async (req, res) => {
    try {
      const tournament = await storage.getTournament(req.params.tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      // Validate high hands entry against tournament settings
      if (req.body.enteringHighHands && !tournament.enableHighHand) {
        return res.status(400).json({ error: "High hands entry is not available for this tournament" });
      }

      // Check for duplicate registration
      const existingRegistrations = await storage.getTournamentRegistrations(req.params.tournamentId);
      const isDuplicate = existingRegistrations.some(reg => reg.playerId === req.body.playerId);
      if (isDuplicate) {
        return res.status(400).json({ error: "Player is already registered for this tournament" });
      }

      const registrationData = {
        ...req.body,
        tournamentId: req.params.tournamentId
      };
      const validatedData = insertTournamentRegistrationSchema.parse(registrationData);
      const registration = await storage.createTournamentRegistration(validatedData);
      res.status(201).json(registration);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create registration" });
    }
  });

  app.patch("/api/tournaments/:tournamentId/registrations/:id", async (req, res) => {
    try {
      const validatedData = insertTournamentRegistrationSchema.partial().parse(req.body);
      const registration = await storage.updateTournamentRegistration(req.params.id, validatedData);
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }
      res.json(registration);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update registration" });
    }
  });

  app.put("/api/registrations/:id", async (req, res) => {
    try {
      const validatedData = insertTournamentRegistrationSchema.partial().parse(req.body);
      const registration = await storage.updateTournamentRegistration(req.params.id, validatedData);
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }
      res.json(registration);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update registration" });
    }
  });

  // Points systems routes
  app.get("/api/seasons/:seasonId/points-systems", async (req, res) => {
    try {
      const pointsSystems = await storage.getPointsSystemsBySeason(req.params.seasonId);
      res.json(pointsSystems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch points systems" });
    }
  });

  app.post("/api/points-systems", async (req, res) => {
    try {
      const validatedData = insertPointsSystemSchema.parse(req.body);
      const pointsSystem = await storage.createPointsSystem(validatedData);
      res.status(201).json(pointsSystem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid points system data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create points system" });
    }
  });

  // Points allocations routes
  app.get("/api/points-systems/:pointsSystemId/allocations", async (req, res) => {
    try {
      const allocations = await storage.getPointsAllocationsBySystem(req.params.pointsSystemId);
      res.json(allocations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch points allocations" });
    }
  });

  app.post("/api/points-allocations", async (req, res) => {
    try {
      const validatedData = insertPointsAllocationSchema.parse(req.body);
      const allocation = await storage.createPointsAllocation(validatedData);
      res.status(201).json(allocation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid points allocation data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create points allocation" });
    }
  });

  // Dashboard stats endpoint
  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      const tournaments = await storage.getTournaments();
      const players = await storage.getPlayers();
      const clubs = await storage.getClubs();
      
      const activeTournaments = tournaments.filter(t => t.status === 'in_progress' || t.status === 'registration');
      
      let totalPrizePool = 0;
      for (const tournament of tournaments) {
        const registrations = await storage.getTournamentRegistrations(tournament.id);
        const buyInTotal = registrations.reduce((sum, reg) => 
          sum + (parseFloat(tournament.buyInAmount) * (reg.buyIns || 0)) + 
              (parseFloat(tournament.rebuyAmount || '0') * (reg.rebuys || 0)) + 
              (parseFloat(tournament.addonAmount || '0') * (reg.addons || 0)), 0
        );
        
        // Apply rake
        let netPool = buyInTotal;
        if (tournament.rakeType === 'percentage') {
          netPool = buyInTotal * (1 - parseFloat(tournament.rakeAmount || '0') / 100);
        } else if (tournament.rakeType === 'fixed') {
          netPool = buyInTotal - parseFloat(tournament.rakeAmount || '0');
        }
        
        totalPrizePool += netPool;
      }

      res.json({
        activeTournaments: activeTournaments.length,
        totalPlayers: players.length,
        totalPrizePool: Math.round(totalPrizePool),
        activeClubs: clubs.length
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Leaderboard endpoint
  app.get("/api/seasons/:seasonId/leaderboard", async (req, res) => {
    try {
      const seasonId = req.params.seasonId;
      const tournaments = await storage.getTournamentsBySeason(seasonId);
      
      const playerPoints = new Map<string, { player: any, points: number, tournaments: number }>();
      
      for (const tournament of tournaments) {
        const registrations = await storage.getTournamentRegistrations(tournament.id);
        
        for (const reg of registrations) {
          if (reg.pointsAwarded) {
            const player = await storage.getPlayer(reg.playerId);
            if (player) {
              const current = playerPoints.get(reg.playerId) || { player, points: 0, tournaments: 0 };
              current.points += reg.pointsAwarded;
              current.tournaments += 1;
              playerPoints.set(reg.playerId, current);
            }
          }
        }
      }
      
      const leaderboard = Array.from(playerPoints.values())
        .sort((a, b) => b.points - a.points)
        .slice(0, 10); // Top 10
      
      res.json(leaderboard);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });

  // Public registration endpoints
  app.get("/api/tournaments/:tournamentId/pending-registrations", async (req, res) => {
    try {
      const registrations = await storage.getTournamentRegistrations(req.params.tournamentId);
      const pendingRegistrations = registrations.filter(reg => !reg.paymentConfirmed);
      
      // Get player details for each registration
      const registrationsWithPlayers = await Promise.all(
        pendingRegistrations.map(async (reg) => {
          const player = await storage.getPlayer(reg.playerId);
          const tournament = await storage.getTournament(req.params.tournamentId);
          
          // Calculate amount owed
          const buyInAmount = parseFloat(tournament?.buyInAmount || "0");
          const highHandAmount = reg.enteringHighHands && tournament?.enableHighHand 
            ? parseFloat(tournament?.highHandAmount || "0") 
            : 0;
          const totalAmount = buyInAmount + highHandAmount;
          
          return {
            ...reg,
            player: player || null,
            amountOwed: totalAmount
          };
        })
      );
      
      res.json(registrationsWithPlayers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pending registrations" });
    }
  });

  app.get("/api/tournaments/:tournamentId/confirmed-registrations", async (req, res) => {
    try {
      const registrations = await storage.getTournamentRegistrations(req.params.tournamentId);
      const confirmedRegistrations = registrations.filter(reg => reg.paymentConfirmed);
      
      const registrationsWithPlayers = await Promise.all(
        confirmedRegistrations.map(async (reg) => {
          const player = await storage.getPlayer(reg.playerId);
          const tournament = await storage.getTournament(req.params.tournamentId);
          
          const buyInAmount = parseFloat(tournament?.buyInAmount || "0");
          const highHandAmount = reg.enteringHighHands && tournament?.enableHighHand 
            ? parseFloat(tournament?.highHandAmount || "0") 
            : 0;
          const totalAmount = buyInAmount + highHandAmount;
          
          return {
            ...reg,
            player: player || null,
            amountPaid: totalAmount
          };
        })
      );
      
      res.json(registrationsWithPlayers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch confirmed registrations" });
    }
  });

  app.patch("/api/registrations/:id/confirm-payment", async (req, res) => {
    try {
      const registration = await storage.updateTournamentRegistration(req.params.id, {
        paymentConfirmed: true
      });
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }
      res.json(registration);
    } catch (error) {
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
