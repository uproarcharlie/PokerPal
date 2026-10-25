/**
 * GET /api/public/tournaments/:id/prizes (round 6): the prize pool as the players see it, worked out on
 * the server from who has paid (shared/api/live-display toPublicPrizes: computePrizePool, payoutsForDisplay),
 * so the public page needs none of the club's takings to show it. The same body for every viewer, never
 * cached; only paid players' money is in it, and a payment confirmed at the desk raises it on the
 * public page and the TV alike.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys, findTakingsKeys } from "@shared/api/public";
import { createClub, createPlayer, createRegistration, createSeason, createTournament, type NewRegistration, type NewTournament } from "../factories";
import { createClock } from "../factories/clock";
import { anon, resetDb, signIn, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

type Entry = Omit<Partial<NewRegistration>, "tournamentId" | "playerId">;

/** A club ("AP") with its owner signed in, and a tournament with `entries` (players with contact details). */
async function world(overrides: Partial<NewTournament> = {}, entries: Entry[] = []) {
  const owner = await signIn();
  const club = await createClub({ ownerId: owner.user.id, rakeLabel: "AP" });
  const season = await createSeason({ clubId: club.id, name: "Winter League" });
  const tournament = await createTournament({ clubId: club.id, seasonId: season.id, status: "in_progress", ...overrides });
  const registrations = [];
  for (let index = 0; index < entries.length; index++) {
    const player = await createPlayer({ name: `Player ${index + 1}`, email: `player${index}@example.test`, phone: `021 555 02${index}` });
    registrations.push(await createRegistration({ tournamentId: tournament.id, playerId: player.id, ...entries[index] }));
  }
  return { owner, club, tournament, registrations };
}

const prizesOf = async (id: string, agent?: Awaited<ReturnType<typeof anon>>) => (agent ?? (await anon())).get(`/api/public/tournaments/${id}/prizes`);

/** `count` entries of one buy-in each, paid unless said otherwise. */
const entries = (count: number, entry: Entry = {}): Entry[] => Array.from({ length: count }, () => ({ paymentConfirmed: true, ...entry }));

/** $50 buy-ins with 10% AP, the standard 50/30/20, the pool locked. */
const game = { buyInAmount: "50.00", rakeType: "percentage", rakeAmount: "10.00", payoutStructure: "standard", prizePoolLocked: true } satisfies Partial<NewTournament>;

describe("GET /api/public/tournaments/:id/prizes", () => {
  it("answers 404 for an unknown tournament", async () => {
    const response = await prizesOf(UNKNOWN_ID);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });

  it("works out the pool and the places the server pays, never cached, with nothing of the club's takings in it", async () => {
    const { tournament } = await world(game, entries(8));

    const response = await prizesOf(tournament.id);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    // 8 × $50 = $400, less $40 AP.
    expect(response.body).toEqual({
      tournamentId: tournament.id,
      locked: true,
      estimated: false,
      source: "live",
      poolCents: 36_000,
      payouts: [
        { position: 1, amountCents: 18_000 },
        { position: 2, amountCents: 10_800 },
        { position: 3, amountCents: 7_200 },
      ],
      undistributedCents: 0,
      carriedIn: [],
      highHandPotCents: null,
      deal: null,
    });
    expect(findTakingsKeys(response.body)).toEqual([]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("answers everyone the same, the club's staff included: it is what the public page shows them", async () => {
    const { owner, tournament } = await world({ ...game, rakeOverride: "0.00", prizePoolAdjustmentReason: "No AP tonight" }, entries(4));
    const stranger = await signIn();

    const bodies = await Promise.all([prizesOf(tournament.id), prizesOf(tournament.id, owner.agent), prizesOf(tournament.id, stranger.agent)]);

    expect(bodies[0].body.poolCents).toBe(20_000);
    for (const { body } of bodies) {
      expect(body).toEqual(bodies[0].body);
      expect(JSON.stringify(body)).not.toMatch(/No AP tonight|rakeOverride/);
    }
  });

  it("counts only the players who have paid; confirming a payment raises the pool on the public page and the TV alike (round 6)", async () => {
    // 6 of 8 paid: $300 less $30 AP. The two who have not paid add nothing until the TD confirms them.
    const { owner, tournament, registrations } = await world(game, [...entries(6), { paymentConfirmed: false }, { paymentConfirmed: false }]);
    await createClock({ tournamentId: tournament.id, displaySettings: { showPrizePool: "always" } });

    expect((await prizesOf(tournament.id)).body).toMatchObject({ poolCents: 27_000, payouts: [{ amountCents: 13_500 }, { amountCents: 8_100 }, { amountCents: 5_400 }] });

    const unpaid = registrations.filter((registration) => !registration.paymentConfirmed);
    expect((await owner.agent.patch(`/api/registrations/${unpaid[0].id}/confirm-payment`)).status).toBe(200);

    const [prizes, display] = await Promise.all([prizesOf(tournament.id), (await anon()).get(`/api/public/tournaments/${tournament.id}/display`)]);
    expect(prizes.body.poolCents).toBe(31_500);
    expect(display.body.money).toMatchObject({ show: true, netCents: 31_500, payouts: prizes.body.payouts });
    // The players on the TV are everyone playing, paid or not.
    expect(display.body.stats).toMatchObject({ entrants: 8, buyIns: 8 });
  });

  it("puts nothing of an unpaid sign-up or the waiting list in the pool, nor in the high-hand pot", async () => {
    // Max 4: three paid players in the high hand ($10 each), one in the field who has not paid (in the high hand too), one on the waiting list.
    const { tournament } = await world({ ...game, maxPlayers: 4, enableHighHand: true, highHandAmount: "10.00" }, [
      ...entries(3, { enteringHighHands: true }),
      { paymentConfirmed: false, enteringHighHands: true },
      { paymentConfirmed: false },
    ]);

    const { body } = await prizesOf(tournament.id);

    expect(body).toMatchObject({ poolCents: 13_500, highHandPotCents: 3_000 });
  });

  it("says where money carried in from an earlier game came from and how much, and nothing of where any goes", async () => {
    const carriedIn = [{ carryOverId: "co1", fromTournamentId: null, fromName: "Week 3", amountCents: 20_000 }];
    const { tournament } = await world({ ...game, carriedIn, manualPrizePool: "500.00", prizeDifference: "carry" }, entries(8));

    const { body } = await prizesOf(tournament.id);

    // $400 in, $40 AP, $200 carried in: $560 available; the prizes are fixed at $500 and $60 carried over (never said).
    expect(body).toMatchObject({ poolCents: 50_000, carriedIn: [{ fromName: "Week 3", amountCents: 20_000 }] });
    expect(findTakingsKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/co1|carryOverId|Winter League/);
  });

  it("shows what finalize paid, and to whom, once the tournament is over; nothing for a cancelled one", async () => {
    const { owner, tournament, registrations } = await world(game, entries(3));
    const [first, second, third] = registrations;
    for (const busted of [third, second]) {
      expect((await owner.agent.put(`/api/registrations/${busted.id}`).send({ isEliminated: true, eliminatedBy: first.playerId })).status).toBe(200);
    }
    const preview = await owner.agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});
    expect((await owner.agent.post(`/api/tournaments/${tournament.id}/finalize`).send({ expectedPlanHash: preview.body.planHash })).status).toBe(200);
    const cancelled = await world({ ...game, status: "cancelled" }, entries(3));

    const paid = (await prizesOf(tournament.id)).body;
    const none = (await prizesOf(cancelled.tournament.id)).body;

    // 3 × $50 less $15 AP: $135, 50/30/20 floored to whole dollars, the rest to 1st.
    expect(paid).toMatchObject({ source: "snapshot", estimated: false, poolCents: 13_500, deal: null });
    expect(paid.payouts).toEqual([
      { position: 1, amountCents: 6_800, registrationId: first.id },
      { position: 2, amountCents: 4_000, registrationId: second.id },
      { position: 3, amountCents: 2_700, registrationId: third.id },
    ]);
    expect(findTakingsKeys(paid)).toEqual([]);
    expect(none).toMatchObject({ source: "cancelled", poolCents: 0, payouts: [] });
  });

  it("is the only way the public get the pool: the other public reads carry neither the takings nor who has paid", async () => {
    const { tournament } = await world({ ...game, rakeOverride: "12.00", prizePoolAdjustmentReason: "Low turnout" }, entries(2));

    const visitor = await anon();
    const [detail, list, registrationsRead] = await Promise.all([
      visitor.get(`/api/tournaments/${tournament.id}`),
      visitor.get(`/api/tournaments?clubId=${tournament.clubId}`),
      visitor.get(`/api/tournaments/${tournament.id}/registrations`),
    ]);

    for (const { body } of [detail, list, registrationsRead]) {
      expect(findTakingsKeys(body)).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("Low turnout");
    }
    // Who has paid is the staff's (P2REV0-SEC-04), so the public cannot work the pool out: the server does.
    expect(JSON.stringify(registrationsRead.body)).not.toContain("paymentConfirmed");
  });
});
