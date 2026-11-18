/**
 * The authz matrix's rows for round 5's money routes (round5-contracts §3.1), spread into ROUTES by
 * test/api/authz-matrix.api.test.ts: one row per guarded route R5-MONEY mounts. The payout editor and
 * carried-over prize money (round 5, item 16) are the club staff's (admin, owner or manager) on an open
 * tournament of the club, as are round 10's high hands and their awards.
 */
import { createHighHand, createHighHandAward, enterHighHand } from "../factories/high-hands";
import { registeredPlayer, single, staffOf, tournamentIn, type RouteRow } from "./authz-matrix";
import { createCarryOver } from "./carry-overs";
import { UNKNOWN_ID } from "./values";

const custom = { payoutStructure: "custom", places: [{ kind: "percent", percent: 60 }, { kind: "amount", amount: "40.00" }], reason: "Short field" };

const twoHalves = {
  highHands: [
    { name: "First half", entryFee: "5.00" },
    { name: "Second half", entryFee: "5.00" },
  ],
};

/** Round 10: an open tournament of the club listing one high hand, with one paid player in it, and that player's award when `won`. */
async function highHandWorld(club: Parameters<typeof tournamentIn>[0], { won = false } = {}) {
  const tournament = await tournamentIn(club, { enableHighHand: true, highHandAmount: "5.00" });
  const highHand = await createHighHand({ tournamentId: tournament.id });
  const { registration } = await registeredPlayer(tournament, { paymentConfirmed: true });
  await enterHighHand(highHand, [registration]);
  if (won) await createHighHandAward(highHand, registration, 500);
  return { tournament, highHand, registration };
}

const awardPath = ({ tournament, highHand }: Awaited<ReturnType<typeof highHandWorld>>) => `/api/tournaments/${tournament.id}/high-hands/${highHand.id}/awards`;

export const MONEY_ROUTE_ROWS: Record<string, RouteRow> = {
  // Round 10: a tournament's list of high hands, and each one's awards, are the club staff's.
  "PUT /api/tournaments/:id/high-hands": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await tournamentIn(club)).id}/high-hands`, json: twoHalves })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/high-hands`, json: twoHalves }),
  },
  "POST /api/tournaments/:id/high-hands/:highHandId/awards": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(201), async ({ club }) => {
      const world = await highHandWorld(club);
      return { path: awardPath(world), json: { registrationId: world.registration.id } };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/high-hands/${UNKNOWN_ID}/awards`, json: { registrationId: UNKNOWN_ID } }),
  },
  "PATCH /api/tournaments/:id/high-hands/:highHandId/awards/:registrationId": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => {
      const world = await highHandWorld(club, { won: true });
      return { path: `${awardPath(world)}/${world.registration.id}`, json: { amount: "5.00" } };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/high-hands/${UNKNOWN_ID}/awards/${UNKNOWN_ID}`, json: { amount: "5.00" } }),
  },
  "DELETE /api/tournaments/:id/high-hands/:highHandId/awards/:registrationId": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => {
      const world = await highHandWorld(club, { won: true });
      return { path: `${awardPath(world)}/${world.registration.id}` };
    }),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/high-hands/${UNKNOWN_ID}/awards/${UNKNOWN_ID}` }),
  },
  // Round 6: the staff's breakdown carries the AP and what the club keeps; the public read /api/public/tournaments/:id/prizes.
  "GET /api/tournaments/:id/prize-pool": {
    guards: ["club-manager:Tournament"],
    cases: single(staffOf(200), async ({ club }) => ({ path: `/api/tournaments/${(await tournamentIn(club)).id}/prize-pool` })),
    missing: () => ({ path: `/api/tournaments/${UNKNOWN_ID}/prize-pool` }),
  },
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
