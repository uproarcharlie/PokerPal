/**
 * Fixtures for the tournament screens' web tests (F1): the TD's scenario over the shared DTO factories
 * (./dto), finalize previews, and MSW handlers that record what each screen sent.
 */
import { http, HttpResponse } from "msw";
import { onTestFinished, vi } from "vitest";
import type { FinalizePreviewDto, FinalizeResultDto, FinalizeRowDto } from "@shared/api/finalize";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import type { ClubDto, PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto, TournamentListItemDto } from "@shared/api/tournaments";
import { centsToDecimalString } from "@shared/domain/money";
import { computePrizePool } from "@shared/domain/prize-pool";
import { server } from "../msw/server";
import * as base from "./dto";

/**
 * Lays the screens out as on a screen `width` px wide for the rest of the test: a media query matches
 * when its min-/max-width parts hold for that width (one with none, e.g. a colour scheme, matches).
 * Put back when the test ends, passed or failed, so a failing test never leaves the next one on a
 * phone (P3REV6-CQ-12).
 */
export function screenWidth(width: number): void {
  const holds = (query: string) =>
    Array.from(query.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)).every(([, side, px]) => (side === "min" ? width >= Number(px) : width <= Number(px)));
  const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
    (query): MediaQueryList => ({
      matches: holds(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  );
  onTestFinished(() => matchMedia.mockRestore());
}

/** A phone's screen (cards instead of tables, the header's More menu). */
export const phoneLayout = () => screenWidth(375);

/** The TD's game: a $100 freezeout with $5 AP per entry, in progress, run by the viewer. */
export function tournamentDto(overrides: Partial<TournamentDetailDto> = {}): TournamentDetailDto {
  return base.tournamentDto({
    status: "in_progress",
    buyInAmount: "100.00",
    rakeType: "fixed",
    rakeAmount: "5.00",
    maxPlayers: 20,
    viewer: base.OWNER_VIEW,
    ...overrides,
  });
}

/** That game as a list row, as GET /api/tournaments sends it to the club's staff. */
export function listItemDto(overrides: Partial<TournamentListItemDto> = {}): TournamentListItemDto {
  const { viewer: _viewer, prizePoolSnapshot: _snapshot, ...tournament } = tournamentDto();
  return base.tournamentListItemDto({ ...tournament, confirmedPlayerCount: 0, registeredCount: 0, ...overrides });
}

/** Central Stars, which labels its rake "AP", run by the viewer. */
export function clubDto(overrides: Partial<ClubDto> = {}): ClubDto {
  return base.clubDto({ address: "57 Princes St, Onehunga", rakeLabel: "AP", viewer: base.OWNER_VIEW, ...overrides });
}

/** One entry with `buyIns` buy-ins, still in. */
export function registrationDto(id: string, name: string, buyIns = 1, overrides: Partial<PublicRegistration> = {}): PublicRegistration {
  return base.registrationDto(id, name, { buyIns, ...overrides });
}

export const { pendingActionDto } = base;

/* ---------- finalize ---------- */

export const HASH_A = "a".repeat(32);
export const HASH_B = "b".repeat(32);
export const HASH_C = "c".repeat(32);

const previewTournament = { buyInAmount: "100.00", rakeType: "fixed", rakeAmount: "5.00", payoutStructure: "standard" };
const previewBreakdown = computePrizePool(previewTournament, [{ buyIns: 2 }, { buyIns: 2 }, { buyIns: 1 }]);

/** A $475 pool ($25 AP) as the preview reports it. */
export const previewPrizePool: PrizePoolDto = {
  tournamentId: "t1",
  status: "in_progress",
  rakeLabel: "AP",
  locked: false,
  estimated: true,
  breakdown: previewBreakdown,
  display: { source: "live", rows: [], totalCents: previewBreakdown.net, undistributedCents: 0 },
  adjustment: null,
};

export interface PlanPlayer {
  registrationId: string;
  playerId: string;
  playerName: string;
}

export const alice: PlanPlayer = { registrationId: "r1", playerId: "p1", playerName: "Alice" };
export const bob: PlanPlayer = { registrationId: "r2", playerId: "p2", playerName: "Bob" };
export const carl: PlanPlayer = { registrationId: "r3", playerId: "p3", playerName: "Carl" };

export function planRow(player: PlanPlayer, position: number, cents: number): FinalizeRowDto {
  return {
    ...player,
    finalPosition: position,
    amountCents: cents,
    prizeAmount: cents > 0 ? centsToDecimalString(cents) : null,
    pointsAwarded: null,
  };
}

export function previewOf(overrides: Partial<FinalizePreviewDto>): FinalizePreviewDto {
  return {
    ok: true,
    requiresForce: false,
    prizePool: previewPrizePool,
    rows: [],
    activePlayers: [],
    warnings: [],
    pendingRequests: [],
    previous: null,
    ...overrides,
  };
}

/** What finalize answers: the $475 pool paid to Alice, Bob and Carl (50/30/20), frozen in its snapshot. */
export function finalizeResultDto(message = "Tournament finalized successfully"): FinalizeResultDto {
  const paid = [alice, bob, carl].map((player, index) => ({
    ...player,
    position: index + 1,
    basisPoints: [5000, 3000, 2000][index],
    amountCents: [23_800, 14_200, 9_500][index],
  }));
  return { success: true, message, snapshot: base.prizePoolSnapshotDto({ paid }) };
}

/** Answers the preview by the finishing order sent, and records each request body. */
export function mockPreview(byOrder: (finishOrder: string[] | undefined) => FinalizePreviewDto): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/tournaments/t1/finalize/preview", async ({ request }) => {
      const body = (await request.json()) as { finishOrder?: string[] };
      bodies.push(body);
      return HttpResponse.json(byOrder(body.finishOrder));
    }),
  );
  return bodies;
}

/** Answers finalize with `answer`, and records each request body. */
export function mockFinalize(answer: (body: unknown) => Response): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/tournaments/t1/finalize", async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      return answer(body);
    }),
  );
  return bodies;
}

/** The JSON body of each request passed to `record` (undefined for none), in order. */
export function recordBodies(): { bodies: unknown[]; record: (request: Request) => Promise<unknown> } {
  const bodies: unknown[] = [];
  return {
    bodies,
    record: async (request) => {
      const text = await request.text();
      const body: unknown = text ? JSON.parse(text) : undefined;
      bodies.push(body);
      return body;
    },
  };
}
