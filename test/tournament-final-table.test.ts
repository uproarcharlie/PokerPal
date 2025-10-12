/**
 * Tournament Final Table Test
 *
 * Creates tournament at final table stage:
 * 1. Create club, season, points system
 * 2. Create players
 * 3. Create tournament
 * 4. Register all players
 * 5. Start tournament and lock prize pool
 * 6. Eliminate half the players (final table of 4)
 * 7. Stop here (ready for final table play)
 *
 * USE CASE: Test final table dynamics, prize distribution, points
 * STATUS: Tournament at final table (4 players remaining)
 * DATA: Kept in database
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

async function runFinalTableTest() {
  logSection("TOURNAMENT FINAL TABLE TEST");
  log("Creates tournament at final table (4 players remaining)", colors.cyan);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  let createdClub: Club;
  let createdSeason: Season;
  let createdTournament: Tournament;

  try {
    // Step 1: Create Infrastructure
    logStep(1, "Creating Club and Season");
    const [club] = await db.insert(clubs).values({
      name: "Final Table Test Club",
      description: "Final table testing",
      address: "321 Finals Rd, Wellington, New Zealand",
      timezone: "Pacific/Auckland",
    }).returning();
    createdClub = club;

    const [season] = await db.insert(seasons).values({
      name: "Autumn 2025 Finals Season",
      clubId: club.id,
      startDate: new Date("2025-12-01"),
      endDate: new Date("2026-02-28"),
      isActive: true,
    }).returning();
    createdSeason = season;
    logSuccess("Club and season created");

    // Step 2: Create Points System
    logStep(2, "Creating Points System");
    const [pointsSystem] = await db.insert(pointsSystems).values({
      seasonId: season.id,
      name: "Championship Points",
      participationPoints: 25,
      knockoutPoints: 15,
    }).returning();

    await db.insert(pointsAllocations).values([
      { pointsSystemId: pointsSystem.id, position: 1, positionEnd: null, points: 200, description: "Champion" },
      { pointsSystemId: pointsSystem.id, position: 2, positionEnd: null, points: 140, description: "Runner-up" },
      { pointsSystemId: pointsSystem.id, position: 3, positionEnd: null, points: 100, description: "3rd" },
      { pointsSystemId: pointsSystem.id, position: 4, positionEnd: null, points: 70, description: "4th" },
      { pointsSystemId: pointsSystem.id, position: 5, positionEnd: 8, points: 40, description: "5th-8th" },
    ]);
    logSuccess("Points system created");

    // Step 3: Create Players
    logStep(3, "Creating Players");
    const playerNames = [
      "Final Four Felix", "Chip Leader Clara", "Short Stack Sam", "Big Blind Betty",
      "Bubble Boy Barry", "Early Exit Emma", "Cooler Chris", "Bad Beat Brad",
    ];

    const createdPlayers = [];
    for (let i = 0; i < playerNames.length; i++) {
      const [player] = await db.insert(players).values({
        name: playerNames[i],
        email: `final-table-${i + 1}@test.com`,
        phone: `021-300-${String(i + 1).padStart(4, "0")}`,
      }).returning();
      createdPlayers.push(player);
    }
    logSuccess(`Created ${createdPlayers.length} players`);

    // Step 4: Create Tournament
    logStep(4, "Creating Tournament");
    const [tournament] = await db.insert(tournaments).values({
      name: "Championship Final Table - LIVE",
      description: "Down to final 4 players",
      clubId: club.id,
      seasonId: season.id,
      pointsSystemId: pointsSystem.id,
      startDateTime: new Date("2025-12-10T17:00:00"),
      status: "scheduled",
      buyInAmount: "100.00",
      rebuyAmount: "50.00",
      addonAmount: "60.00",
      maxRebuys: 1,
      rebuyPeriodMinutes: 90,
      rakeType: "percentage",
      rakeAmount: "8.00",
      payoutStructure: "top3",
      enableHighHand: true,
      highHandAmount: "80.00",
      highHandPayouts: 1,
      trackPoints: true,
      minPlayers: 6,
      maxPlayers: 8,
      useClubAddress: true,
    }).returning();
    createdTournament = tournament;
    logSuccess("Tournament created");

    // Step 5: Register All Players
    logStep(5, "Registering All Players");
    const registrations = [];
    for (const player of createdPlayers) {
      const [registration] = await db.insert(tournamentRegistrations).values({
        tournamentId: tournament.id,
        playerId: player.id,
        buyIns: 1,
        rebuys: Math.random() > 0.5 ? 1 : 0,
        addons: Math.random() > 0.6 ? 1 : 0,
        paymentConfirmed: true,
        enteringHighHands: true,
      }).returning();
      registrations.push(registration);
    }
    logSuccess(`${registrations.length} players registered`);

    // Step 6: Start Tournament
    logStep(6, "Starting Tournament");
    await db.update(tournaments)
      .set({ status: "in_progress" })
      .where(eq(tournaments.id, tournament.id));

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

    logSuccess("Tournament started and prize pool locked");
    logData("Prize Pool", { prizePool: `$${prizePool.toFixed(2)}` });

    // Step 7: Eliminate Players (positions 8, 7, 6, 5 - leaving 4 at final table)
    logStep(7, "Eliminating Players (Down to Final 4)");
    const eliminatedIndices = [7, 6, 5, 4]; // Last 4 players eliminated
    const positions = [8, 7, 6, 5];

    for (let i = 0; i < eliminatedIndices.length; i++) {
      const playerIndex = eliminatedIndices[i];
      const position = positions[i];
      const registration = registrations[playerIndex];
      const player = createdPlayers[playerIndex];

      await db.update(tournamentRegistrations)
        .set({
          finalPosition: position,
          isEliminated: true,
          eliminationTime: new Date(),
        })
        .where(eq(tournamentRegistrations.id, registration.id));

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: player.id,
        eventType: "elimination",
        description: `${player.name} eliminated in ${position}${position === 8 ? 'th' : position === 7 ? 'th' : position === 6 ? 'th' : 'th'} place`,
      });

      logSuccess(`${player.name} eliminated - ${position}${position === 8 ? 'th' : position === 7 ? 'th' : position === 6 ? 'th' : 'th'} place`);
    }

    logSection("✓ FINAL TABLE TEST COMPLETED");
    log("\nFinal table reached:", colors.green);
    log("  ✓ 8 players started", colors.green);
    log("  ✓ 4 players eliminated (8th, 7th, 6th, 5th)", colors.green);
    log("  ✓ 4 players remain at FINAL TABLE", colors.green);
    log("  ✓ Prize pool: $" + prizePool.toFixed(2), colors.green);

    log("\n🏆 PLAYERS REMAINING AT FINAL TABLE:", colors.magenta + colors.bright);
    for (let i = 0; i < 4; i++) {
      const player = createdPlayers[i];
      const reg = registrations[i];
      log(`  ${i + 1}. ${player.name} (${reg.rebuys} rebuy, ${reg.addons} addon)`, colors.magenta);
    }

    log("\n💰 PRIZE DISTRIBUTION (Top 3):", colors.yellow);
    log(`  1st Place: $${(prizePool * 0.50).toFixed(2)} (50%)`, colors.yellow);
    log(`  2nd Place: $${(prizePool * 0.30).toFixed(2)} (30%)`, colors.yellow);
    log(`  3rd Place: $${(prizePool * 0.20).toFixed(2)} (20%)`, colors.yellow);

    log("\nYou can now test:", colors.cyan);
    log("  - Final table eliminations", colors.cyan);
    log("  - Prize distribution to top 3", colors.cyan);
    log("  - High hand winner selection", colors.cyan);
    log("  - Points allocation (200/140/100/70)", colors.cyan);
    log("  - Tournament completion", colors.cyan);

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

runFinalTableTest().catch(console.error);
