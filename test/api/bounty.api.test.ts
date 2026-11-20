/**
 * Round 11: bounty games (the owner, 2026-11-21: "a $50 buy-in with a $100 bounty"). A tournament's
 * bountyAmount is stored and read back like its other prices, and is public (part of the price). Each
 * buy-in owes it on top of the buy-in, so the desk, the sign-up's transfer and finalize's unpaid list
 * ask for $150, while the prize pool, the AP and the dashboard stay exactly as a $50 game's. A new
 * bounty re-prices the buy-ins already recorded (409 ENTRIES_REPRICED until confirmed), and it is
 * frozen with the pool once the game is completed or cancelled.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys, findTakingsKeys } from "@shared/api/public";
import type { RegistrationCreatedDto } from "@shared/api/registrations";
import { tournaments } from "@shared/schema";
import { createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";
import { signUpTokenFor } from "../helpers/sign-up";

beforeEach(resetDb);

const BANK_DETAILS = { accountName: "Central Stars Poker Club", accountNumber: "12-3456-7890123-00", bankName: "ASB", instructions: null };

/** The CS BOUNTY - FREEZEOUT: $50 buy-in + $100 bounty, no AP, in a club with staff. */
async function bountyGame(overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({
    clubId: staff.club.id,
    name: "CS BOUNTY",
    status: "registration",
    buyInAmount: "50.00",
    bountyAmount: "100.00",
    ...overrides,
  });
  return { staff, tournament, agent: staff.owner.agent, path: `/api/tournaments/${tournament.id}` };
}

async function players(tournamentId: string, count: number, overrides: { paymentConfirmed?: boolean } = {}) {
  for (let i = 0; i < count; i++) await createRegistration({ tournamentId, playerId: (await createPlayer()).id, ...overrides });
}

const tournamentRow = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

describe("a tournament's bounty", () => {
  it("is stored on create and read back by staff and the public alike", async () => {
    const { club, owner } = await clubWithStaff();

    const created = await owner.agent.post("/api/tournaments").send({
      name: "CS BOUNTY - FREEZEOUT",
      clubId: club.id,
      startDateTime: "2026-11-21T23:30:00.000Z",
      buyInAmount: 50,
      bountyAmount: "100",
      payoutStructure: "standard",
      rakeType: "none",
      maxPlayers: 60,
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ buyInAmount: "50.00", bountyAmount: "100.00" });
    expect(await tournamentRow(created.body.id)).toMatchObject({ buyInAmount: "50.00", bountyAmount: "100.00" });
    const visitor = await anon();
    const read = await visitor.get(`/api/tournaments/${created.body.id}`);
    const list = await visitor.get(`/api/tournaments?clubId=${club.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ bountyAmount: "100.00" });
    expect(list.body).toEqual([expect.objectContaining({ id: created.body.id, bountyAmount: "100.00" })]);
    expect([...findForbiddenKeys(read.body), ...findTakingsKeys(read.body)]).toEqual([]);
    expect((await owner.agent.get(`/api/tournaments/${created.body.id}`)).body).toMatchObject({ bountyAmount: "100.00" });
  });

  it("is null for a game with none, can be set and cleared while nothing is recorded, and refuses a negative or bad amount", async () => {
    const { agent, path, tournament } = await bountyGame({ bountyAmount: null });

    expect((await agent.get(path)).body).toMatchObject({ bountyAmount: null });
    expect((await agent.put(path).send({ bountyAmount: "100" })).body).toMatchObject({ bountyAmount: "100.00" });
    expect((await agent.put(path).send({ bountyAmount: "" })).body).toMatchObject({ bountyAmount: null });
    for (const bad of ["-5", "abc", "1.234"]) {
      const refused = await agent.put(path).send({ bountyAmount: bad });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("VALIDATION");
    }
    expect((await tournamentRow(tournament.id)).bountyAmount).toBeNull();
  });

  it("re-prices the buy-ins already recorded: asked (409 ENTRIES_REPRICED) until confirmed, the pool unchanged", async () => {
    const { agent, path, tournament } = await bountyGame({ bountyAmount: null });
    await players(tournament.id, 3);

    const asked = await agent.put(path).send({ bountyAmount: "100" });

    expect(asked.status).toBe(409);
    expect(asked.body).toEqual({
      error: "This re-prices what is already recorded: 3 bounties from $0 to $100. What players owe changes with it; the prize pool does not.",
      code: "ENTRIES_REPRICED",
      details: { changes: [{ field: "bountyAmount", count: 3, fromCents: 0, toCents: 10_000 }] },
    });
    expect((await tournamentRow(tournament.id)).bountyAmount).toBeNull();

    const confirmed = await agent.put(path).send({ bountyAmount: "100", repriceEntries: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ bountyAmount: "100.00" });
  });

  it("moves the owner's $150 game to $50 + $100 bounty in one confirmed change, and players still owe $150", async () => {
    const { agent, path, tournament } = await bountyGame({ buyInAmount: "150.00", bountyAmount: null });
    await players(tournament.id, 2);

    const asked = await agent.put(path).send({ buyInAmount: "50", bountyAmount: "100" });
    const confirmed = await agent.put(path).send({ buyInAmount: "50", bountyAmount: "100", repriceEntries: true });
    const pending = await agent.get(`/api/tournaments/${tournament.id}/pending-registrations`);

    expect(asked.status).toBe(409);
    expect(asked.body.error).toBe(
      "This re-prices what is already recorded: 2 buy-ins from $150 to $50 and 2 bounties from $0 to $100. The prize pool and what players owe change with it.",
    );
    expect(confirmed.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({ buyInAmount: "50.00", bountyAmount: "100.00" });
    expect(pending.body.map((entry: { amountOwed: number }) => entry.amountOwed)).toEqual([150, 150]);
  });

  it("is frozen once the game is completed: a change is refused, a resent value is not", async () => {
    const { agent, path } = await bountyGame({ status: "completed" });

    const changed = await agent.put(path).send({ bountyAmount: "50" });
    const resent = await agent.put(path).send({ bountyAmount: "100", name: "CS BOUNTY (done)" });

    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { fields: ["bountyAmount"] } });
    expect(resent.status).toBe(200);
  });
});

describe("what a bounty game's players are asked for", () => {
  it("tells a sign-up to transfer the buy-in and bounty, $150, with the high hand still at the door", async () => {
    const { staff, tournament } = await bountyGame({ showBankTransfer: true, enableHighHand: true, highHandAmount: "5.00" });
    expect((await staff.owner.agent.put(`/api/clubs/${staff.club.id}/payments`).send({ bankDetails: BANK_DETAILS })).status).toBe(200);
    const player = await createPlayer({ name: "Tama Rangi" });

    const response = await (await anon())
      .post(`/api/tournaments/${tournament.id}/registrations`)
      .send({ playerId: player.id, signUpToken: signUpTokenFor(player.id), enteringHighHands: true });

    expect(response.status).toBe(201);
    expect((response.body as RegistrationCreatedDto).paymentInstructions).toMatchObject({
      ...BANK_DETAILS,
      amountDueCents: 15_000,
      highHandAtDoorCents: 500,
      waitingList: false,
    });
  });

  it("asks the desk for $150 a player, and a free entry for its $100 bounty", async () => {
    const { staff, tournament } = await bountyGame();
    const td = staff.manager.agent;
    const [paying, free] = [await createPlayer(), await createPlayer()];
    expect((await td.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: paying.id })).status).toBe(201);
    expect((await td.post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: free.id, freeEntry: { reason: "season_prize" } })).status).toBe(201);

    const pending = await td.get(`/api/tournaments/${tournament.id}/pending-registrations`);
    const confirmed = await td.get(`/api/tournaments/${tournament.id}/confirmed-registrations`);

    expect(pending.body.map((entry: { amountOwed: number }) => entry.amountOwed)).toEqual([150]);
    expect(confirmed.body.map((entry: { amountPaid: number }) => entry.amountPaid)).toEqual([100]);
  });
});

describe("the prize pool of a bounty game", () => {
  it("is $50 a paid player, exactly as the same game's with no bounty, for staff, the public and the dashboard", async () => {
    const { staff, tournament } = await bountyGame({ status: "in_progress" });
    await players(tournament.id, 3, { paymentConfirmed: true });
    await players(tournament.id, 1);
    const plain = await createTournament({ clubId: staff.club.id, status: "scheduled", buyInAmount: "50.00", bountyAmount: null });
    await players(plain.id, 3, { paymentConfirmed: true });
    await players(plain.id, 1);

    const [pool, plainPool] = [
      await staff.owner.agent.get(`/api/tournaments/${tournament.id}/prize-pool`),
      await staff.owner.agent.get(`/api/tournaments/${plain.id}/prize-pool`),
    ];
    const [prizes, plainPrizes] = [
      await (await anon()).get(`/api/public/tournaments/${tournament.id}/prizes`),
      await (await anon()).get(`/api/public/tournaments/${plain.id}/prizes`),
    ];
    const stats = await staff.owner.agent.get("/api/dashboard/stats");

    expect(pool.status).toBe(200);
    expect(pool.body.breakdown).toMatchObject({ gross: { buyIn: 15_000, total: 15_000 }, net: 15_000 });
    expect(pool.body.breakdown).toEqual(plainPool.body.breakdown);
    expect(prizes.body).toMatchObject({ poolCents: 15_000 });
    expect(prizes.body.payouts).toEqual(plainPrizes.body.payouts);
    // Each game's $150 pool (the bounty game's would be $450 with its $300 of bounties in it).
    expect(stats.body).toMatchObject({ activeTournaments: 1, totalPrizePool: 300 });
  });
});
