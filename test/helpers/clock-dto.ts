/**
 * Fixtures for the clock's web tests (U-CLOCK): the live display a TV, the clock panel and the clock
 * chip read (GET /api/public/tournaments/:id/display), a short structure to play, and MSW handlers that
 * record what the screens sent. Built on the shared shapes (shared/api/clock, shared/api/live-display),
 * so a DTO that changes breaks the typecheck here, in one place.
 */
import { http, HttpResponse } from "msw";
import { DEFAULT_DISPLAY_SETTINGS, type BlindStructureSourceDto, type ClockDto, type ClockUndoDto } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { CLOCK_LIMITS, structureHash, type ClockStructure } from "@shared/domain/clock";
import { serverTime } from "@/features/clock/server-time";
import { server } from "../msw/server";
import * as base from "./dto";
import { recordRequests, type SentRequest } from "./requests";

/**
 * Starts the page's server-time estimate afresh, as a page that has just opened: no samples (a last
 * test's, taken on another fake clock, would be nonsense here) and no offset from this device's time.
 */
export function resetServerTime(): void {
  serverTime.record(Date.now(), serverTime.mark());
  serverTime.reset();
}

/**
 * Three 20-minute levels (the third with a big-blind ante), a 10-minute "Colour up" break, then a
 * 15-minute level: enough to see a level change, a break and the final level.
 */
export function shortStructure(overrides: Partial<ClockStructure> = {}): ClockStructure {
  return {
    levels: [
      { kind: "level", id: "l1", durationMinutes: 20, smallBlind: 200, bigBlind: 400, ante: 0 },
      { kind: "level", id: "l2", durationMinutes: 20, smallBlind: 300, bigBlind: 600, ante: 0 },
      { kind: "level", id: "l3", durationMinutes: 20, smallBlind: 400, bigBlind: 800, ante: 800 },
      { kind: "break", id: "b1", durationMinutes: 10, note: "Colour up" },
      { kind: "level", id: "l4", durationMinutes: 15, smallBlind: 500, bigBlind: 1000, ante: 1000 },
    ],
    anteMode: "bb_ante",
    startingStack: 80_000,
    rebuyStack: 120_000,
    addonStack: 120_000,
    earlyBirdStack: 25_000,
    ...overrides,
  };
}

/**
 * What Undo offers, as the server words it for staff: by default the TD's "Moved to Level 2" a moment
 * ago, still on Level 2 (index 1), so it works for two minutes from `at`.
 */
export function undoDto(overrides: Partial<ClockUndoDto> = {}): ClockUndoDto {
  const at = overrides.at ?? Date.now() - 10_000;
  return {
    action: "next",
    description: "Moved to Level 2 (300/600)",
    redo: false,
    at,
    expiresAt: at + CLOCK_LIMITS.undoWindowMs,
    levelIndex: 1,
    startedTournamentFrom: null,
    ...overrides,
  };
}

/** A clock that has not started, on the short structure, with nothing to undo. */
export function clockDto(overrides: Partial<ClockDto> = {}): ClockDto {
  const structure = overrides.structure ?? shortStructure();
  return {
    version: 1,
    status: "idle",
    currentLevelIndex: 0,
    periodEndsAt: null,
    pausedRemainingMs: null,
    startedAt: null,
    structure,
    structureHash: structureHash(structure),
    presetKey: null,
    displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
    updatedAt: "2026-10-23T07:00:00.000Z",
    undo: null,
    ...overrides,
  };
}

/** A clock running at `levelIndex` with `remainingMs` left as of `nowMs`. */
export function runningClock(nowMs: number, { levelIndex = 0, remainingMs = 12 * 60_000, ...overrides }: Partial<ClockDto> & { levelIndex?: number; remainingMs?: number } = {}): ClockDto {
  return clockDto({
    status: "running",
    currentLevelIndex: levelIndex,
    periodEndsAt: nowMs + remainingMs,
    startedAt: nowMs - 30 * 60_000,
    ...overrides,
  });
}

/** A clock paused at `levelIndex` with `remainingMs` left. */
export function pausedClock({ levelIndex = 0, remainingMs = 12 * 60_000, ...overrides }: Partial<ClockDto> & { levelIndex?: number; remainingMs?: number } = {}): ClockDto {
  return clockDto({ status: "paused", currentLevelIndex: levelIndex, pausedRemainingMs: remainingMs, startedAt: Date.parse("2026-10-23T07:00:00.000Z"), ...overrides });
}

type Display = LiveDisplayDto;

/** What a test changes of a display: each part merged over the default one. */
export interface DisplayOverrides {
  serverNow?: number;
  tournament?: Partial<Display["tournament"]>;
  club?: Partial<Display["club"]>;
  season?: Display["season"];
  clock?: ClockDto | null;
  stats?: Partial<Display["stats"]>;
  money?: Partial<Display["money"]>;
  qr?: Display["qr"];
  viewer?: Partial<Display["viewer"]>;
}

/**
 * Central Stars' Friday game in progress in the Winter 2026 season: 20 entries, 18 still in, an idle
 * clock, the pool hidden until it is locked, the QR to the season leaderboard, seen by a visitor.
 */
export function liveDisplayDto(overrides: DisplayOverrides = {}): LiveDisplayDto {
  return {
    serverNow: overrides.serverNow ?? Date.now(),
    tournament: {
      id: "t1",
      name: "Friday Freezeout",
      status: "in_progress",
      startDateTime: "2026-10-23T07:00:00.000Z",
      seasonId: "s1",
      prizePoolLocked: false,
      rebuyPeriodMinutes: null,
      offersRebuys: false,
      offersAddons: false,
      ...overrides.tournament,
    },
    club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null, rakeLabel: "AP", theme: null, ...overrides.club },
    season: overrides.season === undefined ? { id: "s1", name: "Winter 2026" } : overrides.season,
    clock: overrides.clock === undefined ? clockDto() : overrides.clock,
    stats: {
      entrants: 20,
      remaining: 18,
      buyIns: 20,
      rebuys: 0,
      addons: 0,
      earlyBirds: 0,
      activeTables: 0,
      totalChips: 1_600_000,
      averageStack: 88_889,
      ...overrides.stats,
    },
    money: { show: false, estimated: true, netCents: null, payouts: null, carriedIn: null, ...overrides.money },
    qr: overrides.qr === undefined ? { target: "season", path: "/season/s1" } : overrides.qr,
    // Whoever runs the clock (the club's staff, or a screen on the clock key) may change the TV's own settings too.
    viewer: { canControl: false, clockKeyIssuedAt: null, clockKeyExpiresAt: null, ...overrides.viewer },
  };
}

/**
 * GET /api/public/tournaments/:id/display answers `display` (built afresh for each request when it is
 * a function, so `serverNow` is the time it was asked). Returns how many times it was asked.
 */
export function mockDisplay(
  display: LiveDisplayDto | (() => LiveDisplayDto | Response | Promise<LiveDisplayDto | Response>),
  tournamentId = "t1",
): { calls: () => number } {
  let calls = 0;
  server.use(
    http.get(`/api/public/tournaments/${tournamentId}/display`, async () => {
      calls += 1;
      const body = typeof display === "function" ? await display() : display;
      return body instanceof Response ? body : HttpResponse.json(body);
    }),
  );
  return { calls: () => calls };
}

/**
 * GET /api/public/tournaments/:id/display answers this display, its `serverNow` the time each request
 * was answered, as the server's is: a fixed `serverNow` would tell the screen that the server's clock
 * stood still between polls.
 */
export function serveDisplay(overrides: DisplayOverrides = {}, tournamentId = "t1"): { calls: () => number } {
  return mockDisplay(() => liveDisplayDto({ ...overrides, serverNow: Date.now() }), tournamentId);
}

/**
 * POST /api/tournaments/:id/clock/actions records each body and answers with `answer(body)`: a display
 * (200) or a Response (a refusal). Returns the bodies sent.
 */
export function recordClockActions(answer: (body: Record<string, unknown>) => LiveDisplayDto | Response, tournamentId = "t1"): Array<Record<string, unknown>> {
  const bodyOf = (sent: SentRequest) => sent.body as Record<string, unknown>;
  return recordRequests(
    [["post", `/api/tournaments/${tournamentId}/clock/actions`]],
    (sent) => {
      const result = answer(bodyOf(sent));
      return result instanceof Response ? result : HttpResponse.json(result);
    },
    bodyOf,
  );
}

/** The tournament as the clock tab gets it: open for registration, run by the viewer (a manager of the club). */
export function clockTournamentDto(overrides: Partial<TournamentDetailDto> = {}): TournamentDetailDto {
  return base.tournamentDto({ seasonId: "s1", viewer: base.MANAGER_VIEW, ...overrides });
}

/**
 * What the clock tab reads besides the display: the club (its time zone), the registrations (early
 * birds) and the club's recent structures ("copy from a previous game").
 */
export function mockClockTabReads({
  registrations = [],
  structures = [],
}: { registrations?: PublicRegistration[]; structures?: BlindStructureSourceDto[] } = {}): void {
  server.use(
    http.get("/api/clubs/c1", () => HttpResponse.json(base.clubDto({ viewer: base.MANAGER_VIEW }))),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
    http.get("/api/clubs/c1/blind-structures", () => HttpResponse.json(structures)),
  );
}

/**
 * The clock's other changes (PUT/DELETE .../clock, PATCH .../clock/display, POST .../early-birds): each
 * is recorded and answered by `answer` (a display or early-birds result, or a Response for a refusal).
 */
export function recordClockChanges(answer: (request: SentRequest) => unknown, tournamentId = "t1"): SentRequest[] {
  const clock = `/api/tournaments/${tournamentId}/clock`;
  return recordRequests(
    [
      ["put", clock],
      ["delete", clock],
      ["patch", `${clock}/display`],
      ["post", `/api/tournaments/${tournamentId}/early-birds`],
    ],
    (sent) => {
      const result = answer(sent);
      return result instanceof Response ? result : HttpResponse.json(result as Record<string, unknown>);
    },
  );
}
