/**
 * The authz matrix's rows for tables and seating (phase4-contracts §3.1), spread into ROUTES by
 * test/api/authz-matrix.api.test.ts: one row per guarded route server/routes/seating.ts mounts (round 5:
 * open-table too). Every route needs a manager of the tournament's club; the public seat finder has no
 * guard and no row.
 */
import type { SeatingDto, SeatingMutationDto } from "@shared/api/seating";
import type { Club } from "@shared/schema";
import { createTable } from "../factories/seating";
import { registeredPlayer, single, staffOf, tournamentIn, type RouteRow } from "./authz-matrix";
import { UNKNOWN_ID } from "./values";

const MANAGER = ["club-manager:Tournament"];

const path = (tournamentId: string, rest: string) => `/api/tournaments/${tournamentId}/${rest}`;

/** An open tournament of `club` with one table of 9 seats and one registered player. */
async function tournamentWithTable(club: Club) {
  const tournament = await tournamentIn(club);
  const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
  const { registration } = await registeredPlayer(tournament);
  return { tournament, table, registration };
}

/** A route acting on one of the tournament's tables. */
const tableRow = (rest: string, ok: number, json?: object): RouteRow => ({
  guards: MANAGER,
  cases: single(staffOf(ok), async ({ club }) => {
    const { tournament, table } = await tournamentWithTable(club);
    await createTable({ tournamentId: tournament.id, tableNumber: 2 });
    return { path: path(tournament.id, `tables/${table.id}${rest}`), json };
  }),
  missing: () => ({ path: path(UNKNOWN_ID, `tables/${UNKNOWN_ID}${rest}`), json }),
});

export const SEATING_ROUTE_ROWS: Record<string, RouteRow> = {
  "GET /api/tournaments/:id/seating": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => ({ path: path((await tournamentIn(club)).id, "seating") })),
    missing: () => ({ path: path(UNKNOWN_ID, "seating") }),
  },
  "POST /api/tournaments/:id/tables": {
    guards: MANAGER,
    cases: single(staffOf(201), async ({ club }) => ({ path: path((await tournamentIn(club)).id, "tables"), json: { count: 2 } })),
    missing: () => ({ path: path(UNKNOWN_ID, "tables"), json: { count: 2 } }),
  },
  "PATCH /api/tournaments/:id/tables/:tableId": tableRow("", 200, { name: "Feature table" }),
  "DELETE /api/tournaments/:id/tables/:tableId": tableRow("", 200),
  "POST /api/tournaments/:id/tables/:tableId/break": tableRow("/break", 200, {}),
  "POST /api/tournaments/:id/seating/setup": {
    guards: MANAGER,
    cases: single(staffOf(201), async ({ club }) => {
      const tournament = await tournamentIn(club);
      await registeredPlayer(tournament);
      return { path: path(tournament.id, "seating/setup"), json: {} };
    }),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/setup"), json: {} }),
  },
  "POST /api/tournaments/:id/seating/draw": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => ({ path: path((await tournamentWithTable(club)).tournament.id, "seating/draw"), json: {} })),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/draw"), json: {} }),
  },
  "POST /api/tournaments/:id/seating/assign": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => {
      const { tournament, table, registration } = await tournamentWithTable(club);
      return { path: path(tournament.id, "seating/assign"), json: { registrationId: registration.id, tableId: table.id, seatNumber: 1 } };
    }),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/assign"), json: { registrationId: UNKNOWN_ID, tableId: UNKNOWN_ID, seatNumber: 1 } }),
  },
  "POST /api/tournaments/:id/seating/unseat": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => {
      const { tournament, registration } = await tournamentWithTable(club);
      return { path: path(tournament.id, "seating/unseat"), json: { registrationId: registration.id } };
    }),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/unseat"), json: { registrationId: UNKNOWN_ID } }),
  },
  "POST /api/tournaments/:id/seating/balance": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => ({ path: path((await tournamentWithTable(club)).tournament.id, "seating/balance"), json: {} })),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/balance"), json: {} }),
  },
  "POST /api/tournaments/:id/seating/final-table": {
    guards: MANAGER,
    cases: single(staffOf(200), async ({ club }) => ({ path: path((await tournamentWithTable(club)).tournament.id, "seating/final-table"), json: {} })),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/final-table"), json: {} }),
  },
  "POST /api/tournaments/:id/seating/open-table": {
    guards: MANAGER,
    // Sent with the seating's version as the club's owner reads it, as the advisor's Apply sends it.
    cases: single(staffOf(201), async ({ club, staff }) => {
      const { tournament } = await tournamentWithTable(club);
      const seating = (await staff.owner.agent.get(path(tournament.id, "seating"))).body as SeatingDto;
      return { path: path(tournament.id, "seating/open-table"), json: { expectedVersion: seating.version } };
    }),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/open-table"), json: { expectedVersion: "00000000" } }),
  },
  "POST /api/tournaments/:id/seating/undo": {
    guards: MANAGER,
    // The club's owner draws the seats first: the request undoes that draw.
    cases: single(staffOf(200), async ({ club, staff }) => {
      const { tournament } = await tournamentWithTable(club);
      const drawn = await staff.owner.agent.post(path(tournament.id, "seating/draw")).send({});
      const { lastChange } = (drawn.body as SeatingMutationDto).seating;
      return { path: path(tournament.id, "seating/undo"), json: { activityId: lastChange?.activityId } };
    }),
    missing: () => ({ path: path(UNKNOWN_ID, "seating/undo"), json: { activityId: UNKNOWN_ID } }),
  },
};
