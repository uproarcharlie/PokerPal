import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { upload } from "./config/multer";
import { uploadToCloud, isCloudStorageEnabled } from "./services/storage";
import { AuthService } from "./services/auth";
import { requireAuth, requireAdmin, requireFullMember } from "./middleware/auth";
import fs from "fs";
import path from "path";
import {
  insertClubSchema,
  insertSeasonSchema,
  insertPlayerSchema,
  insertTournamentSchema,
  insertTournamentRegistrationSchema,
  insertPointsSystemSchema,
  insertPointsAllocationSchema,
  insertPendingActionSchema,
  insertUserSchema
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {

  // ============================================
  // AUTHENTICATION ROUTES
  // ============================================

  // Register new full member
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name, phone } = req.body;

      // Validate required fields
      if (!email || !password || !name) {
        return res.status(400).json({ error: "Email, password, and name are required" });
      }

      // Validate password strength
      const passwordValidation = AuthService.validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          error: "Password does not meet requirements",
          details: passwordValidation.errors
        });
      }

      // Create user
      const user = await AuthService.createUser({
        email: email.toLowerCase().trim(),
        password,
        name: name.trim(),
        phone: phone?.trim() || null,
        role: 'full_member'
      });

      // Set session
      req.session.userId = user.id;
      req.session.role = user.role;

      res.status(201).json({
        message: "Registration successful",
        user
      });
    } catch (error) {
      console.error('Registration error:', error);
      if (error instanceof Error && error.message.includes("already exists")) {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const user = await AuthService.authenticateUser(email.toLowerCase().trim(), password);

      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Set session
      req.session.userId = user.id;
      req.session.role = user.role;

      res.json({
        message: "Login successful",
        user
      });
    } catch (error) {
      console.error('Login error:', error);
      if (error instanceof Error && error.message.includes("disabled")) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to login" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.clearCookie('pokerpal.sid');
      res.json({ message: "Logout successful" });
    });
  });

  // Get current user
  app.get("/api/auth/me", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await AuthService.getUserById(req.session.userId);

      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: "User not found" });
      }

      res.json({ user });
    } catch (error) {
      console.error('Get current user error:', error);
      res.status(500).json({ error: "Failed to get user information" });
    }
  });

  // Update user profile (requires authentication)
  app.put("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const { name, email, phone } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      const user = await AuthService.getUserById(req.session.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if email is being changed and if it's already taken
      if (email.toLowerCase() !== user.email.toLowerCase()) {
        const existingUser = await AuthService.getUserByEmail(email.toLowerCase().trim());
        if (existingUser) {
          return res.status(409).json({ error: "Email is already in use" });
        }
      }

      // Update user profile
      const updatedUser = await AuthService.updateProfile(req.session.userId!, {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone?.trim() || null,
      });

      res.json({
        message: "Profile updated successfully",
        user: updatedUser
      });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // Change password (requires authentication)
  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new passwords are required" });
      }

      // Validate new password strength
      const passwordValidation = AuthService.validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          error: "New password does not meet requirements",
          details: passwordValidation.errors
        });
      }

      // Verify current password
      const user = await AuthService.getUserById(req.session.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // This would need the password hash, so we need to adjust getUserById to optionally return it
      // For now, we'll authenticate the user again
      const authenticatedUser = await AuthService.authenticateUser(user.email, currentPassword);
      if (!authenticatedUser) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Update password
      await AuthService.updatePassword(req.session.userId!, newPassword);

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // ============================================
  // ADMIN - USER MANAGEMENT ROUTES
  // ============================================

  // Get all users and players (admin only)
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allPlayers = await storage.getPlayers();

      // Transform users
      const usersData = allUsers.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        type: 'user' as const,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      }));

      // Transform players (club members)
      const playersData = allPlayers.map(player => ({
        id: player.id,
        name: player.name,
        email: player.email || null,
        phone: player.phone || null,
        role: 'club_member',
        type: 'player' as const,
        isActive: true,
        lastLoginAt: null,
        createdAt: player.createdAt,
        userId: player.userId, // Link to user if they upgraded
      }));

      // Combine and sort by created date
      const allData = [...usersData, ...playersData].sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateB.getTime() - dateA.getTime();
      });

      res.json(allData);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Update user (admin only)
  app.put("/api/admin/users/:userId", requireAdmin, async (req, res) => {
    try {
      const { name, email, phone, role, isActive } = req.body;
      const userId = req.params.userId;

      // Validate role
      if (role && !['admin', 'full_member'].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      // Check if email is being changed and if it's already taken
      if (email) {
        const existingUser = await AuthService.getUserByEmail(email.toLowerCase().trim());
        if (existingUser && existingUser.id !== userId) {
          return res.status(409).json({ error: "Email is already in use" });
        }
      }

      const updatedUser = await storage.updateUser(userId, {
        name: name?.trim(),
        email: email?.toLowerCase().trim(),
        phone: phone?.trim() || null,
        role,
        isActive,
      });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        message: "User updated successfully",
        user: updatedUser
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Impersonate user (admin only)
  app.post("/api/admin/users/:userId/impersonate", requireAdmin, async (req, res) => {
    try {
      const targetUserId = req.params.userId;

      // Get target user
      const targetUser = await AuthService.getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Store original admin ID in session before impersonating
      if (!req.session.originalAdminId) {
        req.session.originalAdminId = req.session.userId;
        req.session.originalAdminRole = req.session.role;
      }

      // Set session to target user
      req.session.userId = targetUser.id;
      req.session.role = targetUser.role;

      res.json({
        message: "Impersonation started",
        user: targetUser
      });
    } catch (error) {
      console.error('Error impersonating user:', error);
      res.status(500).json({ error: "Failed to impersonate user" });
    }
  });

  // Stop impersonation (restore admin session)
  app.post("/api/admin/stop-impersonation", requireAuth, async (req, res) => {
    try {
      if (!req.session.originalAdminId) {
        return res.status(400).json({ error: "Not currently impersonating" });
      }

      // Restore original admin session
      req.session.userId = req.session.originalAdminId;
      req.session.role = req.session.originalAdminRole;

      // Clear impersonation data
      delete req.session.originalAdminId;
      delete req.session.originalAdminRole;

      const adminUser = await AuthService.getUserById(req.session.userId);

      res.json({
        message: "Impersonation ended",
        user: adminUser
      });
    } catch (error) {
      console.error('Error stopping impersonation:', error);
      res.status(500).json({ error: "Failed to stop impersonation" });
    }
  });

  // ============================================
  // EXISTING ROUTES
  // ============================================

  // Image upload endpoint (requires authentication)
  app.post("/api/upload", requireAuth, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const entityType = req.body.entityType || 'misc';

      // Use cloud storage in production, local storage in development
      if (isCloudStorageEnabled()) {
        try {
          const result = await uploadToCloud(req.file, entityType);
          res.json({ imageUrl: result.url });
        } catch (error) {
          console.error('Cloud upload error:', error);
          return res.status(500).json({ error: "Failed to upload to cloud storage" });
        }
      } else {
        // Local file storage (development)
        const entityDir = path.join('uploads', entityType);

        // Create entity directory if it doesn't exist
        if (!fs.existsSync(entityDir)) {
          fs.mkdirSync(entityDir, { recursive: true });
        }

        // Move file from uploads/ to uploads/entityType/
        const oldPath = req.file.path;
        const newPath = path.join(entityDir, req.file.filename);

        fs.renameSync(oldPath, newPath);

        const imageUrl = `/uploads/${entityType}/${req.file.filename}`;
        res.json({ imageUrl });
      }
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: "Failed to upload image" });
    }
  });

  // Clubs routes
  app.get("/api/clubs", async (_req, res) => {
    try {
      const clubs = await storage.getClubs();
      res.json(clubs);
    } catch (error) {
      console.error('Error fetching clubs:', error);
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

  // Get club by slug
  app.get("/api/clubs/slug/:slug", async (req, res) => {
    try {
      const club = await storage.getClubBySlug(req.params.slug);
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }
      res.json(club);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch club" });
    }
  });

  app.post("/api/clubs", requireAuth, async (req, res) => {
    try {
      const validatedData = insertClubSchema.parse(req.body);
      // Set the owner to the current user
      const clubData = {
        ...validatedData,
        ownerId: req.user!.id
      };
      const club = await storage.createClub(clubData);
      res.status(201).json(club);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid club data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create club" });
    }
  });

  app.put("/api/clubs/:id", requireAuth, async (req, res) => {
    try {
      const validatedData = insertClubSchema.partial().parse(req.body);

      // Check ownership
      const existingClub = await storage.getClub(req.params.id);
      if (!existingClub) {
        return res.status(404).json({ error: "Club not found" });
      }

      // Allow admin or owner to update
      const isAdmin = req.user!.role === 'admin';
      const isOwner = existingClub.ownerId === req.user!.id;

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: "You don't have permission to update this club" });
      }

      const club = await storage.updateClub(req.params.id, validatedData);
      res.json(club);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid club data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update club" });
    }
  });

  app.delete("/api/clubs/:id", requireAuth, async (req, res) => {
    try {
      // Check ownership before delete
      const existingClub = await storage.getClub(req.params.id);
      if (!existingClub) {
        return res.status(404).json({ error: "Club not found" });
      }

      // Allow admin or owner to delete
      const isAdmin = req.user!.role === 'admin';
      const isOwner = existingClub.ownerId === req.user!.id;

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: "You don't have permission to delete this club" });
      }

      const deleted = await storage.deleteClub(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Club not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete club" });
    }
  });

  app.get("/api/clubs/:id/members-count", async (req, res) => {
    try {
      const count = await storage.getClubMembersCount(req.params.id);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get members count" });
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

  app.post("/api/seasons", requireAuth, async (req, res) => {
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

  app.delete("/api/seasons/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteSeason(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Season not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete season" });
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

  app.put("/api/players/:id", async (req, res) => {
    try {
      const validatedData = insertPlayerSchema.partial().parse(req.body);
      const player = await storage.updatePlayer(req.params.id, validatedData);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }
      res.json(player);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid player data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update player" });
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
      
      // Enrich tournaments with confirmed player count
      const tournamentsWithCounts = await Promise.all(
        tournaments.map(async (tournament) => {
          const registrations = await storage.getTournamentRegistrations(tournament.id);
          const confirmedCount = registrations.filter(reg => reg.paymentConfirmed).length;
          return {
            ...tournament,
            confirmedPlayerCount: confirmedCount
          };
        })
      );
      
      res.json(tournamentsWithCounts);
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

  app.put("/api/tournaments/:id", requireAuth, async (req, res) => {
    try {
      const validatedData = insertTournamentSchema.partial().parse(req.body);
      const oldTournament = await storage.getTournament(req.params.id);

      if (!oldTournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      // Check ownership - user must own the club this tournament belongs to
      const club = await storage.getClub(oldTournament.clubId);
      const isAdmin = req.user!.role === 'admin';
      const isOwner = club?.ownerId === req.user!.id;

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: "You don't have permission to update this tournament" });
      }

      const tournament = await storage.updateTournament(req.params.id, validatedData);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      // Log status change
      if (validatedData.status && validatedData.status !== oldTournament?.status) {
        const statusLabels: Record<string, string> = {
          'scheduled': 'Scheduled',
          'registration': 'Registration Open',
          'in_progress': 'In Progress',
          'completed': 'Completed',
          'cancelled': 'Cancelled'
        };
        await storage.createActivityLog({
          tournamentId: req.params.id,
          eventType: 'status_change',
          description: `Tournament status changed to ${statusLabels[validatedData.status] || validatedData.status}`,
        });
      }

      // Log prize pool lock
      if (validatedData.prizePoolLocked === true && !oldTournament?.prizePoolLocked) {
        await storage.createActivityLog({
          tournamentId: req.params.id,
          eventType: 'prize_pool_locked',
          description: 'Prize pool has been locked - no further registrations, rebuys, or addons allowed',
        });
      }

      res.json(tournament);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid tournament data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update tournament" });
    }
  });

  app.delete("/api/tournaments/:id", requireAuth, async (req, res) => {
    try {
      const tournament = await storage.getTournament(req.params.id);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      // Check ownership - user must own the club this tournament belongs to
      const club = await storage.getClub(tournament.clubId);
      const isAdmin = req.user!.role === 'admin';
      const isOwner = club?.ownerId === req.user!.id;

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: "You don't have permission to delete this tournament" });
      }

      const deleted = await storage.deleteTournament(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Tournament not found" });
      }
      res.json({ success: true, message: "Tournament deleted successfully" });
    } catch (error) {
      console.error('Delete tournament error:', error);
      res.status(500).json({ error: "Failed to delete tournament" });
    }
  });

  // Finalize tournament - assign positions, prizes, and points
  app.post("/api/tournaments/:id/finalize", async (req, res) => {
    try {
      const tournament = await storage.getTournament(req.params.id);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      const registrations = await storage.getTournamentRegistrations(req.params.id);

      // Get points allocations if tracking points
      let pointsAllocations: any[] = [];
      let participationPoints = 0;
      if (tournament.trackPoints && tournament.pointsSystemId) {
        const pointsSystem = await storage.getPointsSystem(tournament.pointsSystemId);
        pointsAllocations = await storage.getPointsAllocationsBySystem(tournament.pointsSystemId);
        participationPoints = pointsSystem?.participationPoints || 0;
      }

      // Sort players by elimination time (most recent = best finish)
      // Players not eliminated are still in (best finish)
      const sortedPlayers = [...registrations].sort((a, b) => {
        // Active players (not eliminated) finish best
        if (!a.isEliminated && b.isEliminated) return -1;
        if (a.isEliminated && !b.isEliminated) return 1;

        // Both active - no order yet
        if (!a.isEliminated && !b.isEliminated) return 0;

        // Both eliminated - later elimination = better finish
        const aTime = a.eliminationTime ? new Date(a.eliminationTime).getTime() : 0;
        const bTime = b.eliminationTime ? new Date(b.eliminationTime).getTime() : 0;
        return bTime - aTime;
      });

      // Calculate prize pool
      const totalBuyIns = registrations.reduce((sum, reg) => sum + reg.buyIns, 0);
      const totalRebuys = registrations.reduce((sum, reg) => sum + reg.rebuys, 0);
      const totalAddons = registrations.reduce((sum, reg) => sum + reg.addons, 0);

      const buyInTotal = totalBuyIns * parseFloat(tournament.buyInAmount);
      const rebuyTotal = totalRebuys * parseFloat(tournament.rebuyAmount || '0');
      const addonTotal = totalAddons * parseFloat(tournament.addonAmount || '0');
      const grossTotal = buyInTotal + rebuyTotal + addonTotal;

      // Calculate rake
      let buyInRake = 0;
      if (tournament.rakeType === 'percentage') {
        buyInRake = buyInTotal * (parseFloat(tournament.rakeAmount || '0') / 100);
      } else if (tournament.rakeType === 'fixed') {
        buyInRake = totalBuyIns * parseFloat(tournament.rakeAmount || '0');
      }

      let rebuyRake = 0;
      if (tournament.rebuyRakeType === 'percentage') {
        rebuyRake = rebuyTotal * (parseFloat(tournament.rebuyRakeAmount || '0') / 100);
      } else if (tournament.rebuyRakeType === 'fixed') {
        rebuyRake = totalRebuys * parseFloat(tournament.rebuyRakeAmount || '0');
      }

      let addonRake = 0;
      if (tournament.addonRakeType === 'percentage') {
        addonRake = addonTotal * (parseFloat(tournament.addonRakeAmount || '0') / 100);
      } else if (tournament.addonRakeType === 'fixed') {
        addonRake = totalAddons * parseFloat(tournament.addonRakeAmount || '0');
      }

      const rake = buyInRake + rebuyRake + addonRake;
      const netPrizePool = grossTotal - rake;

      // Get payout structure
      const payoutStructures: Record<string, number[]> = {
        'standard': [0.50, 0.30, 0.20],
        'top3': [0.50, 0.30, 0.20],
        'top5': [0.40, 0.25, 0.20, 0.10, 0.05],
        'top8': [0.35, 0.22, 0.15, 0.12, 0.08, 0.04, 0.02, 0.02],
        'top9': [0.30, 0.20, 0.15, 0.12, 0.09, 0.06, 0.04, 0.02, 0.02],
      };

      const percentages = payoutStructures[tournament.payoutStructure] || payoutStructures['standard'];

      // Assign positions, prizes, and points
      for (let i = 0; i < sortedPlayers.length; i++) {
        const position = i + 1;
        const player = sortedPlayers[i];

        // Calculate prize
        let prizeAmount = 0;
        if (position <= percentages.length) {
          prizeAmount = Math.round(netPrizePool * percentages[position - 1]);
        }

        // Calculate points
        let points = 0;
        if (tournament.trackPoints) {
          // Find points allocation for this position
          const allocation = pointsAllocations.find(pa =>
            pa.positionEnd
              ? (position >= pa.position && position <= pa.positionEnd)
              : position === pa.position
          );

          if (allocation) {
            points = allocation.points;
          } else if (participationPoints > 0) {
            // Participation points for positions beyond allocated positions
            points = participationPoints;
          }

          // Add knockout points if applicable
          if (player.knockouts > 0) {
            const pointsSystem = await storage.getPointsSystem(tournament.pointsSystemId!);
            if (pointsSystem?.knockoutPoints) {
              points += player.knockouts * pointsSystem.knockoutPoints;
            }
          }
        }

        // Update registration
        await storage.updateTournamentRegistration(player.id, {
          finalPosition: position,
          prizeAmount: prizeAmount > 0 ? prizeAmount.toString() : null,
          pointsAwarded: points > 0 ? points : null,
        });
      }

      // Update tournament status to completed
      await storage.updateTournament(req.params.id, { status: 'completed' });

      // Log finalization
      await storage.createActivityLog({
        tournamentId: req.params.id,
        eventType: 'status_change',
        description: 'Tournament finalized - positions, prizes, and points assigned',
      });

      res.json({ success: true, message: "Tournament finalized successfully" });
    } catch (error) {
      console.error('Finalize tournament error:', error);
      res.status(500).json({ error: "Failed to finalize tournament", details: error instanceof Error ? error.message : String(error) });
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

      // Check if prize pool is locked
      if (tournament.prizePoolLocked) {
        return res.status(400).json({ error: "Prize pool is locked. No new registrations allowed." });
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

      // Log registration activity
      const player = await storage.getPlayer(registration.playerId);
      await storage.createActivityLog({
        tournamentId: req.params.tournamentId,
        playerId: registration.playerId,
        eventType: 'registration',
        description: `${player?.name || 'Unknown player'} registered for the tournament`,
      });

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
      const oldRegistration = await storage.getTournamentRegistration(req.params.id);

      // Check if prize pool is locked for rebuys/addons/high hands
      if (oldRegistration) {
        const tournament = await storage.getTournament(oldRegistration.tournamentId);
        if (tournament?.prizePoolLocked) {
          // Allow elimination and knockout tracking, but prevent rebuys, addons, and high hand entries
          if (
            (validatedData.rebuys !== undefined && validatedData.rebuys > (oldRegistration.rebuys || 0)) ||
            (validatedData.addons !== undefined && validatedData.addons > (oldRegistration.addons || 0)) ||
            (validatedData.enteringHighHands === true && !oldRegistration.enteringHighHands)
          ) {
            return res.status(400).json({ error: "Prize pool is locked. No rebuys, addons, or high hand entries allowed." });
          }
        }
      }

      const registration = await storage.updateTournamentRegistration(req.params.id, validatedData);
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      // Log activity based on what changed
      const player = await storage.getPlayer(registration.playerId);

      if (validatedData.isEliminated === true && oldRegistration?.isEliminated === false) {
        let description = `${player?.name || 'Unknown player'} was eliminated`;

        // If eliminatedBy is specified, get the knockout player's name
        if (validatedData.eliminatedBy) {
          const knockoutPlayer = await storage.getPlayer(validatedData.eliminatedBy);
          if (knockoutPlayer) {
            description = `${player?.name || 'Unknown player'} was eliminated by ${knockoutPlayer.name}`;
          }
        }

        await storage.createActivityLog({
          tournamentId: registration.tournamentId,
          playerId: registration.playerId,
          eventType: 'elimination',
          description,
          eventData: validatedData.eliminatedBy ? JSON.stringify({ eliminatedBy: validatedData.eliminatedBy }) : undefined,
        });
      } else if (validatedData.isEliminated === false && oldRegistration?.isEliminated === true) {
        await storage.createActivityLog({
          tournamentId: registration.tournamentId,
          playerId: registration.playerId,
          eventType: 'player_restored',
          description: `${player?.name || 'Unknown player'} was restored to active`,
        });
      }

      if (validatedData.rebuys !== undefined && validatedData.rebuys > (oldRegistration?.rebuys || 0)) {
        const rebuyCount = validatedData.rebuys - (oldRegistration?.rebuys || 0);
        await storage.createActivityLog({
          tournamentId: registration.tournamentId,
          playerId: registration.playerId,
          eventType: 'rebuy',
          description: `${player?.name || 'Unknown player'} made ${rebuyCount} re-buy${rebuyCount > 1 ? 's' : ''}`,
        });
      }

      if (validatedData.addons !== undefined && validatedData.addons > (oldRegistration?.addons || 0)) {
        const addonCount = validatedData.addons - (oldRegistration?.addons || 0);
        await storage.createActivityLog({
          tournamentId: registration.tournamentId,
          playerId: registration.playerId,
          eventType: 'addon',
          description: `${player?.name || 'Unknown player'} purchased ${addonCount} add-on${addonCount > 1 ? 's' : ''}`,
        });
      }

      if (validatedData.highHandWinner === true && !oldRegistration?.highHandWinner) {
        const amount = validatedData.highHandAmount || oldRegistration?.highHandAmount;
        await storage.createActivityLog({
          tournamentId: registration.tournamentId,
          playerId: registration.playerId,
          eventType: 'high_hand',
          description: `${player?.name || 'Unknown player'} won high hand${amount ? ` ($${amount})` : ''}`,
          eventData: amount ? JSON.stringify({ amount }) : undefined,
        });
      }

      res.json(registration);
    } catch (error) {
      console.error('PUT /api/registrations/:id - Error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update registration", details: error instanceof Error ? error.message : String(error) });
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

  app.post("/api/seasons/:seasonId/points-systems", async (req, res) => {
    try {
      const validatedData = insertPointsSystemSchema.parse({
        ...req.body,
        seasonId: req.params.seasonId
      });
      const pointsSystem = await storage.createPointsSystem(validatedData);
      res.status(201).json(pointsSystem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid points system data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create points system" });
    }
  });

  app.get("/api/points-systems/:id", async (req, res) => {
    try {
      const pointsSystem = await storage.getPointsSystem(req.params.id);
      if (!pointsSystem) {
        return res.status(404).json({ error: "Points system not found" });
      }
      res.json(pointsSystem);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch points system" });
    }
  });

  app.delete("/api/points-systems/:id", async (req, res) => {
    try {
      await storage.deletePointsSystem(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete points system" });
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

  app.post("/api/points-systems/:pointsSystemId/allocations", async (req, res) => {
    try {
      const validatedData = insertPointsAllocationSchema.parse({
        ...req.body,
        pointsSystemId: req.params.pointsSystemId
      });
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
        .sort((a, b) => b.points - a.points);

      res.json(leaderboard);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });

  // Single season endpoints (must come after more specific routes like /seasons/:id/leaderboard)
  app.get("/api/seasons/:id", async (req, res) => {
    try {
      const season = await storage.getSeason(req.params.id);
      if (!season) {
        return res.status(404).json({ error: "Season not found" });
      }
      res.json(season);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch season" });
    }
  });

  app.put("/api/seasons/:id", async (req, res) => {
    try {
      const validatedData = insertSeasonSchema.partial().parse(req.body);
      const season = await storage.updateSeason(req.params.id, validatedData);
      if (!season) {
        return res.status(404).json({ error: "Season not found" });
      }
      res.json(season);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid season data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update season" });
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

      // Log payment confirmation
      const player = await storage.getPlayer(registration.playerId);
      await storage.createActivityLog({
        tournamentId: registration.tournamentId,
        playerId: registration.playerId,
        eventType: 'payment_confirmed',
        description: `Payment confirmed for ${player?.name || 'Unknown player'}`,
      });

      res.json(registration);
    } catch (error) {
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  app.patch("/api/registrations/:id", async (req, res) => {
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

  // Pending actions routes
  app.get("/api/tournaments/:tournamentId/pending-actions", async (req, res) => {
    try {
      const actions = await storage.getPendingActions(req.params.tournamentId);

      const actionsWithPlayers = await Promise.all(
        actions.map(async (action) => {
          const player = await storage.getPlayer(action.playerId);
          let targetPlayer = null;
          if (action.targetPlayerId) {
            targetPlayer = await storage.getPlayer(action.targetPlayerId);
          }

          return {
            ...action,
            player: player || null,
            targetPlayer: targetPlayer || null,
          };
        })
      );

      res.json(actionsWithPlayers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pending actions" });
    }
  });

  app.post("/api/tournaments/:tournamentId/pending-actions", async (req, res) => {
    try {
      const validatedData = insertPendingActionSchema.parse({
        ...req.body,
        tournamentId: req.params.tournamentId
      });
      const action = await storage.createPendingAction(validatedData);
      res.status(201).json(action);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid action data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create pending action" });
    }
  });

  app.delete("/api/pending-actions/:id", async (req, res) => {
    try {
      const deleted = await storage.deletePendingAction(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete pending action" });
    }
  });

  // Activity log routes
  app.get("/api/tournaments/:tournamentId/activity", async (req, res) => {
    try {
      const activities = await storage.getActivityLog(req.params.tournamentId);

      // Enrich with player details
      const activitiesWithPlayers = await Promise.all(
        activities.map(async (activity) => {
          let player = null;
          if (activity.playerId) {
            player = await storage.getPlayer(activity.playerId);
          }
          return {
            ...activity,
            player: player || null,
          };
        })
      );

      res.json(activitiesWithPlayers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch activity log" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
