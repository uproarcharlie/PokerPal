/**
 * The clock's set-up and settings (phase4-contracts §3.2 rules 3-5, 9): PUT /api/tournaments/:id/clock
 * (create with baseHash null, or replace the structure from the hash the editor started from, keeping
 * the clock on its level), PATCH .../clock/display, DELETE .../clock, and GET
 * /api/clubs/:id/blind-structures ("copy from a previous game"). Every write answers the live display;
 * every 409 carries it as details.display. Date is faked (frozen) so a running clock's anchors are exact.
 */
import { asc, eq } from "drizzle-orm";
import type request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@shared/api/clock";
import { presetStructure } from "@shared/domain/blind-structures";
import { structureHash, type BlindLevel, type ClockStructure } from "@shared/domain/clock";
import { activityLog, tournamentClocks, type Tournament } from "@shared/schema";
import { createClub, createTournament, type NewTournament } from "../factories";
import { createClock, MINUTE_MS, runningState, testStructure, undoSnapshot, type NewClock } from "../factories/clock";
import { anon, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

const T0 = Math.ceil(Date.now() / MINUTE_MS) * MINUTE_MS;
const travelTo = (ms: number) => vi.setSystemTime(ms);

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  travelTo(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup({ tournament: overrides = {}, clock = null }: { tournament?: Partial<NewTournament>; clock?: Omit<NewClock, "tournamentId"> | null } = {}) {
  const owner = await signIn();
  const club = await createClub({ ownerId: owner.user.id });
  const tournament = await createTournament({ clubId: club.id, status: "in_progress", ...overrides });
  if (clock) await createClock({ tournamentId: tournament.id, ...clock });
  return { agent: owner.agent, club, tournament };
}

const configure = (agent: request.Agent, tournament: Tournament, body: object) => agent.put(`/api/tournaments/${tournament.id}/clock`).send(body);
const patchDisplay = (agent: request.Agent, tournament: Tournament, body: object) => agent.patch(`/api/tournaments/${tournament.id}/clock/display`).send(body);

async function stored(tournament: Tournament) {
  const [row] = await testDb().select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournament.id));
  return row;
}

async function activity(tournament: Tournament) {
  return testDb()
    .select({ eventType: activityLog.eventType, description: activityLog.description, eventData: activityLog.eventData })
    .from(activityLog)
    .where(eq(activityLog.tournamentId, tournament.id))
    .orderBy(asc(activityLog.timestamp), asc(activityLog.id));
}

const CENTRAL_STARS = "central_stars_one_life_line";

describe("PUT /api/tournaments/:id/clock: setting the clock up (baseHash null)", () => {
  it("creates the clock from a preset: 201, idle at Level 1, with its first display settings, logged for staff only", async () => {
    const { agent, tournament } = await setup();
    const structure = presetStructure(CENTRAL_STARS);

    const response = await configure(agent, tournament, { structure, presetKey: CENTRAL_STARS, displaySettings: { showAp: true }, baseHash: null });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.clock).toEqual({
      version: 0,
      status: "idle",
      currentLevelIndex: 0,
      periodEndsAt: null,
      pausedRemainingMs: null,
      startedAt: null,
      structure,
      structureHash: structureHash(structure),
      presetKey: CENTRAL_STARS,
      displaySettings: { ...DEFAULT_DISPLAY_SETTINGS, showAp: true },
      undo: null,
      updatedAt: expect.any(String),
    });
    expect((await stored(tournament)).displaySettings).toEqual({ showAp: true });
    const [entry] = await activity(tournament);
    expect(entry).toMatchObject({ eventType: "clock_structure_updated", description: "Clock set up: Central Stars · One Life Line (24 levels)" });
    expect(JSON.parse(entry.eventData ?? "{}")).toEqual({ presetKey: CENTRAL_STARS, levelCount: 27, structureHash: structureHash(structure) });
    expect((await (await anon()).get(`/api/tournaments/${tournament.id}/activity`)).body).toEqual([]);
  });

  it("stores the structure normalized: no antes when the mode is none, blank break notes as null", async () => {
    const { agent, tournament } = await setup();
    const levels = [
      { kind: "level", id: "a", durationMinutes: 15, smallBlind: 25, bigBlind: 50, ante: 50 },
      { kind: "break", id: "b", durationMinutes: 10, note: "   " },
      { kind: "level", id: "c", durationMinutes: 15, smallBlind: 50, bigBlind: 100 },
    ];

    const response = await configure(agent, tournament, {
      structure: { levels, anteMode: "none", startingStack: 5_000, rebuyStack: null, addonStack: null, earlyBirdStack: null },
      baseHash: null,
    });

    expect(response.status).toBe(201);
    expect((await stored(tournament)).levels).toEqual([
      { kind: "level", id: "a", durationMinutes: 15, smallBlind: 25, bigBlind: 50, ante: 0 },
      { kind: "break", id: "b", durationMinutes: 10, note: null },
      { kind: "level", id: "c", durationMinutes: 15, smallBlind: 50, bigBlind: 100, ante: 0 },
    ]);
    expect(response.body.clock.presetKey).toBeNull();
    expect((await activity(tournament)).map((entry) => entry.description)).toEqual(["Clock set up (2 levels)"]);
  });

  it("refuses a second set-up with 409 CLOCK_EXISTS, carrying the clock that exists", async () => {
    const { agent, tournament } = await setup({ clock: { version: 4 } });

    const response = await configure(agent, tournament, { structure: testStructure(), baseHash: null });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "CLOCK_EXISTS", details: { display: { clock: { version: 4 } } } });
    expect(await activity(tournament)).toEqual([]);
  });

  it("validates the structure (400)", async () => {
    const { agent, tournament } = await setup();
    const breakOnly: BlindLevel[] = [{ kind: "break", id: "b1", durationMinutes: 10, note: null }];
    const upsideDown: BlindLevel[] = [{ kind: "level", id: "l1", durationMinutes: 10, smallBlind: 400, bigBlind: 200, ante: 0 }];

    for (const body of [
      { structure: testStructure({ levels: breakOnly }), baseHash: null },
      { structure: testStructure({ levels: upsideDown }), baseHash: null },
      { structure: testStructure(), presetKey: "no_such_preset", baseHash: null },
      { structure: testStructure(), baseHash: "not-a-hash" },
      { structure: testStructure() },
    ]) {
      const response = await configure(agent, tournament, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.code).toBe("VALIDATION");
    }
    expect(await stored(tournament)).toBeUndefined();
  });

  it("refuses a closed tournament with 409 TOURNAMENT_CLOSED (with the display)", async () => {
    const { agent, tournament } = await setup({ tournament: { status: "cancelled" } });

    const response = await configure(agent, tournament, { structure: testStructure(), baseHash: null });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { display: { clock: null, viewer: { canControl: false } } } });
  });
});

describe("PUT /api/tournaments/:id/clock: editing the structure (baseHash given)", () => {
  /** The test structure with Level 1 renamed in blinds, Level 2 removed or another level inserted. */
  const edited = (change: (levels: BlindLevel[]) => BlindLevel[]): ClockStructure => {
    const structure = testStructure();
    return { ...structure, levels: change(structure.levels.map((level) => ({ ...level }))) };
  };
  const BASE = structureHash(testStructure());

  it("replaces the structure, clears the undo snapshot and logs it", async () => {
    const { agent, tournament } = await setup({
      clock: { version: 3, undoState: undoSnapshot({ status: "idle", currentLevelIndex: 0, periodEndsAt: null, pausedRemainingMs: null, startedAt: null }) },
    });
    const structure = edited((levels) => [{ kind: "level", id: "l1", durationMinutes: 20, smallBlind: 150, bigBlind: 300, ante: 0 }, ...levels.slice(1)]);

    const response = await configure(agent, tournament, { structure, baseHash: BASE });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.clock).toMatchObject({ structure, structureHash: structureHash(structure), version: 4, undo: null });
    expect((await stored(tournament)).undoState).toBeNull();
    expect((await activity(tournament)).map((entry) => entry.description)).toEqual(["Blind structure updated (4 levels)"]);
  });

  it("keeps a running clock on its level and its time when rows change around it", async () => {
    const { agent, tournament } = await setup({ clock: { state: runningState(T0, 1, 20 * MINUTE_MS) } });
    travelTo(T0 + 5 * MINUTE_MS);
    const inserted = edited((levels) => [{ kind: "level", id: "l0", durationMinutes: 10, smallBlind: 50, bigBlind: 100, ante: 0 }, ...levels]);

    const first = await configure(agent, tournament, { structure: inserted, baseHash: BASE });
    const longer = edited((levels) => [{ kind: "level", id: "l0", durationMinutes: 10, smallBlind: 50, bigBlind: 100, ante: 0 }, levels[0], { ...levels[1], durationMinutes: 25 }, ...levels.slice(2)]);
    const second = await configure(agent, tournament, { structure: longer, baseHash: structureHash(inserted) });

    // Level 2 had 15 minutes left: it is now the third row, still with 15 minutes, then 5 more when made 5 minutes longer.
    expect(first.body.clock).toMatchObject({ status: "running", currentLevelIndex: 2, periodEndsAt: T0 + 20 * MINUTE_MS });
    expect(second.body.clock).toMatchObject({ status: "running", currentLevelIndex: 2, periodEndsAt: T0 + 25 * MINUTE_MS });
  });

  it("refuses a save from a stale editor with 409 STRUCTURE_CHANGED, carrying the structure as it is", async () => {
    const saved = testStructure({ startingStack: 20_000 });
    const { agent, tournament } = await setup({ clock: { structure: saved } });

    const response = await configure(agent, tournament, { structure: testStructure({ startingStack: 30_000 }), baseHash: BASE });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STRUCTURE_CHANGED", details: { display: { clock: { structureHash: structureHash(saved) } } } });
    expect((await stored(tournament)).startingStack).toBe(20_000);
  });

  it("refuses to remove the level a running clock is on (CURRENT_LEVEL_REMOVED), but not an idle clock's", async () => {
    const running = await setup({ clock: { state: runningState(T0, 1, 10 * MINUTE_MS) } });
    const idle = await setup({ clock: { state: { currentLevelIndex: 1 } } });
    const withoutLevel2 = edited((levels) => levels.filter((level) => level.id !== "l2"));

    const refused = await configure(running.agent, running.tournament, { structure: withoutLevel2, baseHash: BASE });
    const allowed = await configure(idle.agent, idle.tournament, { structure: withoutLevel2, baseHash: BASE });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "CURRENT_LEVEL_REMOVED", details: { display: { clock: { currentLevelIndex: 1 } } } });
    expect(allowed.status).toBe(200);
    expect(allowed.body.clock).toMatchObject({ status: "idle", currentLevelIndex: 1 });
  });

  it("refuses a finished clock (CLOCK_FINISHED) and a missing one (404 NO_CLOCK)", async () => {
    const finished = await setup({ clock: { state: { status: "finished", pausedRemainingMs: 0 } } });
    const none = await setup();

    const stopped = await configure(finished.agent, finished.tournament, { structure: testStructure({ startingStack: 1 }), baseHash: BASE });
    const missing = await configure(none.agent, none.tournament, { structure: testStructure(), baseHash: BASE });

    expect(stopped.status).toBe(409);
    expect(stopped.body).toMatchObject({ code: "CLOCK_FINISHED", details: { display: { clock: { status: "finished" } } } });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: expect.any(String), code: "NO_CLOCK" });
  });

  it("writes nothing for a save that changes nothing, and keeps the preset unless one is sent", async () => {
    const { agent, tournament } = await setup({ clock: { presetKey: CENTRAL_STARS, version: 2 } });

    const same = await configure(agent, tournament, { structure: testStructure(), baseHash: BASE });
    const cleared = await configure(agent, tournament, { structure: testStructure(), presetKey: null, baseHash: BASE });

    expect(same.status).toBe(200);
    expect(same.body.clock).toMatchObject({ version: 2, presetKey: CENTRAL_STARS });
    expect(cleared.body.clock).toMatchObject({ version: 3, presetKey: null });
    expect(await activity(tournament)).toHaveLength(1);
  });

  it("ignores display settings sent with an edit (PATCH .../clock/display changes them)", async () => {
    const { agent, tournament } = await setup({ clock: { displaySettings: { qrTarget: "none" } } });

    const response = await configure(agent, tournament, { structure: testStructure({ startingStack: 12_000 }), displaySettings: { qrTarget: "seats" }, baseHash: BASE });

    expect(response.status).toBe(200);
    expect(response.body.clock.displaySettings.qrTarget).toBe("none");
  });
});

describe("PATCH /api/tournaments/:id/clock/display", () => {
  it("merges the settings, answers the display they make, and logs nothing", async () => {
    const { agent, tournament } = await setup({ clock: { displaySettings: { showPayouts: false } } });

    const response = await patchDisplay(agent, tournament, { showAp: true, qrTarget: "seats" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.clock).toMatchObject({ version: 1, displaySettings: { ...DEFAULT_DISPLAY_SETTINGS, showPayouts: false, showAp: true, qrTarget: "seats" } });
    expect(response.body.qr).toEqual({ target: "seats", path: `/tournament/${tournament.id}/seats` });
    expect(response.body.money.apCents).toBe(0);
    expect((await stored(tournament)).displaySettings).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, showPayouts: false, showAp: true, qrTarget: "seats" });
    expect(await activity(tournament)).toEqual([]);
  });

  it("writes nothing when the settings already are so", async () => {
    const { agent, tournament } = await setup({ clock: {} });

    const response = await patchDisplay(agent, tournament, { overlay: "none", showAverageStack: true });

    expect(response.body.clock.version).toBe(0);
  });

  it("validates the patch (400) and needs a clock (404 NO_CLOCK)", async () => {
    const withClock = await setup({ clock: {} });
    const withoutClock = await setup();

    for (const body of [{}, { colour: "red" }, { showPrizePool: "sometimes" }]) {
      const response = await patchDisplay(withClock.agent, withClock.tournament, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const missing = await patchDisplay(withoutClock.agent, withoutClock.tournament, { showAp: true });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("NO_CLOCK");
  });

  it("refuses a closed tournament (TOURNAMENT_CLOSED)", async () => {
    const { agent, tournament } = await setup({ tournament: { status: "completed" }, clock: {} });

    const response = await patchDisplay(agent, tournament, { showAp: true });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { display: { clock: { version: 0 } } } });
  });
});

describe("DELETE /api/tournaments/:id/clock", () => {
  it("removes the clock and logs it once; removing it again is a no-op", async () => {
    const { agent, tournament } = await setup({ clock: {} });

    const first = await agent.delete(`/api/tournaments/${tournament.id}/clock`);
    const again = await agent.delete(`/api/tournaments/${tournament.id}/clock`);

    expect([first.status, again.status]).toEqual([200, 200]);
    expect(first.body).toMatchObject({ clock: null, tournament: { id: tournament.id } });
    expect(await stored(tournament)).toBeUndefined();
    expect((await activity(tournament)).map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "clock_reset", description: "Clock removed" },
    ]);
  });

  it("refuses a running or paused clock with 409 CLOCK_IN_USE, keeping it and its settings, until it is reset (TDN2-REMOVE-CLOCK-MIDGAME)", async () => {
    const settings = { qrTarget: "seats" as const, showAp: true };
    const running = await setup({ clock: { state: runningState(T0, 2, 7 * MINUTE_MS, T0 - 50 * MINUTE_MS), displaySettings: settings } });
    const paused = await setup({ clock: { state: { status: "paused", currentLevelIndex: 1, pausedRemainingMs: 4 * MINUTE_MS, startedAt: T0 - 30 * MINUTE_MS } } });

    for (const { agent, tournament } of [running, paused]) {
      const response = await agent.delete(`/api/tournaments/${tournament.id}/clock`);
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body).toMatchObject({ code: "CLOCK_IN_USE", error: "The clock is under way: reset it first, then remove it" });
      expect(response.body.details.display.clock).not.toBeNull();
      expect(await stored(tournament)).toBeDefined();
      expect(await activity(tournament)).toEqual([]);
    }
    expect((await stored(running.tournament)).displaySettings).toEqual(settings);

    // Reset (which Undo can still take back), then remove.
    const reset = await running.agent.post(`/api/tournaments/${running.tournament.id}/clock/actions`).send({ action: "reset" });
    expect(reset.status).toBe(200);
    expect((await running.agent.delete(`/api/tournaments/${running.tournament.id}/clock`)).status).toBe(200);
    expect(await stored(running.tournament)).toBeUndefined();
  });

  it("refuses a closed tournament (TOURNAMENT_CLOSED) and keeps the clock", async () => {
    const { agent, tournament } = await setup({ tournament: { status: "completed" }, clock: {} });

    const response = await agent.delete(`/api/tournaments/${tournament.id}/clock`);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { display: { clock: { status: "idle" } } } });
    expect(await stored(tournament)).toBeDefined();
  });
});

describe("GET /api/clubs/:id/blind-structures", () => {
  it("lists the club's clocks' structures, latest start first, each once, without empty ones or other clubs'", async () => {
    const { agent, club } = await setup();
    const other = await createClub();
    const a = testStructure();
    const b = testStructure({ startingStack: 25_000 });
    const at = (day: number) => new Date(Date.UTC(2026, 0, day, 19));
    const tournamentWith = async (clubId: string, day: number, structure: ClockStructure, presetKey: string | null = null) => {
      const tournament = await createTournament({ clubId, startDateTime: at(day), name: `Night ${day}` });
      await createClock({ tournamentId: tournament.id, structure, presetKey });
      return tournament;
    };
    await tournamentWith(club.id, 1, a);
    const second = await tournamentWith(club.id, 2, b);
    const third = await tournamentWith(club.id, 3, a, CENTRAL_STARS);
    await tournamentWith(club.id, 4, testStructure({ levels: [] }));
    await tournamentWith(other.id, 5, testStructure({ startingStack: 99_000 }));

    const response = await agent.get(`/api/clubs/${club.id}/blind-structures`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { tournamentId: third.id, tournamentName: "Night 3", startDateTime: at(3).toISOString(), presetKey: CENTRAL_STARS, structure: a, structureHash: structureHash(a) },
      { tournamentId: second.id, tournamentName: "Night 2", startDateTime: at(2).toISOString(), presetKey: null, structure: b, structureHash: structureHash(b) },
    ]);
  });

  it("lists at most 10 structures", async () => {
    const { agent, club } = await setup();
    for (let day = 1; day <= 12; day++) {
      const tournament = await createTournament({ clubId: club.id, startDateTime: new Date(Date.UTC(2026, 0, day)) });
      await createClock({ tournamentId: tournament.id, structure: testStructure({ startingStack: 1_000 * day }) });
    }

    const response = await agent.get(`/api/clubs/${club.id}/blind-structures`);

    expect(response.body.map((source: { structure: ClockStructure }) => source.structure.startingStack)).toEqual(
      [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((day) => day * 1_000),
    );
  });

  it("is 404 for an unknown club", async () => {
    const admin = await signIn({ role: "admin" });

    expect((await admin.agent.get(`/api/clubs/${UNKNOWN_ID}/blind-structures`)).status).toBe(404);
  });
});
