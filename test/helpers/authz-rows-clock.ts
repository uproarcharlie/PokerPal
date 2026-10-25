/**
 * The authz matrix's rows for the clock, early birds and blind structures (phase4-contracts §3), spread
 * into ROUTES by test/api/authz-matrix.api.test.ts: one row per guarded route S-CLOCK-SERVER mounts.
 * Every write is the club staff's (admin, owner or manager) on an open tournament of the club; the
 * clock's actions also take the venue TV's clock key, which these visitors do not hold.
 */
import { structureHash } from "@shared/domain/clock";
import type { Club } from "@shared/schema";
import { createClock, testStructure } from "../factories/clock";
import { registeredPlayer, single, staffOf, tournamentIn, type RouteRow } from "./authz-matrix";
import { UNKNOWN_ID } from "./values";

const MANAGER = ["club-manager:Tournament"];

/** An open tournament of the request's club with a clock (idle at Level 1). */
async function clockedTournamentIn(club: Club) {
  const tournament = await tournamentIn(club, { status: "in_progress" });
  await createClock({ tournamentId: tournament.id });
  return tournament;
}

const newClock = { structure: testStructure(), baseHash: null };

export const CLOCK_ROUTE_ROWS: Record<string, RouteRow> = {
  "PUT /api/tournaments/:id/clock": {
    guards: MANAGER,
    cases: [
      {
        name: "set up",
        expect: staffOf(201),
        call: async ({ club }) => ({ path: `/api/tournaments/${(await tournamentIn(club)).id}/clock`, json: newClock }),
      },
      {
        name: "edit",
        expect: staffOf(200),
        call: async ({ club }) => ({
          path: `/api/tournaments/${(await clockedTournamentIn(club)).id}/clock`,
          json: { structure: testStructure({ startingStack: 20_000 }), baseHash: structureHash(testStructure()) },
        }),
      },
    ],
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/clock`, json: newClock }),
  },
  "DELETE /api/tournaments/:id/clock": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await clockedTournamentIn(club)).id}/clock` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/clock` }),
  },
  "POST /api/tournaments/:id/clock/actions": {
    // The venue TV's clock key also runs the clock (test/api/clock-key.api.test.ts); without it, staff only.
    guards: ["club-manager:Tournament or clock key"],
    cases: single(staffOf(200), async ({ club }) => ({
      path: `/api/tournaments/${(await clockedTournamentIn(club)).id}/clock/actions`,
      json: { action: "start" },
    })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/clock/actions`, json: { action: "start" } }),
  },
  "POST /api/tournaments/:id/clock/key": {
    guards: MANAGER,
    cases: single(staffOf(201), async ({ club }) => ({ path: `/api/tournaments/${(await clockedTournamentIn(club)).id}/clock/key`, json: {} })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/clock/key`, json: {} }),
  },
  "DELETE /api/tournaments/:id/clock/key": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await clockedTournamentIn(club)).id}/clock/key` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/clock/key` }),
  },
  "PATCH /api/tournaments/:id/clock/display": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => ({
      path: `/api/tournaments/${(await clockedTournamentIn(club)).id}/clock/display`,
      json: { showAp: true },
    })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/clock/display`, json: { showAp: true } }),
  },
  "POST /api/tournaments/:id/early-birds": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => {
      const { registration } = await registeredPlayer(await tournamentIn(club));
      return { path: `/api/tournaments/${registration.tournamentId}/early-birds`, json: { registrationIds: [registration.id], earlyBird: true } };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/early-birds`, json: { registrationIds: [UNKNOWN_ID], earlyBird: true } }),
  },
  "GET /api/clubs/:id/blind-structures": {
    guards: ["club-manager:Club"],
    cases: single(staffOf(200), ({ club }) => ({ path: `/api/clubs/${club.id}/blind-structures` })),
    missing: () => ({ path: `/api/clubs/${UNKNOWN_ID}/blind-structures` }),
  },
};
