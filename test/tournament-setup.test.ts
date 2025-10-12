/**
 * Tournament Setup Test
 *
 * Creates tournament infrastructure and stops at registration phase:
 * 1. Create a club
 * 2. Create a season
 * 3. Create a points system
 * 4. Create points allocations
 * 5. Create players
 * 6. Create a tournament (status: scheduled)
 * 7. Register some players (ready for more registrations)
 *
 * USE CASE: Test tournament creation and registration flow
 * STATUS: Tournament ready for registration (scheduled)
 * DATA: Kept in database
 */

import { config } from "dotenv";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  clubs,
  seasons,
  pointsSystems,
  pointsAllocations,
  players,
  tournaments,
  tournamentRegistrations,
  activityLog,
  type Club,
  type Season,
  type Tournament,
} from "../shared/schema";

config();
const { Pool } = pg;

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  log(`  ${title}`, colors.bright + colors.blue);
  console.log("=".repeat(60));
}

function logStep(step: number, message: string) {
  log(`\n[Step ${step}] ${message}`, colors.cyan);
}

function logSuccess(message: string) {
  log(`  ✓ ${message}`, colors.green);
}

function logData(label: string, data: any) {
  log(`  ${label}: ${JSON.stringify(data, null, 2)}`, colors.yellow);
}

async function runSetupTest() {
  logSection("TOURNAMENT SETUP TEST");
  log("Creates tournament ready for registration", colors.cyan);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  let createdClub: Club;
  let createdSeason: Season;
  let createdTournament: Tournament;

  try {
    // Step 1: Create Club
    logStep(1, "Creating Club");
    const [club] = await db.insert(clubs).values({
      name: "Setup Test Club",
      description: "Tournament setup testing club",
      address: "456 Setup Ave, Wellington, New Zealand",
      timezone: "Pacific/Auckland",
    }).returning();
    createdClub = club;
    logSuccess("Club created");
    logData("Club", { id: club.id, name: club.name });

    // Step 2: Create Season
    logStep(2, "Creating Season");
    const [season] = await db.insert(seasons).values({
      name: "Winter 2025 Registration Test",
      clubId: club.id,
      startDate: new Date("2025-06-01"),
      endDate: new Date("2025-08-31"),
      isActive: true,
    }).returning();
    createdSeason = season;
    logSuccess("Season created");
    logData("Season", { id: season.id, name: season.name });

    // Step 3: Create Points System
    logStep(3, "Creating Points System");
    const [pointsSystem] = await db.insert(pointsSystems).values({
      seasonId: season.id,
      name: "Winter Points",
      description: "Standard winter season points",
      participationPoints: 15,
      knockoutPoints: 3,
    }).returning();
    logSuccess("Points system created");

    // Step 4: Create Points Allocations
    logStep(4, "Creating Points Allocations");
    const allocations = [
      { position: 1, positionEnd: null, points: 100, description: "1st Place" },
      { position: 2, positionEnd: null, points: 80, description: "2nd Place" },
      { position: 3, positionEnd: null, points: 65, description: "3rd Place" },
      { position: 4, positionEnd: 6, points: 50, description: "4th-6th Place" },
    ];

    for (const allocation of allocations) {
      await db.insert(pointsAllocations).values({
        pointsSystemId: pointsSystem.id,
        ...allocation,
      });
    }
    logSuccess(`Created ${allocations.length} points allocations`);

    // Step 5: Create Players
    logStep(5, "Creating Players");
    const playerNames = [
      "Setup Player 1", "Setup Player 2", "Setup Player 3",
      "Setup Player 4", "Setup Player 5", "Setup Player 6",
    ];

    const createdPlayers = [];
    for (let i = 0; i < playerNames.length; i++) {
      const [player] = await db.insert(players).values({
        name: playerNames[i],
        email: `setup-${i + 1}@test.com`,
        phone: `021-100-${String(i + 1).padStart(4, "0")}`,
      }).returning();
      createdPlayers.push(player);
    }
    logSuccess(`Created ${createdPlayers.length} players`);

    // Step 6: Create Tournament
    logStep(6, "Creating Tournament (Status: Scheduled)");
    const [tournament] = await db.insert(tournaments).values({
      name: "Friday Night Poker - Registration Open",
      description: "Tournament ready for player registration",
      clubId: club.id,
      seasonId: season.id,
      pointsSystemId: pointsSystem.id,
      startDateTime: new Date("2025-06-20T19:00:00"),
      status: "scheduled",
      buyInAmount: "40.00",
      rebuyAmount: "20.00",
      addonAmount: "25.00",
      maxRebuys: 3,
      rebuyPeriodMinutes: 90,
      rakeType: "fixed",
      rakeAmount: "5.00",
      payoutStructure: "standard",
      enableHighHand: true,
      highHandAmount: "30.00",
      highHandPayouts: 1,
      trackPoints: true,
      minPlayers: 6,
      maxPlayers: 12,
      useClubAddress: true,
    }).returning();
    createdTournament = tournament;
    logSuccess("Tournament created");
    logData("Tournament", {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      maxPlayers: tournament.maxPlayers,
    });

    // Step 7: Register Some Players (not all)
    logStep(7, "Registering First 3 Players");
    for (let i = 0; i < 3; i++) {
      await db.insert(tournamentRegistrations).values({
        tournamentId: tournament.id,
        playerId: createdPlayers[i].id,
        buyIns: 1,
        paymentConfirmed: true,
      });

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: createdPlayers[i].id,
        eventType: "registration",
        description: `${createdPlayers[i].name} registered for the tournament`,
      });
    }
    logSuccess("3 players registered (3 more available to register)");

    logSection("✓ SETUP TEST COMPLETED");
    log("\nTournament ready for registration testing:", colors.green);
    log("  ✓ Club created", colors.green);
    log("  ✓ Season created", colors.green);
    log("  ✓ Points system configured", colors.green);
    log("  ✓ 6 players available", colors.green);
    log("  ✓ Tournament created (scheduled)", colors.green);
    log("  ✓ 3 players registered, 3 more can register", colors.green);

    log("\nYou can now test:", colors.cyan);
    log("  - Player registration flow", colors.cyan);
    log("  - Payment confirmation", colors.cyan);
    log("  - Tournament status changes", colors.cyan);
    log("  - Starting the tournament", colors.cyan);

    logData("Club ID", createdClub.id);
    logData("Season ID", createdSeason.id);
    logData("Tournament ID", createdTournament.id);

  } catch (error) {
    log("\n✗ TEST FAILED", colors.reset);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
    log("\nDatabase connection closed", colors.cyan);
  }
}

runSetupTest().catch(console.error);
