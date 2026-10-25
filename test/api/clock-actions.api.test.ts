/**
 * POST /api/tournaments/:id/clock/actions (phase4-contracts §3.2 rules 1-2, §4.3; spec D6-D8): manual
 * clock actions on the stored anchors, with the double-tap guards (idempotent start/pause/resume, the
 * status toggle expects, the level next/prev/jump/adjust/set_remaining expect), one-level undo, a
 * compare-and-set per write, and "also start the tournament". Time is injected: Date is faked and
 * frozen at T0 (the app reads Date.now()), and tests travel by setting it, so every anchor is exact.
 */
import { asc, eq, sql } from "drizzle-orm";
import type request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOCK_LIMITS } from "@shared/domain/clock";
import { activityLog, tournamentClocks, tournaments, type Tournament } from "@shared/schema";
import { createClub, createTournament, type NewTournament } from "../factories";
import { createClock, MINUTE_MS, runningState, testStructure, type NewClock } from "../factories/clock";
import { anon, resetDb, signIn, testDb } from "../helpers";

/** Real time rounded to the minute, so sessions signed in before it stay valid. */
const T0 = Math.ceil(Date.now() / MINUTE_MS) * MINUTE_MS;
const LEVEL_1_MS = 20 * MINUTE_MS;

const travelTo = (ms: number) => vi.setSystemTime(ms);

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  travelTo(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The club owner, signed in, with an in-progress tournament and (unless `clock` is null) its clock. */
async function setup({ tournament: overrides = {}, clock = {} }: { tournament?: Partial<NewTournament>; clock?: Omit<NewClock, "tournamentId"> | null } = {}) {
  const owner = await signIn();
  const club = await createClub({ ownerId: owner.user.id });
  const tournament = await createTournament({ clubId: club.id, status: "in_progress", ...overrides });
  if (clock) await createClock({ tournamentId: tournament.id, ...clock });
  return { agent: owner.agent, owner, tournament };
}

const act = (agent: request.Agent, tournament: Tournament, body: object) => agent.post(`/api/tournaments/${tournament.id}/clock/actions`).send(body);

async function stored(tournament: Tournament) {
  const [row] = await testDb().select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournament.id));
  return row;
}

async function activity(tournament: Tournament) {
  const rows = await testDb()
    .select()
    .from(activityLog)
    .where(eq(activityLog.tournamentId, tournament.id))
    .orderBy(asc(activityLog.timestamp), asc(activityLog.id));
  return rows.map(({ eventType, description, eventData }) => ({ eventType, description, data: eventData ? JSON.parse(eventData) : null }));
}

describe("start, pause and resume", () => {
  it("starts at the derived level, stores the anchors and answers the live display", async () => {
    const { agent, owner, tournament } = await setup();

    const response = await act(agent, tournament, { action: "start" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.serverNow).toBe(T0);
    expect(response.body.clock).toMatchObject({
      status: "running",
      currentLevelIndex: 0,
      periodEndsAt: T0 + LEVEL_1_MS,
      pausedRemainingMs: null,
      startedAt: T0,
      version: 1,
      undo: {
        action: "start",
        description: "Clock started at Level 1 (100/200)",
        redo: false,
        at: T0,
        expiresAt: T0 + CLOCK_LIMITS.undoWindowMs,
        levelIndex: 0,
      },
    });
    expect(response.body.viewer).toEqual({ canControl: true, canChangeDisplay: true, clockKeyIssuedAt: null, clockKeyExpiresAt: null });
    const row = await stored(tournament);
    expect(row).toMatchObject({ status: "running", periodEndsAt: new Date(T0 + LEVEL_1_MS), startedAt: new Date(T0), updatedBy: owner.user.id });
    expect(row.undoState).toEqual({
      state: { status: "idle", currentLevelIndex: 0, periodEndsAt: null, pausedRemainingMs: null, startedAt: null },
      change: { action: "start", description: "Clock started at Level 1 (100/200)" },
      redo: false,
      at: T0,
      levelIndex: 0,
      startedTournamentFrom: null,
    });
    expect(await activity(tournament)).toEqual([
      {
        eventType: "clock_started",
        description: "Clock started at Level 1 (100/200)",
        data: { action: "start", fromLevelIndex: 0, toLevelIndex: 0, remainingMs: LEVEL_1_MS },
      },
    ]);
  });

  it("logs the start, pause and resume to the public feed (without who did it)", async () => {
    const { agent, tournament } = await setup();
    await act(agent, tournament, { action: "start" });
    await act(agent, tournament, { action: "pause" });
    await act(agent, tournament, { action: "resume" });

    const feed = await (await anon()).get(`/api/tournaments/${tournament.id}/activity`);

    expect(feed.status).toBe(200);
    expect(feed.body.map((entry: { eventType: string }) => entry.eventType)).toEqual(["clock_resumed", "clock_paused", "clock_started"]);
  });

  it("answers a repeated start, pause or resume with 200 and changes nothing (a double tap)", async () => {
    const { agent, tournament } = await setup();

    const starts = [await act(agent, tournament, { action: "start" }), await act(agent, tournament, { action: "start" }), await act(agent, tournament, { action: "resume" })];
    const pauses = [await act(agent, tournament, { action: "pause" }), await act(agent, tournament, { action: "pause" })];

    expect([...starts, ...pauses].map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(pauses[1].body.clock).toMatchObject({ status: "paused", version: 2 });
    expect((await stored(tournament)).version).toBe(2);
    expect((await activity(tournament)).map((entry) => entry.eventType)).toEqual(["clock_started", "clock_paused"]);
  });

  it("pauses with the time left and resumes it from now", async () => {
    const { agent, tournament } = await setup();
    await act(agent, tournament, { action: "start" });

    travelTo(T0 + 5 * MINUTE_MS);
    const paused = await act(agent, tournament, { action: "pause" });
    travelTo(T0 + 30 * MINUTE_MS);
    const resumed = await act(agent, tournament, { action: "resume" });

    expect(paused.body.clock).toMatchObject({ status: "paused", currentLevelIndex: 0, periodEndsAt: null, pausedRemainingMs: 15 * MINUTE_MS, startedAt: T0 });
    expect(resumed.body.clock).toMatchObject({ status: "running", currentLevelIndex: 0, periodEndsAt: T0 + 45 * MINUTE_MS, pausedRemainingMs: null, startedAt: T0 });
    expect((await activity(tournament)).slice(1).map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "clock_paused", description: "Clock paused at 15:00 in Level 1 (100/200)" },
      { eventType: "clock_resumed", description: "Clock resumed at Level 1 (100/200), 15:00 left" },
    ]);
  });

  it("toggles by the status the device showed: a stale toggle changes nothing", async () => {
    const { agent, tournament } = await setup();

    const started = await act(agent, tournament, { action: "toggle", expectedStatus: "idle" });
    const stale = await act(agent, tournament, { action: "toggle", expectedStatus: "idle" });
    const paused = await act(agent, tournament, { action: "toggle", expectedStatus: "running" });

    expect([started.status, stale.status, paused.status]).toEqual([200, 200, 200]);
    expect(started.body.clock.status).toBe("running");
    expect(stale.body.clock).toMatchObject({ status: "running", version: 1 });
    expect(paused.body.clock).toMatchObject({ status: "paused", version: 2 });
  });
});

describe("also starting the tournament (spec D8)", () => {
  it.each(["scheduled", "registration"] as const)("moves a %s tournament to in progress in the same write, and logs it", async (status) => {
    const { agent, tournament } = await setup({ tournament: { status } });

    const response = await act(agent, tournament, { action: "start", alsoStartTournament: true });

    expect(response.status).toBe(200);
    expect(response.body.tournament.status).toBe("in_progress");
    const [row] = await testDb().select().from(tournaments).where(eq(tournaments.id, tournament.id));
    expect(row.status).toBe("in_progress");
    expect((await activity(tournament)).map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "status_change", description: "Tournament status changed to In Progress" },
      { eventType: "clock_started", description: "Clock started at Level 1 (100/200)" },
    ]);
  });

  it("does so through toggle and resume too, but only when asked", async () => {
    const asked = await setup({ tournament: { status: "registration" } });
    const notAsked = await setup({ tournament: { status: "registration" } });

    await act(asked.agent, asked.tournament, { action: "toggle", expectedStatus: "idle", alsoStartTournament: true });
    await act(notAsked.agent, notAsked.tournament, { action: "resume" });

    const statuses = await testDb().select({ id: tournaments.id, status: tournaments.status }).from(tournaments);
    expect(Object.fromEntries(statuses.map(({ id, status }) => [id, status]))).toEqual({
      [asked.tournament.id]: "in_progress",
      [notAsked.tournament.id]: "registration",
    });
    expect((await activity(notAsked.tournament)).map((entry) => entry.eventType)).toEqual(["clock_started"]);
  });

  it("leaves a tournament already in progress alone, with no second status entry", async () => {
    const { agent, tournament } = await setup();

    await act(agent, tournament, { action: "start", alsoStartTournament: true });

    expect((await activity(tournament)).map((entry) => entry.eventType)).toEqual(["clock_started"]);
  });

  it("puts the tournament back to its status when that start is undone, and starts it again on redo (TDN2-UNDO-START-STATUS)", async () => {
    const { agent, tournament } = await setup({ tournament: { status: "registration" } });
    const statusOf = async () => (await testDb().select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, tournament.id)))[0].status;

    const started = await act(agent, tournament, { action: "toggle", expectedStatus: "idle", alsoStartTournament: true });
    expect(started.body.clock.undo).toMatchObject({ action: "toggle", startedTournamentFrom: "registration" });
    expect((await stored(tournament)).undoState).toMatchObject({ startedTournamentFrom: "registration" });
    travelTo(T0 + 10_000);
    const undone = await act(agent, tournament, { action: "undo" });

    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.tournament.status).toBe("registration");
    expect(undone.body.clock).toMatchObject({ status: "idle", startedAt: null, undo: { redo: true, startedTournamentFrom: "registration" } });
    expect(await statusOf()).toBe("registration");

    travelTo(T0 + 20_000);
    const redone = await act(agent, tournament, { action: "undo" });
    expect(redone.body.tournament.status).toBe("in_progress");
    expect(await statusOf()).toBe("in_progress");
    expect((await activity(tournament)).map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "status_change", description: "Tournament status changed to In Progress" },
      { eventType: "clock_started", description: "Clock started at Level 1 (100/200)" },
      { eventType: "status_change", description: "Tournament status changed to Registration Open" },
      { eventType: "clock_undone", description: "Undid: Clock started at Level 1 (100/200)" },
      { eventType: "status_change", description: "Tournament status changed to In Progress" },
      { eventType: "clock_undone", description: "Redid: Clock started at Level 1 (100/200)" },
    ]);
  });

  it("leaves the status alone when the undone start did not start the tournament, or the TD changed it since", async () => {
    const underWay = await setup();
    const reopened = await setup({ tournament: { status: "scheduled" } });

    await act(underWay.agent, underWay.tournament, { action: "start", alsoStartTournament: true });
    await act(reopened.agent, reopened.tournament, { action: "start", alsoStartTournament: true });
    expect((await stored(underWay.tournament)).undoState).toMatchObject({ startedTournamentFrom: null });
    // The TD opens registration by hand before pressing Undo.
    expect((await reopened.agent.put(`/api/tournaments/${reopened.tournament.id}`).send({ status: "registration" })).status).toBe(200);
    travelTo(T0 + 5_000);
    const undoneUnderWay = await act(underWay.agent, underWay.tournament, { action: "undo" });
    const undoneReopened = await act(reopened.agent, reopened.tournament, { action: "undo" });

    expect(undoneUnderWay.body.tournament.status).toBe("in_progress");
    expect(undoneReopened.body.tournament.status).toBe("registration");
    // Nothing to start again on redo: the undo did not move the status.
    expect(undoneReopened.body.clock.undo).toMatchObject({ redo: true, startedTournamentFrom: null });
    travelTo(T0 + 6_000);
    expect((await act(reopened.agent, reopened.tournament, { action: "undo" })).body.tournament.status).toBe("registration");
    expect((await activity(reopened.tournament)).filter((entry) => entry.eventType === "status_change").map((entry) => entry.description)).toEqual([
      "Tournament status changed to In Progress",
      "Tournament status changed to Registration Open",
    ]);
  });
});

describe("moving between levels", () => {
  it("derives auto-advance without writing, and checks each move against the level every screen shows", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 0, LEVEL_1_MS) } });

    travelTo(T0 + 25 * MINUTE_MS);
    const display = await (await anon()).get(`/api/public/tournaments/${tournament.id}/display`);
    const stale = await act(agent, tournament, { action: "next", expectedLevelIndex: 0 });
    const next = await act(agent, tournament, { action: "next", expectedLevelIndex: 1 });

    // Level 1 ended 5 minutes ago: every screen shows Level 2, but nothing was written for it.
    expect(display.body.clock).toMatchObject({ currentLevelIndex: 0, periodEndsAt: T0 + LEVEL_1_MS, version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "LEVEL_CHANGED", details: { display: { clock: { currentLevelIndex: 0, version: 0 } } } });
    expect(next.status).toBe(200);
    expect(next.body.clock).toMatchObject({ status: "running", currentLevelIndex: 2, periodEndsAt: T0 + 40 * MINUTE_MS, version: 1 });
    expect(await activity(tournament)).toEqual([
      {
        eventType: "clock_level_changed",
        description: "Moved to Break (15 min)",
        data: { action: "next", fromLevelIndex: 1, toLevelIndex: 2, remainingMs: 15 * MINUTE_MS },
      },
    ]);
  });

  it("jumps and steps back, keeping an idle or paused clock still with the whole level", async () => {
    const { agent, tournament } = await setup({ clock: { state: { status: "paused", currentLevelIndex: 0, pausedRemainingMs: 5 * MINUTE_MS, startedAt: T0 - MINUTE_MS } } });

    const jumped = await act(agent, tournament, { action: "jump", levelIndex: 3, expectedLevelIndex: 0 });
    const back = await act(agent, tournament, { action: "prev", expectedLevelIndex: 3 });

    expect(jumped.body.clock).toMatchObject({ status: "paused", currentLevelIndex: 3, pausedRemainingMs: 15 * MINUTE_MS });
    expect(back.body.clock).toMatchObject({ status: "paused", currentLevelIndex: 2, pausedRemainingMs: 15 * MINUTE_MS });
    expect((await activity(tournament)).map((entry) => entry.description)).toEqual(["Moved to Level 3 (300/600)", "Moved to Break (15 min)"]);
  });

  it("refuses a jump past the end and Previous on the first level, and answers a jump to where the clock already is with no change", async () => {
    const { agent, tournament } = await setup();

    const pastTheEnd = await act(agent, tournament, { action: "jump", levelIndex: 5 });
    const backFromFirst = await act(agent, tournament, { action: "prev", expectedLevelIndex: 0 });
    const stay = await act(agent, tournament, { action: "jump", levelIndex: 0, expectedLevelIndex: 0 });

    expect(pastTheEnd.status).toBe(409);
    expect(pastTheEnd.body).toMatchObject({ code: "LEVEL_OUT_OF_RANGE", details: { display: { clock: { version: 0 } } } });
    expect(backFromFirst.status).toBe(409);
    expect(backFromFirst.body).toMatchObject({
      code: "NO_PREVIOUS_LEVEL",
      error: "This is the first level: there is no level before it",
      details: { display: { clock: { currentLevelIndex: 0, version: 0 } } },
    });
    expect(stay.status).toBe(200);
    expect(stay.body.clock.version).toBe(0);
    expect(await activity(tournament)).toEqual([]);
  });

  it("holds the final level at 0:00, and says so when Next is pressed there (TDN3-NEXT-FINAL-SILENT)", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 4, 15 * MINUTE_MS) } });

    travelTo(T0 + 3 * 60 * MINUTE_MS);
    const next = await act(agent, tournament, { action: "next", expectedLevelIndex: 4 });

    expect(next.status).toBe(409);
    expect(next.body).toMatchObject({
      code: "NO_NEXT_LEVEL",
      error: "This is the final level: add levels to the structure to go on",
      details: { display: { clock: { status: "running", currentLevelIndex: 4, version: 0 } } },
    });
    expect(await activity(tournament)).toEqual([]);
  });
});

describe("adjusting the time", () => {
  it("adds and takes time off the running level, or sets it", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 0, LEVEL_1_MS) } });

    const added = await act(agent, tournament, { action: "adjust", deltaSeconds: 60, expectedLevelIndex: 0 });
    const taken = await act(agent, tournament, { action: "adjust", deltaSeconds: -90, expectedLevelIndex: 0 });
    const set = await act(agent, tournament, { action: "set_remaining", remainingSeconds: 720, expectedLevelIndex: 0 });

    expect([added, taken, set].map((response) => response.body.clock.periodEndsAt)).toEqual([
      T0 + 21 * MINUTE_MS,
      T0 + 19.5 * MINUTE_MS,
      T0 + 12 * MINUTE_MS,
    ]);
    expect((await activity(tournament)).map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "clock_time_adjusted", description: "Added 1:00 to Level 1 (100/200)" },
      { eventType: "clock_time_adjusted", description: "Took 1:30 off Level 1 (100/200)" },
      { eventType: "clock_time_adjusted", description: "Clock set to 12:00 in Level 1 (100/200)" },
    ]);
  });

  it("keeps time changes out of the public feed (staff only)", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 0, LEVEL_1_MS) } });
    await act(agent, tournament, { action: "adjust", deltaSeconds: 60 });

    const publicFeed = await (await anon()).get(`/api/tournaments/${tournament.id}/activity`);
    const staffFeed = await agent.get(`/api/tournaments/${tournament.id}/activity`);

    expect(publicFeed.body).toEqual([]);
    expect(staffFeed.body.map((entry: { eventType: string }) => entry.eventType)).toEqual(["clock_time_adjusted"]);
  });

  it("sets the time of an idle clock without starting it", async () => {
    const { agent, tournament } = await setup();

    const response = await act(agent, tournament, { action: "set_remaining", remainingSeconds: 600, expectedLevelIndex: 0 });

    expect(response.body.clock).toMatchObject({ status: "idle", currentLevelIndex: 0, periodEndsAt: null, pausedRemainingMs: 10 * MINUTE_MS, startedAt: null });
  });
});

describe("reset and undo", () => {
  it("resets to Level 1; undo puts the clock back where it was, running on from the time it had left; a second undo redoes the reset", async () => {
    const running = runningState(T0, 1, 7 * MINUTE_MS, T0 - 33 * MINUTE_MS);
    const { agent, tournament } = await setup({ clock: { state: running } });

    const reset = await act(agent, tournament, { action: "reset" });
    travelTo(T0 + MINUTE_MS);
    const undone = await act(agent, tournament, { action: "undo" });
    travelTo(T0 + MINUTE_MS + 5_000);
    const redone = await act(agent, tournament, { action: "undo" });

    expect(reset.body.clock).toMatchObject({ status: "idle", currentLevelIndex: 0, periodEndsAt: null, pausedRemainingMs: null, startedAt: null, undo: { action: "reset", redo: false } });
    expect(reset.body.clock.undo).toMatchObject({ action: "reset", description: "Clock reset to Level 1 (100/200)", redo: false });
    // The minute the reset clock stood idle is not counted as played (P4REV1-02).
    expect(undone.body.clock).toMatchObject({ ...running, periodEndsAt: T0 + MINUTE_MS + 7 * MINUTE_MS, undo: { action: "reset", redo: true } });
    expect(undone.body.clock.undo).toMatchObject({ action: "reset", redo: true, at: T0 + MINUTE_MS });
    expect(redone.body.clock).toMatchObject({ status: "idle", currentLevelIndex: 0, startedAt: null });
    expect((await activity(tournament)).map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "clock_reset", description: "Clock reset to Level 1 (100/200)" },
      { eventType: "clock_undone", description: "Undid: Clock reset to Level 1 (100/200)" },
      { eventType: "clock_undone", description: "Redid: Clock reset to Level 1 (100/200)" },
    ]);
  });

  it("changes nothing on a second reset, so Undo still brings the clock back (P4REV1-CC-04)", async () => {
    const running = runningState(T0, 2, 5 * MINUTE_MS, T0 - 45 * MINUTE_MS);
    const { agent, tournament } = await setup({ clock: { state: running } });

    await act(agent, tournament, { action: "reset" });
    travelTo(T0 + 5_000);
    const again = await act(agent, tournament, { action: "reset" });
    travelTo(T0 + 10_000);
    const undone = await act(agent, tournament, { action: "undo" });

    expect(again.status).toBe(200);
    expect(again.body.clock).toMatchObject({ version: 1, undo: { action: "reset", at: T0, redo: false } });
    expect(undone.body.clock).toMatchObject({ ...running, periodEndsAt: T0 + 10_000 + 5 * MINUTE_MS });
    expect((await activity(tournament)).map((entry) => entry.eventType)).toEqual(["clock_reset", "clock_undone"]);
  });

  it("undoes once for two taps or two devices naming the same undo: the second changes nothing (P4REV1-CC-01)", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 1, 12 * MINUTE_MS) } });
    const otherDevice = (await signIn({ role: "admin" })).agent;

    const paused = await act(agent, tournament, { action: "pause" });
    const shown = { at: paused.body.clock.undo.at, redo: paused.body.clock.undo.redo };
    travelTo(T0 + 3_000);
    const taps = await Promise.all([
      act(agent, tournament, { action: "undo", expectedUndo: shown }),
      act(otherDevice, tournament, { action: "undo", expectedUndo: shown }),
    ]);

    expect(taps.map((tap) => tap.status)).toEqual([200, 200]);
    expect(await stored(tournament)).toMatchObject({ status: "running", version: 2, periodEndsAt: new Date(T0 + 3_000 + 12 * MINUTE_MS) });
    expect((await activity(tournament)).map((entry) => entry.description)).toEqual([
      "Clock paused at 12:00 in Level 2 (200/400)",
      "Undid: Clock paused at 12:00 in Level 2 (200/400)",
    ]);
    // The redo the screen now shows still works.
    const { at, redo } = taps[0].body.clock.undo as { at: number; redo: boolean };
    expect((await act(agent, tournament, { action: "undo", expectedUndo: { at, redo } })).body.clock.status).toBe("paused");
  });

  it("still undoes with an undo stored before it recorded a tournament start", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 1, 7 * MINUTE_MS) } });
    await act(agent, tournament, { action: "pause" });
    await testDb().execute(sql`UPDATE tournament_clocks SET undo_state = undo_state - 'startedTournamentFrom' WHERE tournament_id = ${tournament.id}`);

    const undone = await act(agent, tournament, { action: "undo" });

    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.clock).toMatchObject({ status: "running", undo: { startedTournamentFrom: null } });
  });

  it("undoes a pause as a resume from the time left at the pause, however long it was paused within the window", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 1, 12 * MINUTE_MS) } });

    await act(agent, tournament, { action: "pause" });
    travelTo(T0 + 100_000);
    const undone = await act(agent, tournament, { action: "undo" });

    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.clock).toMatchObject({ status: "running", currentLevelIndex: 1, periodEndsAt: T0 + 100_000 + 12 * MINUTE_MS });
  });

  it("refuses an undo two minutes after the change (NOTHING_TO_UNDO), and stops offering it", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 1, 12 * MINUTE_MS) } });

    await act(agent, tournament, { action: "pause" });
    travelTo(T0 + CLOCK_LIMITS.undoWindowMs + 1);
    const display = await agent.get(`/api/public/tournaments/${tournament.id}/display`);
    const late = await act(agent, tournament, { action: "undo" });

    expect(display.body.clock).toMatchObject({ status: "paused", undo: null });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: "NOTHING_TO_UNDO", error: expect.stringContaining("Too late to undo"), details: { display: { clock: { status: "paused" } } } });
    expect((await stored(tournament)).status).toBe("paused");
  });

  it("refuses an undo once the clock has moved to the next level by itself", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 0, 4 * MINUTE_MS) } });

    await act(agent, tournament, { action: "set_remaining", remainingSeconds: 2, expectedLevelIndex: 0 });
    travelTo(T0 + 3_000);
    const late = await act(agent, tournament, { action: "undo" });

    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: "NOTHING_TO_UNDO", details: { display: { clock: { currentLevelIndex: 0, undo: null } } } });
  });

  it("answers NOTHING_TO_UNDO with no snapshot, and for an undo_state stored before snapshots said what they revert", async () => {
    const none = await setup({ clock: { state: runningState(T0, 1, 7 * MINUTE_MS) } });
    const legacy = await setup({ clock: { state: runningState(T0, 1, 7 * MINUTE_MS) } });
    // The shape undo_state had before (a bare ClockState), as an older build wrote it.
    const bare = JSON.stringify({ status: "idle", currentLevelIndex: 0, periodEndsAt: null, pausedRemainingMs: null, startedAt: null });
    await testDb().execute(sql`UPDATE tournament_clocks SET undo_state = ${bare}::jsonb WHERE tournament_id = ${legacy.tournament.id}`);

    for (const { agent, tournament } of [none, legacy]) {
      const response = await act(agent, tournament, { action: "undo" });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "NOTHING_TO_UNDO", details: { display: { clock: { undo: null } } } });
    }
  });
});

describe("refusals", () => {
  it("answers 404 NO_CLOCK without a clock", async () => {
    const { agent, tournament } = await setup({ clock: null });

    const response = await act(agent, tournament, { action: "start" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: expect.any(String), code: "NO_CLOCK" });
  });

  it("refuses a clock with no levels (NO_LEVELS) and a finished clock (CLOCK_FINISHED), with the display", async () => {
    const empty = await setup({ clock: { structure: testStructure({ levels: [] }) } });
    const finished = await setup({ clock: { state: { status: "finished", pausedRemainingMs: 0 } } });

    const noLevels = await act(empty.agent, empty.tournament, { action: "start" });
    const stopped = await act(finished.agent, finished.tournament, { action: "next" });

    expect([noLevels.status, stopped.status]).toEqual([409, 409]);
    expect(noLevels.body).toMatchObject({ code: "NO_LEVELS", details: { display: { tournament: { id: empty.tournament.id } } } });
    expect(stopped.body).toMatchObject({ code: "CLOCK_FINISHED", details: { display: { clock: { status: "finished" } } } });
  });

  it.each(["completed", "cancelled"] as const)("refuses every action once the tournament is %s (TOURNAMENT_CLOSED, with the display)", async (status) => {
    const { agent, tournament } = await setup({ tournament: { status }, clock: { state: runningState(T0, 0, LEVEL_1_MS) } });

    const responses = [await act(agent, tournament, { action: "pause" }), await act(agent, tournament, { action: "undo" })];

    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { display: { viewer: { canControl: false }, clock: { status: "running" } } } });
    }
    expect((await stored(tournament)).version).toBe(0);
  });

  it("validates the action (400)", async () => {
    const { agent, tournament } = await setup();

    for (const body of [{ action: "explode" }, { action: "adjust", deltaSeconds: 0 }, { action: "jump" }, { action: "set_remaining", remainingSeconds: -1 }]) {
      const response = await act(agent, tournament, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.code).toBe("VALIDATION");
    }
  });
});

describe("concurrent devices", () => {
  it("never skips a level: two nexts from the same level give one 200 and one 409 LEVEL_CHANGED", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 0, LEVEL_1_MS) } });
    const other = await signIn({ role: "admin" });

    const responses = await Promise.all([
      act(agent, tournament, { action: "next", expectedLevelIndex: 0 }),
      act(other.agent, tournament, { action: "next", expectedLevelIndex: 0 }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
      code: "LEVEL_CHANGED",
      details: { display: { clock: { currentLevelIndex: 1 } } },
    });
    expect(await stored(tournament)).toMatchObject({ currentLevelIndex: 1, version: 1 });
    expect((await activity(tournament)).map((entry) => entry.eventType)).toEqual(["clock_level_changed"]);
  });

  it("pauses once when two devices pause at the same moment, and both see 200", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 0, LEVEL_1_MS) } });
    const other = await signIn({ role: "admin" });

    const responses = await Promise.all([act(agent, tournament, { action: "pause" }), act(other.agent, tournament, { action: "pause" })]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await stored(tournament)).toMatchObject({ status: "paused", pausedRemainingMs: LEVEL_1_MS, version: 1 });
    expect((await activity(tournament)).map((entry) => entry.eventType)).toEqual(["clock_paused"]);
  });

  it("applies concurrent time changes one after the other: each one that answers 200 counts exactly once", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 0, LEVEL_1_MS) } });

    const responses = await Promise.all(Array.from({ length: 4 }, () => act(agent, tournament, { action: "adjust", deltaSeconds: 60 })));

    for (const response of responses) expect([200, 409], JSON.stringify(response.body)).toContain(response.status);
    const applied = responses.filter((response) => response.status === 200).length;
    for (const refused of responses.filter((response) => response.status === 409)) expect(refused.body.code).toBe("VERSION_CONFLICT");
    expect(applied).toBeGreaterThan(0);
    expect(await stored(tournament)).toMatchObject({ periodEndsAt: new Date(T0 + LEVEL_1_MS + applied * MINUTE_MS), version: applied });
    expect(await activity(tournament)).toHaveLength(applied);
  });
});
