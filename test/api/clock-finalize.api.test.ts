/**
 * Finalize stops the clock (phase4-contracts §3.2 rule 6, spec D18): in finalize's own transaction
 * the clock is set to finished on the level it had reached (no period, no time left, no undo, no TV
 * clock key), and a correction (forced re-finalize) repeats it harmlessly. Cancelling pauses a running
 * clock with the time it had left and ends its undo and TV key (P4REV1-CC-05): no clock write is
 * accepted while the tournament is cancelled, and a reopened tournament finds the clock where it was.
 */
import { eq } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClockState } from "@shared/domain/clock";
import { activityLog, tournamentClocks, tournaments, type Tournament } from "@shared/schema";
import { createTournamentScenario, createUser, type TournamentScenario } from "../factories";
import { createClock, MINUTE_MS, runningState, undoSnapshot } from "../factories/clock";
import { loginAs, resetDb, testDb } from "../helpers";

beforeEach(resetDb);

/** Four players, two busted: the owner finalizes with the two still in given in order. */
async function scenarioWithClock({ clock = true, state }: { clock?: boolean; state?: Partial<ClockState> } = {}) {
  const owner = await createUser();
  const scenario = await createTournamentScenario({ players: 4, eliminations: [0, 1], owner, tournament: { status: "in_progress" } });
  const now = Date.now();
  if (clock) {
    await createClock({
      tournamentId: scenario.tournament.id,
      state: state ?? runningState(now, 3, 6 * MINUTE_MS, now - 70 * MINUTE_MS),
      undoState: undoSnapshot({ status: "paused", currentLevelIndex: 3, periodEndsAt: null, pausedRemainingMs: MINUTE_MS, startedAt: now - 70 * MINUTE_MS }),
      version: 5,
    });
    await testDb()
      .update(tournamentClocks)
      .set({ controlKeyHash: "a".repeat(64), controlKeyIssuedAt: new Date(now) })
      .where(eq(tournamentClocks.tournamentId, scenario.tournament.id));
  }
  const { agent } = await loginAs({ email: owner.email });
  return { scenario, agent, order: [scenario.registrations[2].id, scenario.registrations[3].id] };
}

const finalize = (agent: request.Agent, scenario: TournamentScenario, body: object) => agent.post(`/api/tournaments/${scenario.tournament.id}/finalize`).send(body);

async function clockOf(tournament: Tournament) {
  const [row] = await testDb().select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournament.id));
  return row;
}

describe("finalize and the clock", () => {
  it("stops the clock for good in the same transaction", async () => {
    const { scenario, agent, order } = await scenarioWithClock();

    const response = await finalize(agent, scenario, { finishOrder: order });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await clockOf(scenario.tournament)).toMatchObject({
      status: "finished",
      currentLevelIndex: 3,
      periodEndsAt: null,
      pausedRemainingMs: 0,
      undoState: null,
      controlKeyHash: null,
      controlKeyIssuedAt: null,
      version: 6,
    });
    const display = await agent.get(`/api/public/tournaments/${scenario.tournament.id}/display`);
    expect(display.body).toMatchObject({
      tournament: { status: "completed" },
      clock: { status: "finished", undo: null },
      viewer: { canControl: false, canChangeDisplay: false, clockKeyIssuedAt: null, clockKeyExpiresAt: null },
    });
  });

  it("finishes the clock on the level it had run on to by itself, not where the last manual action left it (P4REV1-01)", async () => {
    // Started at Level 1, whose 20 minutes ended 30 minutes ago: Level 2 (20) has ended too, and the
    // 15-minute break (index 2) has 5 minutes left.
    const now = Date.now();
    const { scenario, agent, order } = await scenarioWithClock({ state: runningState(now, 0, -30 * MINUTE_MS, now - 50 * MINUTE_MS) });

    const response = await finalize(agent, scenario, { finishOrder: order });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await clockOf(scenario.tournament)).toMatchObject({ status: "finished", currentLevelIndex: 2, periodEndsAt: null });
    const display = await agent.get(`/api/public/tournaments/${scenario.tournament.id}/display`);
    expect(display.body.clock).toMatchObject({ status: "finished", currentLevelIndex: 2 });
  });

  it("repeats it harmlessly when the results are corrected", async () => {
    const { scenario, agent, order } = await scenarioWithClock();
    await finalize(agent, scenario, { finishOrder: order });
    const corrected = [...order].reverse();
    const preview = await agent.post(`/api/tournaments/${scenario.tournament.id}/finalize/preview`).send({ finishOrder: corrected, force: true });

    const response = await finalize(agent, scenario, { finishOrder: corrected, force: true, expectedPlanHash: preview.body.planHash });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await clockOf(scenario.tournament)).toMatchObject({ status: "finished", periodEndsAt: null, pausedRemainingMs: 0, version: 7 });
  });

  it("finalizes a tournament that never had a clock", async () => {
    const { scenario, agent, order } = await scenarioWithClock({ clock: false });

    const response = await finalize(agent, scenario, { finishOrder: order });

    expect(response.status).toBe(200);
    expect(await clockOf(scenario.tournament)).toBeUndefined();
  });

  it("pauses a running clock with the time it had left when the tournament is cancelled, ending its undo and TV key (P4REV1-CC-05)", async () => {
    const { scenario, agent } = await scenarioWithClock();
    const id = scenario.tournament.id;
    const before = await clockOf(scenario.tournament);

    const cancelled = await agent.put(`/api/tournaments/${id}`).send({ status: "cancelled" });
    const pause = await agent.post(`/api/tournaments/${id}/clock/actions`).send({ action: "resume" });

    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const [row] = await testDb().select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, id));
    expect(row.status).toBe("cancelled");
    expect(pause.status).toBe(409);
    expect(pause.body.code).toBe("TOURNAMENT_CLOSED");
    const after = await clockOf(scenario.tournament);
    expect(after).toMatchObject({
      status: "paused",
      currentLevelIndex: 3,
      periodEndsAt: null,
      startedAt: before.startedAt,
      undoState: null,
      controlKeyHash: null,
      controlKeyIssuedAt: null,
      controlKeyIssuedBy: null,
      version: 6,
    });
    // The 6 minutes it had left, less the moments the requests took.
    expect(after.pausedRemainingMs).toBeGreaterThan(5 * MINUTE_MS);
    expect(after.pausedRemainingMs).toBeLessThanOrEqual(6 * MINUTE_MS);
    const entries = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, id));
    expect(entries.map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "status_change", description: "Tournament status changed to Cancelled" },
      { eventType: "clock_paused", description: expect.stringMatching(/^Clock paused at \d+:\d\d in Level 3 \(300\/600\): the tournament was cancelled$/) },
    ]);

    // Reopened, the clock is still where the cancel left it, not hours ahead.
    expect((await agent.put(`/api/tournaments/${id}`).send({ status: "registration" })).status).toBe(200);
    const display = await agent.get(`/api/public/tournaments/${id}/display`);
    expect(display.body.clock).toMatchObject({ status: "paused", currentLevelIndex: 3, pausedRemainingMs: after.pausedRemainingMs });
  });

  it("leaves an idle clock with no undo and no TV key untouched when the tournament is cancelled", async () => {
    const { scenario, agent } = await scenarioWithClock({ clock: false });
    await createClock({ tournamentId: scenario.tournament.id, version: 2 });
    const before = await clockOf(scenario.tournament);

    expect((await agent.put(`/api/tournaments/${scenario.tournament.id}`).send({ status: "cancelled" })).status).toBe(200);

    expect(await clockOf(scenario.tournament)).toEqual(before);
  });
});
