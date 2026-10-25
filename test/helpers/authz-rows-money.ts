/**
 * The authz matrix's rows for round 5's money routes (round5-contracts §3.1), spread into ROUTES by
 * test/api/authz-matrix.api.test.ts: one row per guarded route R5-MONEY mounts. The payout editor and
 * carried-over prize money (round 5, item 16) are the club staff's (admin, owner or manager) on an open
 * tournament of the club.
 */
import { single, staffOf, tournamentIn, type RouteRow } from "./authz-matrix";
import { createCarryOver } from "./carry-overs";
import { UNKNOWN_ID } from "./values";

const custom = { payoutStructure: "custom", places: [{ kind: "percent", percent: 60 }, { kind: "amount", amount: "40.00" }], reason: "Short field" };

export const MONEY_ROUTE_ROWS: Record<string, RouteRow> = {
  "PUT /api/tournaments/:id/prize-pool/payouts": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({
      path: `/api/tournaments/${(await tournamentIn(club)).id}/prize-pool/payouts`,
      json: custom,
    })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/prize-pool/payouts`, json: custom }),
  },
  "GET /api/tournaments/:id/prize-pool/carry-overs": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await tournamentIn(club)).id}/prize-pool/carry-overs` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/prize-pool/carry-overs` }),
  },
  "POST /api/tournaments/:id/prize-pool/carry-overs/:carryOverId": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => {
      const target = await tournamentIn(club);
      const { carryOver } = await createCarryOver({ clubId: club.id });
      return { path: `/api/tournaments/${target.id}/prize-pool/carry-overs/${carryOver.id}` };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/prize-pool/carry-overs/${UNKNOWN_ID}` }),
  },
  "DELETE /api/tournaments/:id/prize-pool/carry-overs/:carryOverId": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => {
      const target = await tournamentIn(club);
      const { carryOver } = await createCarryOver({ clubId: club.id, appliedTo: target });
      return { path: `/api/tournaments/${target.id}/prize-pool/carry-overs/${carryOver.id}` };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/prize-pool/carry-overs/${UNKNOWN_ID}` }),
  },
};
