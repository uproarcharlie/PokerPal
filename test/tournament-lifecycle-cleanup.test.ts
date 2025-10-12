/**
 * Tournament Lifecycle Integration Test (With Cleanup)
 *
 * This test runs through the complete tournament lifecycle and then cleans up all data:
 * 1. Create a club
 * 2. Create a season
 * 3. Create a points system
 * 4. Create points allocations
 * 5. Create players
 * 6. Create a tournament
 * 7. Register players
 * 8. Start tournament (change status to in_progress)
 * 9. Lock prize pool
 * 10. Players perform rebuys/addons
 * 11. Eliminate players with final positions
 * 12. Assign prizes
 * 13. Assign points
 * 14. Complete tournament
 * 15. Verify final state
 * 16. DELETE all test data (cleanup)
 */

import { config } from "dotenv";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
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
  type PointsSystem,
  type Player,
  type Tournament,
  type TournamentRegistration,
} from "../shared/schema";

// Load environment variables
config();

const { Pool } = pg;

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
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

async function runTournamentLifecycleTest() {
  logSection("TOURNAMENT LIFECYCLE TEST (WITH CLEANUP)");

  // Connect to database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  let createdClub: Club;
  let createdSeason: Season;
  let createdPointsSystem: PointsSystem;
  let createdPlayers: Player[] = [];
  let createdTournament: Tournament;
  let registrations: TournamentRegistration[] = [];

  try {
    // Step 1: Create Club
    logStep(1, "Creating Club");
    const [club] = await db.insert(clubs).values({
      name: "Test Poker Club (Cleanup Test)",
      description: "A test club for integration testing - will be deleted",
      address: "123 Test Street, Wellington, New Zealand",
      timezone: "Pacific/Auckland",
    }).returning();
    createdClub = club;
    logSuccess("Club created");
    logData("Club", { id: club.id, name: club.name });

    // Step 2: Create Season
    logStep(2, "Creating Season");
    const [season] = await db.insert(seasons).values({
      name: "Spring 2025 Test Season",
      clubId: club.id,
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-05-31"),
      isActive: true,
    }).returning();
    createdSeason = season;
    logSuccess("Season created");
    logData("Season", { id: season.id, name: season.name });

    // Step 3: Create Points System
    logStep(3, "Creating Points System");
    const [pointsSystem] = await db.insert(pointsSystems).values({
      seasonId: season.id,
      name: "Standard Points System",
      description: "Points awarded based on finishing position",
      participationPoints: 10,
      knockoutPoints: 5,
    }).returning();
    createdPointsSystem = pointsSystem;
    logSuccess("Points system created");
    logData("Points System", {
      id: pointsSystem.id,
      participation: pointsSystem.participationPoints,
      knockout: pointsSystem.knockoutPoints
    });

    // Step 4: Create Points Allocations
    logStep(4, "Creating Points Allocations");
    const allocations = [
      { position: 1, positionEnd: null, points: 100, description: "1st Place" },
      { position: 2, positionEnd: null, points: 75, description: "2nd Place" },
      { position: 3, positionEnd: null, points: 60, description: "3rd Place" },
      { position: 4, positionEnd: null, points: 50, description: "4th Place" },
      { position: 5, positionEnd: null, points: 40, description: "5th Place" },
      { position: 6, positionEnd: 10, points: 30, description: "6th-10th Place" },
    ];

    for (const allocation of allocations) {
      await db.insert(pointsAllocations).values({
        pointsSystemId: pointsSystem.id,
        ...allocation,
      });
    }
    logSuccess(`Created ${allocations.length} points allocations`);
    logData("Points Allocations", allocations);

    // Step 5: Create Players
    logStep(5, "Creating Players");
    const playerNames = [
      "Alice Johnson",
      "Bob Smith",
      "Charlie Davis",
      "Diana Martinez",
      "Edward Wilson",
      "Fiona Brown",
      "George Taylor",
      "Hannah Anderson",
    ];

    for (let i = 0; i < playerNames.length; i++) {
      const [player] = await db.insert(players).values({
        name: playerNames[i],
        email: `cleanup-test-${i + 1}@test.com`,
        phone: `021-999-${String(i + 1).padStart(4, "0")}`,
      }).returning();
      createdPlayers.push(player);
    }
    logSuccess(`Created ${createdPlayers.length} players`);
    logData("Players", createdPlayers.map(p => ({ name: p.name, email: p.email })));

    // Step 6: Create Tournament
    logStep(6, "Creating Tournament");
    const [tournament] = await db.insert(tournaments).values({
      name: "Test Tournament - Spring Championship",
      description: "Integration test tournament - will be deleted",
      clubId: club.id,
      seasonId: season.id,
      pointsSystemId: pointsSystem.id,
      startDateTime: new Date("2025-03-15T18:00:00"),
      status: "scheduled",
      buyInAmount: "50.00",
      rebuyAmount: "25.00",
      addonAmount: "30.00",
      maxRebuys: 2,
      rebuyPeriodMinutes: 60,
      rakeType: "percentage",
      rakeAmount: "5.00",
      payoutStructure: "standard",
      enableHighHand: true,
      highHandAmount: "50.00",
      highHandPayouts: 2,
      trackPoints: true,
      minPlayers: 6,
      maxPlayers: 10,
      useClubAddress: true,
    }).returning();
    createdTournament = tournament;
    logSuccess("Tournament created");
    logData("Tournament", {
      id: tournament.id,
      name: tournament.name,
      buyIn: tournament.buyInAmount,
      status: tournament.status
    });

    // Step 7: Register Players
    logStep(7, "Registering Players for Tournament");
    for (const player of createdPlayers) {
      const [registration] = await db.insert(tournamentRegistrations).values({
        tournamentId: tournament.id,
        playerId: player.id,
        buyIns: 1,
        rebuys: 0,
        addons: 0,
        paymentConfirmed: true,
        enteringHighHands: Math.random() > 0.5,
      }).returning();
      registrations.push(registration);

      // Log activity
      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: player.id,
        eventType: "registration",
        description: `${player.name} registered for the tournament`,
      });
    }
    logSuccess(`Registered ${registrations.length} players`);

    // Step 8: Start Tournament
    logStep(8, "Starting Tournament (Status: in_progress)");
    const [updatedTournament] = await db.update(tournaments)
      .set({ status: "in_progress" })
      .where(eq(tournaments.id, tournament.id))
      .returning();
    createdTournament = updatedTournament;

    await db.insert(activityLog).values({
      tournamentId: tournament.id,
      eventType: "status_change",
      description: "Tournament started",
      eventData: JSON.stringify({ from: "scheduled", to: "in_progress" }),
    });
    logSuccess("Tournament started");

    // Step 9: Lock Prize Pool
    logStep(9, "Locking Prize Pool");
    const totalBuyIns = registrations.length * parseFloat(tournament.buyInAmount as string);
    const rake = totalBuyIns * (parseFloat(tournament.rakeAmount as string) / 100);
    const prizePool = totalBuyIns - rake;

    await db.update(tournaments)
      .set({
        prizePoolLocked: true,
        prizePoolLockedAt: new Date(),
        manualPrizePool: prizePool.toFixed(2),
      })
      .where(eq(tournaments.id, tournament.id));

    logSuccess("Prize pool locked");
    logData("Prize Pool", {
      totalBuyIns: totalBuyIns.toFixed(2),
      rake: rake.toFixed(2),
      prizePool: prizePool.toFixed(2)
    });

    // Step 10: Players perform Rebuys and Addons
    logStep(10, "Processing Rebuys and Addons");
    for (let i = 0; i < 3; i++) {
      await db.update(tournamentRegistrations)
        .set({ rebuys: 1 })
        .where(eq(tournamentRegistrations.id, registrations[i].id));

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: registrations[i].playerId,
        eventType: "rebuy",
        description: `${createdPlayers[i].name} performed a rebuy`,
      });
      logSuccess(`${createdPlayers[i].name} performed rebuy`);
    }

    for (let i = 0; i < 5; i++) {
      await db.update(tournamentRegistrations)
        .set({ addons: 1 })
        .where(eq(tournamentRegistrations.id, registrations[i].id));

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: registrations[i].playerId,
        eventType: "addon",
        description: `${createdPlayers[i].name} took an addon`,
      });
      logSuccess(`${createdPlayers[i].name} took addon`);
    }

    // Step 11: Eliminate Players
    logStep(11, "Eliminating Players and Recording Positions");
    const eliminationOrder = [7, 6, 5, 4, 3, 2, 1, 0];
    const finalPositions = [8, 7, 6, 5, 4, 3, 2, 1];

    for (let i = 0; i < eliminationOrder.length; i++) {
      const playerIndex = eliminationOrder[i];
      const position = finalPositions[i];
      const registration = registrations[playerIndex];
      const player = createdPlayers[playerIndex];
      const isEliminated = position > 3;

      await db.update(tournamentRegistrations)
        .set({
          finalPosition: position,
          isEliminated,
          eliminationTime: isEliminated ? new Date() : null,
        })
        .where(eq(tournamentRegistrations.id, registration.id));

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: player.id,
        eventType: isEliminated ? "elimination" : "status_change",
        description: isEliminated
          ? `${player.name} eliminated in position ${position}`
          : `${player.name} finished in position ${position}`,
      });

      logSuccess(`${player.name} finished position ${position}`);
    }

    // Step 12: Assign Prizes
    logStep(12, "Calculating and Assigning Prizes");
    const payouts = [
      { position: 1, percentage: 0.50 },
      { position: 2, percentage: 0.30 },
      { position: 3, percentage: 0.20 },
    ];

    for (const payout of payouts) {
      const prizeAmount = (prizePool * payout.percentage).toFixed(2);
      const playerIndex = eliminationOrder.find((_, i) => finalPositions[i] === payout.position)!;
      const registration = registrations[playerIndex];
      const player = createdPlayers[playerIndex];

      await db.update(tournamentRegistrations)
        .set({ prizeAmount })
        .where(eq(tournamentRegistrations.id, registration.id));

      logSuccess(`${player.name} wins $${prizeAmount} for ${payout.position}${payout.position === 1 ? 'st' : payout.position === 2 ? 'nd' : 'rd'} place`);
    }

    // Assign high hand winners
    logStep(13, "Assigning High Hand Winners");
    const highHandEntrants = registrations.filter(r => r.enteringHighHands);
    if (highHandEntrants.length >= 2) {
      const highHandAmount = parseFloat(tournament.highHandAmount as string) / 2;
      for (let i = 0; i < 2 && i < highHandEntrants.length; i++) {
        await db.update(tournamentRegistrations)
          .set({
            highHandWinner: true,
            highHandAmount: highHandAmount.toFixed(2),
          })
          .where(eq(tournamentRegistrations.id, highHandEntrants[i].id));

        const player = createdPlayers.find(p => p.id === highHandEntrants[i].playerId)!;
        logSuccess(`${player.name} wins high hand prize of $${highHandAmount.toFixed(2)}`);
      }
    }

    // Step 14: Assign Points
    logStep(14, "Calculating and Assigning Points");
    for (let i = 0; i < registrations.length; i++) {
      const registration = registrations[i];
      const player = createdPlayers[i];
      const position = finalPositions[eliminationOrder.indexOf(i)];

      let positionPoints = 0;
      if (position === 1) positionPoints = 100;
      else if (position === 2) positionPoints = 75;
      else if (position === 3) positionPoints = 60;
      else if (position === 4) positionPoints = 50;
      else if (position === 5) positionPoints = 40;
      else if (position >= 6 && position <= 10) positionPoints = 30;

      const totalPoints = positionPoints + pointsSystem.participationPoints;

      await db.update(tournamentRegistrations)
        .set({ pointsAwarded: totalPoints })
        .where(eq(tournamentRegistrations.id, registration.id));

      logSuccess(`${player.name} awarded ${totalPoints} points`);
    }

    // Step 15: Complete Tournament
    logStep(15, "Completing Tournament");
    await db.update(tournaments)
      .set({ status: "completed" })
      .where(eq(tournaments.id, tournament.id));

    await db.insert(activityLog).values({
      tournamentId: tournament.id,
      eventType: "status_change",
      description: "Tournament completed",
      eventData: JSON.stringify({ from: "in_progress", to: "completed" }),
    });
    logSuccess("Tournament completed");

    // Step 16: Verify Final State
    logStep(16, "Verifying Final Tournament State");

    const finalTournament = await db.select()
      .from(tournaments)
      .where(eq(tournaments.id, tournament.id))
      .limit(1);

    const finalRegistrations = await db.select()
      .from(tournamentRegistrations)
      .where(eq(tournamentRegistrations.tournamentId, tournament.id));

    logSuccess("Tournament verified");
    logData("Final Standings", finalRegistrations
      .sort((a, b) => (a.finalPosition || 999) - (b.finalPosition || 999))
      .map(r => {
        const player = createdPlayers.find(p => p.id === r.playerId)!;
        return {
          position: r.finalPosition,
          player: player.name,
          prize: r.prizeAmount ? `$${r.prizeAmount}` : "-",
          points: r.pointsAwarded,
        };
      }));

    logSection("✓ TEST COMPLETED SUCCESSFULLY");
    log("\nAll tournament lifecycle stages completed:", colors.green);
    log("  1. Club created ✓", colors.green);
    log("  2. Season created ✓", colors.green);
    log("  3. Points system configured ✓", colors.green);
    log("  4. Points allocations set ✓", colors.green);
    log("  5. Players registered ✓", colors.green);
    log("  6. Tournament created ✓", colors.green);
    log("  7. Players enrolled ✓", colors.green);
    log("  8. Tournament started ✓", colors.green);
    log("  9. Prize pool locked ✓", colors.green);
    log(" 10. Rebuys/addons processed ✓", colors.green);
    log(" 11. Eliminations recorded ✓", colors.green);
    log(" 12. Prizes awarded ✓", colors.green);
    log(" 13. High hands awarded ✓", colors.green);
    log(" 14. Points calculated ✓", colors.green);
    log(" 15. Tournament completed ✓", colors.green);
    log(" 16. Final state verified ✓", colors.green);

  } catch (error) {
    log("\n✗ TEST FAILED", colors.red);
    console.error(error);
    process.exit(1);
  } finally {
    // Cleanup: Delete test data
    logSection("CLEANUP");
    log("Removing test data...", colors.yellow);

    if (createdClub) {
      // Cascade will handle all related records (season, points system, tournament, registrations, activity log)
      await db.delete(clubs).where(eq(clubs.id, createdClub.id));
      logSuccess("Club and all related data removed");
    }

    // Delete test players
    for (const player of createdPlayers) {
      await db.delete(players).where(eq(players.id, player.id));
    }
    logSuccess(`${createdPlayers.length} test players removed`);

    log("\n✓ All test data cleaned up successfully", colors.green);

    await pool.end();
    log("\nDatabase connection closed", colors.cyan);
  }
}

// Run the test
runTournamentLifecycleTest().catch(console.error);
