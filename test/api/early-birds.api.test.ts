/**
 * POST /api/tournaments/:id/early-birds (phase4-contracts §3.2 rule 8): staff give (or take back) the
 * early-bird bonus for entries of their tournament, one at a time or everyone registered so far. It
 * changes the chips in play only, never money; only this tournament's entries may be named, and a
 * closed tournament's are fixed.
 */
import { eq } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { activityLog, tournamentRegistrations, type Tournament, type TournamentRegistration } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import { createClock } from "../factories/clock";
import { anon, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

async function setup(overrides: Partial<NewTournament> = {}, players = 3) {
  const owner = await signIn();
  const club = await createClub({ ownerId: owner.user.id });
  const tournament = await createTournament({ clubId: club.id, status: "registration", buyInAmount: "100.00", ...overrides });
  const registrations: TournamentRegistration[] = [];
  for (let index = 0; index < players; index++) {
    registrations.push(await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id, paymentConfirmed: true }));
  }
  return { agent: owner.agent, club, tournament, registrations };
}

const mark = (agent: request.Agent, tournament: Tournament, registrationIds: string[], earlyBird = true) =>
  agent.post(`/api/tournaments/${tournament.id}/early-birds`).send({ registrationIds, earlyBird });

async function flags(tournament: Tournament) {
  const rows = await testDb()
    .select({ id: tournamentRegistrations.id, earlyBird: tournamentRegistrations.earlyBird })
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, tournament.id));
  return Object.fromEntries(rows.map(({ id, earlyBird }) => [id, earlyBird]));
}

const activity = (tournament: Tournament) =>
  testDb()
    .select({ eventType: activityLog.eventType, description: activityLog.description, eventData: activityLog.eventData })
    .from(activityLog)
    .where(eq(activityLog.tournamentId, tournament.id));

describe("POST /api/tournaments/:id/early-birds", () => {
  it("gives everyone registered so far the bonus, logged for staff only", async () => {
    const { agent, tournament, registrations } = await setup();
    const ids = registrations.map((registration) => registration.id);

    const response = await mark(agent, tournament, ids);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({ changed: ids, earlyBirds: 3 });
    expect(Object.values(await flags(tournament))).toEqual([true, true, true]);
    const [entry] = await activity(tournament);
    expect(entry).toMatchObject({ eventType: "early_bird", description: "Early-bird bonus given to 3 players" });
    expect(JSON.parse(entry.eventData ?? "{}")).toEqual({ earlyBird: true, registrationIds: ids });
    expect((await (await anon()).get(`/api/tournaments/${tournament.id}/activity`)).body).toEqual([]);
  });

  it("reports only the entries that changed, and logs nothing when none did", async () => {
    const { agent, tournament, registrations } = await setup();
    const [first, second] = registrations.map((registration) => registration.id);
    await mark(agent, tournament, [first]);

    const both = await mark(agent, tournament, [second, first, second]);
    const again = await mark(agent, tournament, [first, second]);

    expect(both.body).toEqual({ changed: [second], earlyBirds: 2 });
    expect(again.body).toEqual({ changed: [], earlyBirds: 2 });
    expect((await activity(tournament)).map((entry) => entry.description)).toEqual([
      "Early-bird bonus given to 1 player",
      "Early-bird bonus given to 1 player",
    ]);
  });

  it("takes the bonus back", async () => {
    const { agent, tournament, registrations } = await setup();
    const ids = registrations.map((registration) => registration.id);
    await mark(agent, tournament, ids);

    const response = await mark(agent, tournament, [ids[1]], false);

    expect(response.body).toEqual({ changed: [ids[1]], earlyBirds: 2 });
    expect((await flags(tournament))[ids[1]]).toBe(false);
    expect((await activity(tournament)).map((entry) => entry.description)).toContain("Early-bird bonus taken back from 1 player");
  });

  it("marks a busted player too (their chips were in play)", async () => {
    const { agent, tournament } = await setup({ status: "in_progress" }, 0);
    const busted = await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id, isEliminated: true });

    const response = await mark(agent, tournament, [busted.id]);

    expect(response.body).toEqual({ changed: [busted.id], earlyBirds: 1 });
  });

  it("refuses entries of another tournament or unknown ones (409 PLAYER_NOT_REGISTERED), changing nothing", async () => {
    const { agent, club, tournament, registrations } = await setup();
    const elsewhere = await createTournament({ clubId: club.id, status: "registration" });
    const theirs = await createRegistration({ tournamentId: elsewhere.id, playerId: (await createPlayer()).id });

    const response = await mark(agent, tournament, [registrations[0].id, theirs.id, UNKNOWN_ID]);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "PLAYER_NOT_REGISTERED", details: { registrationIds: [theirs.id, UNKNOWN_ID] } });
    expect(Object.values(await flags(tournament))).toEqual([false, false, false]);
    expect(Object.values(await flags(elsewhere))).toEqual([false]);
    expect(await activity(tournament)).toEqual([]);
  });

  it.each(["completed", "cancelled"] as const)("refuses a %s tournament (TOURNAMENT_CLOSED)", async (status) => {
    const { agent, tournament, registrations } = await setup({ status });

    const response = await mark(agent, tournament, [registrations[0].id]);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("TOURNAMENT_CLOSED");
  });

  it("validates the request (400)", async () => {
    const { agent, tournament, registrations } = await setup();

    for (const body of [{ registrationIds: [], earlyBird: true }, { registrationIds: [registrations[0].id] }, { registrationIds: Array(501).fill(registrations[0].id), earlyBird: true }]) {
      const response = await agent.post(`/api/tournaments/${tournament.id}/early-birds`).send(body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it("changes the chips on the display, never the money", async () => {
    const { agent, tournament, registrations } = await setup({ status: "in_progress" });
    await createClock({ tournamentId: tournament.id });
    const before = await (await anon()).get(`/api/tournaments/${tournament.id}/prize-pool`);

    await mark(agent, tournament, [registrations[0].id, registrations[1].id]);

    const after = await (await anon()).get(`/api/tournaments/${tournament.id}/prize-pool`);
    const display = await (await anon()).get(`/api/public/tournaments/${tournament.id}/display`);
    expect(after.body).toEqual(before.body);
    // 3 buy-ins × 10,000 + 2 early birds × 5,000 (test/factories/clock testStructure).
    expect(display.body.stats).toMatchObject({ earlyBirds: 2, totalChips: 40_000, averageStack: 13_333 });
  });
});
