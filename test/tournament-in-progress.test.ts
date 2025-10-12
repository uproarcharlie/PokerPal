/**
 * Tournament In-Progress Test
 *
 * Creates tournament that's actively running:
 * 1. Create club, season, points system
 * 2. Create players
 * 3. Create tournament
 * 4. Register all players
 * 5. Start tournament (status: in_progress)
 * 6. Lock prize pool
 * 7. Some players do rebuys/addons
 * 8. Stop here (ready for eliminations)
 *
 * USE CASE: Test active tournament features (eliminations, knockouts, etc.)
 * STATUS: Tournament in progress, ready for player eliminations
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

async function runInProgressTest() {
  logSection("TOURNAMENT IN-PROGRESS TEST");
  log("Creates active tournament ready for eliminations", colors.cyan);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  let createdClub: Club;
  let createdSeason: Season;
  let createdTournament: Tournament;

  try {
    // Step 1: Create Infrastructure
    logStep(1, "Creating Club and Season");
    const [club] = await db.insert(clubs).values({
      name: "In-Progress Test Club",
      description: "Active tournament testing",
      address: "789 Active St, Wellington, New Zealand",
      timezone: "Pacific/Auckland",
    }).returning();
    createdClub = club;

    const [season] = await db.insert(seasons).values({
      name: "Summer 2025 Active Tournament",
      clubId: club.id,
      startDate: new Date("2025-09-01"),
      endDate: new Date("2025-11-30"),
      isActive: true,
    }).returning();
    createdSeason = season;
    logSuccess("Club and season created");

    // Step 2: Create Points System
    logStep(2, "Creating Points System");
    const [pointsSystem] = await db.insert(pointsSystems).values({
      seasonId: season.id,
      name: "Summer Points",
      participationPoints: 20,
      knockoutPoints: 10,
    }).returning();

    await db.insert(pointsAllocations).values([
      { pointsSystemId: pointsSystem.id, position: 1, positionEnd: null, points: 150, description: "Winner" },
      { pointsSystemId: pointsSystem.id, position: 2, positionEnd: null, points: 100, description: "2nd" },
      { pointsSystemId: pointsSystem.id, position: 3, positionEnd: null, points: 75, description: "3rd" },
      { pointsSystemId: pointsSystem.id, position: 4, positionEnd: 8, points: 40, description: "4th-8th" },
    ]);
    logSuccess("Points system created");

    // Step 3: Create Players
    logStep(3, "Creating Players");
    const playerNames = [
      "Active Alice", "Busy Bob", "Competitive Charlie", "Determined Diana",
      "Eager Edward", "Focused Fiona", "Gutsy George", "Hungry Hannah",
    ];

    const createdPlayers = [];
    for (let i = 0; i < playerNames.length; i++) {
      const [player] = await db.insert(players).values({
        name: playerNames[i],
        email: `active-${i + 1}@test.com`,
        phone: `021-200-${String(i + 1).padStart(4, "0")}`,
      }).returning();
      createdPlayers.push(player);
    }
    logSuccess(`Created ${createdPlayers.length} players`);

    // Step 4: Create Tournament
    logStep(4, "Creating Tournament");
    const [tournament] = await db.insert(tournaments).values({
      name: "Saturday Night Championship - LIVE",
      description: "Tournament currently in progress",
      clubId: club.id,
      seasonId: season.id,
      pointsSystemId: pointsSystem.id,
      startDateTime: new Date("2025-09-15T18:30:00"),
      status: "scheduled",
      buyInAmount: "60.00",
      rebuyAmount: "30.00",
      addonAmount: "40.00",
      maxRebuys: 2,
      rebuyPeriodMinutes: 120,
      rakeType: "percentage",
      rakeAmount: "10.00",
      payoutStructure: "standard",
      enableHighHand: true,
      highHandAmount: "60.00",
      highHandPayouts: 2,
      trackPoints: true,
      minPlayers: 6,
      maxPlayers: 10,
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
        paymentConfirmed: true,
        enteringHighHands: Math.random() > 0.4,
      }).returning();
      registrations.push(registration);

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: player.id,
        eventType: "registration",
        description: `${player.name} registered`,
      });
    }
    logSuccess(`${registrations.length} players registered`);

    // Step 6: Start Tournament
    logStep(6, "Starting Tournament (Status: in_progress)");
    await db.update(tournaments)
      .set({ status: "in_progress" })
      .where(eq(tournaments.id, tournament.id));

    await db.insert(activityLog).values({
      tournamentId: tournament.id,
      eventType: "status_change",
      description: "Tournament started - cards in the air!",
      eventData: JSON.stringify({ from: "scheduled", to: "in_progress" }),
    });
    logSuccess("Tournament started");

    // Step 7: Lock Prize Pool
    logStep(7, "Locking Prize Pool");
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
      total: totalBuyIns.toFixed(2),
      rake: rake.toFixed(2),
      prizePool: prizePool.toFixed(2),
    });

    // Step 8: Some Rebuys and Addons
    logStep(8, "Processing Rebuys and Addons");

    // First 2 players rebuy
    for (let i = 0; i < 2; i++) {
      await db.update(tournamentRegistrations)
        .set({ rebuys: 1 })
        .where(eq(tournamentRegistrations.id, registrations[i].id));

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: createdPlayers[i].id,
        eventType: "rebuy",
        description: `${createdPlayers[i].name} performed rebuy`,
      });
      logSuccess(`${createdPlayers[i].name} rebought`);
    }

    // First 4 players take addons
    for (let i = 0; i < 4; i++) {
      await db.update(tournamentRegistrations)
        .set({ addons: 1 })
        .where(eq(tournamentRegistrations.id, registrations[i].id));

      await db.insert(activityLog).values({
        tournamentId: tournament.id,
        playerId: createdPlayers[i].id,
        eventType: "addon",
        description: `${createdPlayers[i].name} took addon`,
      });
      logSuccess(`${createdPlayers[i].name} took addon`);
    }

    logSection("✓ IN-PROGRESS TEST COMPLETED");
    log("\nTournament actively running:", colors.green);
    log("  ✓ Club and season created", colors.green);
    log("  ✓ Points system configured", colors.green);
    log("  ✓ 8 players registered and confirmed", colors.green);
    log("  ✓ Tournament started (in_progress)", colors.green);
    log("  ✓ Prize pool locked ($" + prizePool.toFixed(2) + ")", colors.green);
    log("  ✓ 2 rebuys and 4 addons performed", colors.green);

    log("\nYou can now test:", colors.cyan);
    log("  - Player eliminations", colors.cyan);
    log("  - Knockout tracking", colors.cyan);
    log("  - Final positions", colors.cyan);
    log("  - High hand assignment", colors.cyan);
    log("  - Prize distribution", colors.cyan);
    log("  - Points calculation", colors.cyan);

    log("\nCurrent players still active:", colors.magenta);
    createdPlayers.forEach((p, i) => {
      const reg = registrations[i];
      const rebuyText = i < 2 ? " (+1 rebuy)" : "";
      const addonText = i < 4 ? " (+addon)" : "";
      log(`  ${i + 1}. ${p.name}${rebuyText}${addonText}`, colors.magenta);
    });

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

runInProgressTest().catch(console.error);
