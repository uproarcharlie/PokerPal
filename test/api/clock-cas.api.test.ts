/**
 * The clock's compare-and-set (phase4-contracts §3.2 rule 1): a write planned from a read that another
 * write has since overtaken is retried from a fresh read (up to three attempts, then 409
 * VERSION_CONFLICT with the display), and a tournament that closes between the read and the write is
 * refused.
 *
 * The races are real and made deterministic in the database. A second connection holds the
 * tournament's row lock (the lock every clock write takes after reading the clock), so the request
 * stops between its read and its compare-and-set; the competing change lands while it waits. For the
 * three-attempt cap, a trigger in this file's own database makes every clock write lose.
 */
import { eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import type request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { structureHash } from "@shared/domain/clock";
import { activityLog, tournamentClocks, type Tournament } from "@shared/schema";
import { getPool } from "../../server/db";
import { CLOCK_WRITE_ATTEMPTS } from "../../server/services/clock";
import { createClub, createTournament } from "../factories";
import { createClock, testStructure } from "../factories/clock";
import { resetDb, signIn, testDb } from "../helpers";

beforeAll(async () => {
  await getPool().query(`
    CREATE TABLE test_clock_cas_losses (remaining integer NOT NULL);
    CREATE FUNCTION test_lose_clock_cas() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE test_clock_cas_losses SET remaining = remaining - 1 WHERE remaining > 0;
      IF FOUND THEN RETURN NULL; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_lose_clock_cas BEFORE UPDATE ON tournament_clocks FOR EACH ROW EXECUTE FUNCTION test_lose_clock_cas();`);
});

afterAll(async () => {
  await getPool().query(`
    DROP TRIGGER test_lose_clock_cas ON tournament_clocks;
    DROP FUNCTION test_lose_clock_cas();
    DROP TABLE test_clock_cas_losses;`);
});

beforeEach(async () => {
  await resetDb();
  await getPool().query("INSERT INTO test_clock_cas_losses (remaining) VALUES (0)");
});

async function setup() {
  const owner = await signIn();
  const club = await createClub({ ownerId: owner.user.id });
  const tournament = await createTournament({ clubId: club.id, status: "in_progress" });
  await createClock({ tournamentId: tournament.id });
  return { agent: owner.agent, tournament };
}

async function stored(tournament: Tournament) {
  const [row] = await testDb().select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournament.id));
  return row;
}

const activityCount = async (tournament: Tournament) =>
  (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournament.id))).length;

/** Another device's write to the clock, as one committed statement. */
const anotherWrite = (tournament: Tournament, values: Partial<typeof tournamentClocks.$inferInsert> = {}) =>
  testDb()
    .update(tournamentClocks)
    .set({ ...values, version: sql`${tournamentClocks.version} + 1` })
    .where(eq(tournamentClocks.tournamentId, tournament.id));

/** Resolves once some other connection of this database is waiting for a lock. */
async function someoneIsWaitingForALock(): Promise<void> {
  for (let check = 0; check < 500; check++) {
    const { rows } = await getPool().query<{ waiting: number }>(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if (rows[0].waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The request never waited for the tournament's lock");
}

/**
 * Sends `send()` while another connection holds the tournament's row lock; once the request is
 * waiting for it (its clock already read and its change planned), runs `meanwhile` with that
 * connection, then commits and lets the request carry on.
 */
async function racing(tournament: Tournament, send: () => request.Test, meanwhile: (client: PoolClient) => Promise<unknown>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE", [tournament.id]);
    const pending = send().then((response) => response);
    await someoneIsWaitingForALock();
    await meanwhile(client);
    await client.query("COMMIT");
    return await pending;
  } finally {
    client.release();
  }
}

describe("the clock's compare-and-set", () => {
  it("retries a write whose read another write overtook, and applies it once", async () => {
    const { agent, tournament } = await setup();

    const response = await racing(
      tournament,
      () => agent.post(`/api/tournaments/${tournament.id}/clock/actions`).send({ action: "start" }),
      () => anotherWrite(tournament),
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    // The other write (version 1), then this one, planned again from a fresh read (version 2).
    expect(response.body.clock).toMatchObject({ status: "running", version: 2 });
    expect(await activityCount(tournament)).toBe(1);
  });

  it("re-checks a structure edit's base hash on the retry (STRUCTURE_CHANGED)", async () => {
    const { agent, tournament } = await setup();

    const response = await racing(
      tournament,
      () => agent.put(`/api/tournaments/${tournament.id}/clock`).send({ structure: testStructure({ startingStack: 20_000 }), baseHash: structureHash(testStructure()) }),
      () => anotherWrite(tournament, { startingStack: 50_000 }),
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STRUCTURE_CHANGED", details: { display: { clock: { version: 1 } } } });
    expect((await stored(tournament)).startingStack).toBe(50_000);
  });

  it("refuses a write to a tournament that closed after the clock was read (TOURNAMENT_CLOSED), changing nothing", async () => {
    const { agent, tournament } = await setup();

    const response = await racing(
      tournament,
      () => agent.post(`/api/tournaments/${tournament.id}/clock/actions`).send({ action: "start" }),
      (client) => client.query("UPDATE tournaments SET status = 'cancelled' WHERE id = $1", [tournament.id]),
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { display: { clock: { status: "idle" }, viewer: { canControl: false } } } });
    expect(await stored(tournament)).toMatchObject({ status: "idle", version: 0 });
    expect(await activityCount(tournament)).toBe(0);
  });

  it(`succeeds on the last of its ${CLOCK_WRITE_ATTEMPTS} attempts`, async () => {
    const { agent, tournament } = await setup();
    await getPool().query("UPDATE test_clock_cas_losses SET remaining = $1", [CLOCK_WRITE_ATTEMPTS - 1]);

    const response = await agent.post(`/api/tournaments/${tournament.id}/clock/actions`).send({ action: "start" });

    expect(response.status).toBe(200);
    expect(await stored(tournament)).toMatchObject({ status: "running", version: 1 });
  });

  it(`gives up after ${CLOCK_WRITE_ATTEMPTS} lost races with 409 VERSION_CONFLICT, carrying the clock as it is`, async () => {
    const { agent, tournament } = await setup();
    await getPool().query("UPDATE test_clock_cas_losses SET remaining = $1", [CLOCK_WRITE_ATTEMPTS]);

    const response = await agent.post(`/api/tournaments/${tournament.id}/clock/actions`).send({ action: "start" });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "VERSION_CONFLICT", details: { display: { clock: { status: "idle", version: 0 } } } });
    expect(await activityCount(tournament)).toBe(0);
  });
});
