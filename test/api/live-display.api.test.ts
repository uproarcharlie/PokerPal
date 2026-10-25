/**
 * GET /api/public/tournaments/:id/display (phase4-contracts §3.2 rule 7, §4.2): the live display the
 * TV, the TD's clock panel and the header chip poll. Public and PII-free, never cached, never writing
 * (auto-advance is derived), with the field's numbers, the chips in play (early birds included), the
 * money as the clock's display settings allow, the QR target, and whether the viewer may control it.
 * Polling it, and the TD's clock writes, never touch the venue's shared request budget.
 */
import { eq } from "drizzle-orm";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@shared/api/clock";
import { findForbiddenKeys } from "@shared/api/public";
import { structureHash } from "@shared/domain/clock";
import { FINALIZE_SNAPSHOT_VERSION, type PrizePoolSnapshot } from "@shared/domain/finalize";
import { PAYOUT_ALGORITHM } from "@shared/domain/payouts";
import { tournamentClocks, tournamentTables, type Tournament } from "@shared/schema";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { qrTargetOf } from "../../server/services/live-display";
import { createClub, createPlayer, createRegistration, createSeason, createTournament, createUser, FACTORY_PASSWORD, type NewRegistration, type NewTournament } from "../factories";
import { createClock, MINUTE_MS, runningState, testStructure, type NewClock } from "../factories/clock";
import { anon, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

const T0 = Math.ceil(Date.now() / MINUTE_MS) * MINUTE_MS;

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

type Entry = Omit<Partial<NewRegistration>, "tournamentId" | "playerId">;

interface WorldOptions {
  tournament?: Partial<NewTournament>;
  clock?: Omit<NewClock, "tournamentId"> | null;
  entries?: Entry[];
  season?: boolean;
}

/** A club ("AP") with an owner, a season, a tournament with `entries` (players with contact details) and a clock. */
async function world({ tournament: overrides = {}, clock = {}, entries = [], season = true }: WorldOptions = {}) {
  const owner = await signIn();
  const club = await createClub({ ownerId: owner.user.id, rakeLabel: "AP" });
  const winter = season ? await createSeason({ clubId: club.id, name: "Winter League" }) : null;
  const tournament = await createTournament({ clubId: club.id, seasonId: winter?.id ?? null, status: "in_progress", ...overrides });
  for (let index = 0; index < entries.length; index++) {
    const player = await createPlayer({ name: `Player ${index + 1}`, email: `player${index}@example.test`, phone: `021 555 01${index}` });
    await createRegistration({ tournamentId: tournament.id, playerId: player.id, ...entries[index] });
  }
  if (clock) await createClock({ tournamentId: tournament.id, ...clock });
  return { owner, club, season: winter, tournament };
}

const displayOf = async (tournament: Pick<Tournament, "id">, agent?: request.Agent) =>
  (agent ?? (await anon())).get(`/api/public/tournaments/${tournament.id}/display`);

/** `count` paid entries of one buy-in each. */
const entries = (count: number, entry: Entry = {}): Entry[] => Array.from({ length: count }, () => ({ paymentConfirmed: true, ...entry }));

describe("GET /api/public/tournaments/:id/display", () => {
  it("answers 404 for an unknown tournament", async () => {
    const response = await displayOf({ id: UNKNOWN_ID });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });

  it("describes a tournament with no clock yet: default settings, so the pool waits for the lock; never cached", async () => {
    const { club, season, tournament } = await world({
      clock: null,
      tournament: { status: "registration", name: "Friday Night", buyInAmount: "100.00", rebuyAmount: "25.00", addonAmount: null, rebuyPeriodMinutes: 135 },
      entries: entries(2),
    });

    const response = await displayOf(tournament);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      serverNow: T0,
      tournament: {
        id: tournament.id,
        name: "Friday Night",
        status: "registration",
        startDateTime: tournament.startDateTime.toISOString(),
        seasonId: season?.id,
        prizePoolLocked: false,
        rebuyPeriodMinutes: 135,
        offersRebuys: true,
        offersAddons: false,
      },
      club: { id: club.id, name: club.name, slug: club.slug, imageUrl: null, rakeLabel: "AP", theme: null },
      season: { id: season?.id, name: "Winter League" },
      clock: null,
      stats: { entrants: 2, remaining: 2, buyIns: 2, rebuys: 0, addons: 0, earlyBirds: 0, activeTables: 0, totalChips: null, averageStack: null },
      money: { show: false, estimated: true, rakeLabel: "AP", netCents: null, netSource: null, apCents: null, clubAddedCents: null, payouts: null, lines: null },
      qr: { target: "season", path: `/season/${season?.id}` },
      viewer: { canControl: false, canChangeDisplay: false, clockKeyIssuedAt: null, clockKeyExpiresAt: null },
    });
  });

  it("shows the clock's anchors as stored, and reading it writes nothing even after a level has ended", async () => {
    const { tournament } = await world({ clock: { state: runningState(T0, 0, 20 * MINUTE_MS), presetKey: "turbo_10", version: 7 } });
    const [before] = await testDb().select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournament.id));

    vi.setSystemTime(T0 + 45 * MINUTE_MS);
    const response = await displayOf(tournament);

    const structure = testStructure();
    expect(response.body.serverNow).toBe(T0 + 45 * MINUTE_MS);
    expect(response.body.clock).toEqual({
      version: 7,
      status: "running",
      currentLevelIndex: 0,
      periodEndsAt: T0 + 20 * MINUTE_MS,
      pausedRemainingMs: null,
      startedAt: T0,
      structure,
      structureHash: structureHash(structure),
      presetKey: "turbo_10",
      displaySettings: DEFAULT_DISPLAY_SETTINGS,
      undo: null,
      updatedAt: before.updatedAt.toISOString(),
    });
    const [after] = await testDb().select().from(tournamentClocks).where(eq(tournamentClocks.tournamentId, tournament.id));
    expect(after).toEqual(before);
  });

  it("counts the field, the tables in play and the chips, early birds included", async () => {
    const { tournament } = await world({
      entries: [
        { rebuys: 1, earlyBird: true },
        { addons: 1, earlyBird: true },
        { isEliminated: true },
        { buyIns: 2, rebuys: null },
      ],
    });
    await testDb()
      .insert(tournamentTables)
      .values([
        { tournamentId: tournament.id, tableNumber: 1 },
        { tournamentId: tournament.id, tableNumber: 2 },
        { tournamentId: tournament.id, tableNumber: 3, status: "broken", brokenAt: new Date() },
      ]);

    const response = await displayOf(tournament);

    // 5 buy-ins × 10,000 + 1 re-buy × 10,000 (the starting stack) + 1 add-on × 15,000 + 2 early birds × 5,000; 3 players left.
    expect(response.body.stats).toEqual({
      entrants: 4,
      remaining: 3,
      buyIns: 5,
      rebuys: 1,
      addons: 1,
      earlyBirds: 2,
      activeTables: 2,
      totalChips: 85_000,
      averageStack: 28_333,
    });
  });

  it("leaves the chips unknown when a stack they need is not set, or when neither the average nor the chips in play are shown", async () => {
    const unknownAddOn = await world({ entries: [{ addons: 1 }], clock: { structure: testStructure({ addonStack: null }) } });
    const switchedOff = await world({ entries: entries(2), clock: { displaySettings: { showAverageStack: false } } });

    for (const { tournament } of [unknownAddOn, switchedOff]) {
      const { stats } = (await displayOf(tournament)).body;
      expect(stats).toMatchObject({ totalChips: null, averageStack: null });
    }
  });

  it("counts the chips in play for a TV that shows them without the average stack", async () => {
    const { tournament } = await world({ entries: entries(2), clock: { displaySettings: { showAverageStack: false, showChipsInPlay: true } } });

    // 2 buy-ins at the 10,000 starting stack.
    expect((await displayOf(tournament)).body.stats).toMatchObject({ totalChips: 20_000, averageStack: null });
  });

  describe("money, as the clock's display settings allow", () => {
    const pool = { buyInAmount: "50.00", rakeType: "percentage", rakeAmount: "10.00" } satisfies Partial<NewTournament>;
    const payouts = [
      { position: 1, amountCents: 18_000 },
      { position: 2, amountCents: 10_800 },
      { position: 3, amountCents: 7_200 },
    ];

    it("hides an estimate until the pool is locked (the default), then shows the pool and payouts", async () => {
      const open = await world({ tournament: pool, entries: entries(8) });
      const locked = await world({ tournament: { ...pool, prizePoolLocked: true }, entries: entries(8) });

      expect((await displayOf(open.tournament)).body.money).toEqual({
        show: false,
        estimated: true,
        rakeLabel: "AP",
        netCents: null,
        netSource: null,
        apCents: null,
        clubAddedCents: null,
        payouts: null,
        lines: null,
      });
      expect((await displayOf(locked.tournament)).body.money).toEqual({
        show: true,
        estimated: false,
        rakeLabel: "AP",
        netCents: 36_000,
        netSource: "calculated",
        apCents: null,
        clubAddedCents: null,
        payouts,
        lines: [],
      });
    });

    it("shows an estimate when told to always, never when told never, and the AP and payouts as switched", async () => {
      const always = await world({ tournament: pool, entries: entries(8), clock: { displaySettings: { showPrizePool: "always", showAp: true, showPayouts: false } } });
      const never = await world({ tournament: { ...pool, prizePoolLocked: true }, entries: entries(8), clock: { displaySettings: { showPrizePool: "never", showAp: true } } });

      expect((await displayOf(always.tournament)).body.money).toEqual({
        show: true,
        estimated: true,
        rakeLabel: "AP",
        netCents: 36_000,
        netSource: "calculated",
        apCents: 4_000,
        clubAddedCents: null,
        payouts: null,
        lines: [],
      });
      expect((await displayOf(never.tournament)).body.money).toMatchObject({ show: false, netCents: null, payouts: null, apCents: 4_000 });
    });

    it("never shows the room a pool below zero, from a fixed rate stored above its entry's price before that was refused (P4REV2R2-MONEY-01)", async () => {
      const legacy = { buyInAmount: "20.00", rakeType: "fixed", rakeAmount: "30.00", prizePoolLocked: true } satisfies Partial<NewTournament>;
      const { tournament } = await world({ tournament: legacy, entries: entries(4), clock: { displaySettings: { showAp: true } } });

      expect((await displayOf(tournament)).body.money).toMatchObject({ show: true, netCents: 0, apCents: 12_000 });
    });

    it("follows a manual AP total", async () => {
      const { tournament } = await world({ tournament: { ...pool, rakeOverride: "20.00", prizePoolLocked: true }, entries: entries(8), clock: { displaySettings: { showAp: true } } });

      expect((await displayOf(tournament)).body.money).toMatchObject({ show: true, netCents: 38_000, netSource: "ap_override", apCents: 2_000, clubAddedCents: null });
    });

    it("never shows a negative AP: a pool fixed above the takings shows what the club adds instead (MONEY-AP-02)", async () => {
      // 8 × $50 = $400 taken in; the club guarantees a $1,000 pool.
      const guaranteed = { ...pool, manualPrizePool: "1000.00", prizePoolLocked: true };
      const shown = await world({ tournament: guaranteed, entries: entries(8), clock: { displaySettings: { showAp: true } } });
      const hidden = await world({ tournament: guaranteed, entries: entries(8) });
      const unpublished = await world({ tournament: { ...guaranteed, prizePoolLocked: false }, entries: entries(8), clock: { displaySettings: { showAp: true } } });

      // Beside the pool the breakdown says it as the TD's and the public pages do: $40 AP, and the club adds $640 to the $360 left.
      const addedByClub = [{ kind: "added_by_club", label: "Added by the club", cents: 64_000 }];
      expect((await displayOf(shown.tournament)).body.money).toMatchObject({ show: true, netCents: 100_000, netSource: "manual_pool", apCents: 4_000, clubAddedCents: null, lines: addedByClub });
      expect((await displayOf(hidden.tournament)).body.money).toMatchObject({ show: true, netCents: 100_000, apCents: null, clubAddedCents: null, lines: addedByClub });
      // While the pool is not shown, the AP alone says what the club puts in on the night.
      expect((await displayOf(unpublished.tournament)).body.money).toMatchObject({ show: false, netCents: null, apCents: 0, clubAddedCents: 60_000, lines: null });
    });

    it("says beside the pool what the club keeps, or carries over to the season, of prizes set below the money available (round 5, item 16)", async () => {
      // $400 in, $40 AP: $360 available; the prizes are fixed at $300.
      const reduced = { ...pool, manualPrizePool: "300.00", prizePoolLocked: true };
      const kept = await world({ tournament: reduced, entries: entries(8), clock: { displaySettings: { showAp: true } } });
      const carried = await world({ tournament: { ...reduced, prizeDifference: "carry" }, entries: entries(8), clock: { displaySettings: { showAp: true } } });

      expect((await displayOf(kept.tournament)).body.money).toMatchObject({
        netCents: 30_000,
        apCents: 4_000,
        lines: [{ kind: "kept_by_club", label: "Kept by the club", cents: 6_000 }],
      });
      expect((await displayOf(carried.tournament)).body.money).toMatchObject({
        netCents: 30_000,
        apCents: 4_000,
        lines: [{ kind: "carried_over", label: "Carried over to Winter League", cents: 6_000 }],
      });
    });

    it("shows a finalized pool's breakdown as finalize froze it, and none for prizes typed in by hand", async () => {
      // $400 in, $40 AP, $360 available: 1st was paid $250 and the club carried $110 over to the season.
      const difference = { choice: "carry" as const, availableCents: 36_000, setCents: 25_000, cents: 11_000, keptByClubCents: 0, addedToPrizesCents: 0, carriedOverCents: 11_000, addedByClubCents: 0, carryTarget: "Winter League" };
      const snapshot: PrizePoolSnapshot = {
        v: FINALIZE_SNAPSHOT_VERSION,
        algorithm: PAYOUT_ALGORITHM,
        finalizedAt: new Date(T0).toISOString(),
        entrants: 8,
        finishOrderSource: "explicit",
        pool: {
          grossCents: 40_000,
          rakeCalculatedCents: 4_000,
          rakeOverrideCents: null,
          manualPrizePoolCents: 25_000,
          netCents: 25_000,
          netSource: "manual_pool",
          impliedRakeCents: 4_000,
          structure: { requested: "custom", used: "custom", basisPoints: [10_000] },
          difference,
        },
        paid: [],
        warnings: [],
      };
      const frozen = await world({ tournament: { ...pool, status: "completed", prizePoolSnapshot: snapshot }, entries: entries(8), clock: { displaySettings: { showAp: true } } });
      const typedIn = await world({ tournament: { ...pool, status: "completed" }, entries: [{ paymentConfirmed: true, finalPosition: 1, prizeAmount: "300.00" }, ...entries(7)] });

      expect((await displayOf(frozen.tournament)).body.money).toMatchObject({
        show: true,
        apCents: 4_000,
        clubAddedCents: null,
        lines: [{ kind: "carried_over", label: "Carried over to Winter League", cents: 11_000 }],
      });
      expect((await displayOf(typedIn.tournament)).body.money).toMatchObject({ show: true, netCents: 30_000, lines: [] });
    });

    it("shows what a completed tournament paid, and nothing for a cancelled one", async () => {
      const completed = await world({
        tournament: { ...pool, status: "completed" },
        entries: [
          { paymentConfirmed: true, finalPosition: 1, prizeAmount: "150.00" },
          { paymentConfirmed: true, finalPosition: 2, prizeAmount: "50.00" },
          ...entries(2),
        ],
      });
      const cancelled = await world({ tournament: { ...pool, status: "cancelled" }, entries: entries(8), clock: { displaySettings: { showPrizePool: "always", showAp: true } } });

      expect((await displayOf(completed.tournament)).body.money).toMatchObject({
        show: true,
        estimated: false,
        netCents: 20_000,
        payouts: [
          { position: 1, amountCents: 15_000 },
          { position: 2, amountCents: 5_000 },
        ],
      });
      expect((await displayOf(cancelled.tournament)).body.money).toMatchObject({ show: false, netCents: null, payouts: null, apCents: null });
    });

    it("labels the take \"Rake\" for a club that has not named it", async () => {
      const owner = await createUser();
      const club = await createClub({ ownerId: owner.id });
      const tournament = await createTournament({ clubId: club.id });

      const { body } = await displayOf(tournament);

      expect([body.club.rakeLabel, body.money.rakeLabel]).toEqual(["Rake", "Rake"]);
    });
  });

  describe("the QR code", () => {
    it("leads where the settings say, falling back to the tournament page without a season", async () => {
      const cases = [
        { season: true, qrTarget: "season" as const, expected: (id: string, seasonId?: string) => ({ target: "season", path: `/season/${seasonId}` }) },
        { season: false, qrTarget: "season" as const, expected: (id: string) => ({ target: "tournament", path: `/tournament/${id}` }) },
        { season: true, qrTarget: "tournament" as const, expected: (id: string) => ({ target: "tournament", path: `/tournament/${id}` }) },
        { season: true, qrTarget: "seats" as const, expected: (id: string) => ({ target: "seats", path: `/tournament/${id}/seats` }) },
        { season: true, qrTarget: "none" as const, expected: () => null },
      ];

      for (const { season: withSeason, qrTarget, expected } of cases) {
        const { tournament, season } = await world({ season: withSeason, clock: { displaySettings: { qrTarget } } });
        const { body } = await displayOf(tournament);
        expect(body.qr, `${qrTarget}, season: ${withSeason}`).toEqual(expected(tournament.id, season?.id));
        expect(body.season, qrTarget).toEqual(season ? { id: season.id, name: "Winter League" } : null);
      }
    });

    it("percent-encodes the ids in the path", () => {
      expect(qrTargetOf("season", "t/1", { id: "s 2" })).toEqual({ target: "season", path: "/season/s%202" });
      expect(qrTargetOf("seats", "t/1", null)).toEqual({ target: "seats", path: "/tournament/t%2F1/seats" });
    });
  });

  it("lets the club's staff control it while the tournament is open, and nobody else", async () => {
    const { owner, tournament } = await world();
    const closed = await world({ tournament: { status: "completed" } });
    const stranger = await signIn();
    const admin = await signIn({ role: "admin" });

    const canControl = async (agent: request.Agent | undefined, target: Tournament = tournament) => (await displayOf(target, agent)).body.viewer.canControl;

    expect(await canControl(undefined)).toBe(false);
    expect(await canControl(stranger.agent)).toBe(false);
    expect(await canControl(owner.agent)).toBe(true);
    expect(await canControl(admin.agent)).toBe(true);
    expect(await canControl(closed.owner.agent, closed.tournament)).toBe(false);

    // Changing the TV display is the signed-in staff's, as PATCH …/clock/display is.
    const canChangeDisplay = async (agent: request.Agent | undefined, target: Tournament = tournament) => (await displayOf(target, agent)).body.viewer.canChangeDisplay;
    expect(await canChangeDisplay(undefined)).toBe(false);
    expect(await canChangeDisplay(stranger.agent)).toBe(false);
    expect(await canChangeDisplay(owner.agent)).toBe(true);
    expect(await canChangeDisplay(admin.agent)).toBe(true);
    expect(await canChangeDisplay(closed.owner.agent, closed.tournament)).toBe(false);
  });

  it("gives away no contact details or account ids, to anyone", async () => {
    const { owner, tournament } = await world({ entries: entries(3), clock: { displaySettings: { showPrizePool: "always" } } });

    for (const agent of [undefined, owner.agent]) {
      const response = await displayOf(tournament, agent);
      expect(findForbiddenKeys(response.body)).toEqual([]);
      expect(JSON.stringify(response.body)).not.toMatch(/@example\.test|021 555|updatedBy/);
      expect(JSON.stringify(response.body)).not.toContain(owner.user.id);
    }
  });
});

describe("rate limits at a venue (one shared address)", () => {
  const limitedApp = (limits: Record<string, number> = {}) =>
    createApp({ env: loadEnv(process.env), sessionStore: new session.MemoryStore(), rateLimits: { enabled: true, limits } });

  it("never refuses a TV polling the display: 600 polls in a row all answer 200", { timeout: 120_000 }, async () => {
    vi.useRealTimers();
    const { tournament } = await world();
    const app = await limitedApp();

    const statuses = new Set<number>();
    for (let poll = 0; poll < 600; poll++) statuses.add((await request(app).get(`/api/public/tournaments/${tournament.id}/display`)).status);

    expect(Array.from(statuses)).toEqual([200]);
  });

  it("keeps the display and the TD's clock writes out of the venue's shared budget", { timeout: 60_000 }, async () => {
    vi.useRealTimers();
    const owner = await createUser();
    const club = await createClub({ ownerId: owner.id });
    const tournament = await createTournament({ clubId: club.id, status: "in_progress" });
    await createClock({ tournamentId: tournament.id });
    const app = await limitedApp({ globalApi: 3 });
    const td = request.agent(app);
    expect((await td.post("/api/auth/login").send({ email: owner.email, password: FACTORY_PASSWORD })).status).toBe(200);

    const writes = [];
    for (let tap = 0; tap < 10; tap++) writes.push((await td.post(`/api/tournaments/${tournament.id}/clock/actions`).send({ action: "adjust", deltaSeconds: 60 })).status);
    const polls = [];
    for (let poll = 0; poll < 10; poll++) polls.push((await request(app).get(`/api/public/tournaments/${tournament.id}/display`)).status);
    const pageLoads = [];
    for (let load = 0; load < 3; load++) pageLoads.push((await request(app).get("/api/clubs")).status);

    expect(writes).toEqual(Array(10).fill(200));
    expect(polls).toEqual(Array(10).fill(200));
    // The sign-in and two page loads use up the budget of 3; the clock and the display never touched it.
    expect(pageLoads).toEqual([200, 200, 429]);
  });
});
