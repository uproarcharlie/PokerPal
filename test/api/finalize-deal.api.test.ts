/**
 * A deal or chop at End Tournament (round 5, item 2): POST /api/tournaments/:id/finalize/preview and
 * /finalize with `deal`. The players still in share exactly what their places pay together, as they
 * agreed; positions and season points still follow the finish order. The preview pays the deal (or says
 * why it cannot be paid), the plan hash covers its amounts, finalize refuses a wrong deal with 409
 * DEAL_INVALID, and a deal paid is frozen in the snapshot, logged publicly with its reason and audited.
 */
import { asc, eq } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { DealRequest, FinalizePreviewDto } from "@shared/api/finalize";
import { findForbiddenKeys } from "@shared/api/public";
import { activityLog, auditLog, tournamentRegistrations, tournaments, type TournamentRegistration } from "@shared/schema";
import { createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff, type ClubStaffAgents } from "../helpers/club-staff";

beforeEach(resetDb);

const NAMES = ["Ann", "Ben", "Cat", "Dee", "Eve", "Fay"];

/**
 * A $600 pool (six $100 buy-ins, no AP; Standard pays $300 / $180 / $120) with the first `busted`
 * players out, the first one first. `order` is the players still in, best first: the last one in first.
 */
async function dealScenario({ busted = 3, tournament: overrides = {} }: { busted?: number; tournament?: Partial<NewTournament> } = {}) {
  const staff: ClubStaffAgents = await clubWithStaff({ rakeLabel: "AP" });
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", buyInAmount: "100.00", ...overrides });
  const registrations: TournamentRegistration[] = [];
  for (let index = 0; index < NAMES.length; index++) {
    const player = await createPlayer({ name: NAMES[index] });
    registrations.push(
      await createRegistration({
        tournamentId: tournament.id,
        playerId: player.id,
        paymentConfirmed: true,
        isEliminated: index < busted,
        eliminationTime: index < busted ? new Date(Date.UTC(2026, 2, 1, 19, index)) : null,
      }),
    );
  }
  const id = (name: string) => registrations[NAMES.indexOf(name)].id;
  const order = registrations.slice(busted).map((r) => r.id).reverse();
  return { staff, agent: staff.owner.agent, tournament, registrations, id, order };
}

const finalizePath = (id: string) => `/api/tournaments/${id}/finalize`;
const preview = (agent: request.Agent, id: string, body: object) => agent.post(`${finalizePath(id)}/preview`).send(body);
const deal = (amounts: Array<[string, string]>, reason = "Chip chop at 3 handed"): DealRequest => ({
  amounts: amounts.map(([registrationId, amount]) => ({ registrationId, amount })),
  reason,
});
const results = async (tournamentId: string) =>
  new Map(
    (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournamentId))).map((r) => [
      r.id,
      { position: r.finalPosition, prize: r.prizeAmount },
    ]),
  );
const activity = (tournamentId: string) =>
  testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp));
const audits = (tournamentId: string) => testDb().select().from(auditLog).where(eq(auditLog.targetId, tournamentId));

describe("a deal in the finalize preview", () => {
  it("says what the players still in share, then pays the deal in the rows, with a warning and its own plan hash", async () => {
    const { agent, tournament, id, order } = await dealScenario();
    const plain = (await preview(agent, tournament.id, { finishOrder: order })).body as FinalizePreviewDto;
    expect(plain.dealable).toEqual({
      totalCents: 60_000,
      players: [
        { registrationId: id("Fay"), playerId: expect.any(String), playerName: "Fay", position: 1, plannedCents: 30_000 },
        { registrationId: id("Eve"), playerId: expect.any(String), playerName: "Eve", position: 2, plannedCents: 18_000 },
        { registrationId: id("Dee"), playerId: expect.any(String), playerName: "Dee", position: 3, plannedCents: 12_000 },
      ],
    });

    const response = await preview(agent, tournament.id, {
      finishOrder: order,
      deal: deal([
        [id("Fay"), "250"],
        [id("Eve"), "200.00"],
        [id("Dee"), "150"],
      ]),
    });

    expect(response.status).toBe(200);
    const body = response.body as FinalizePreviewDto;
    expect(body).toMatchObject({ ok: true, dealProblems: [] });
    expect(body.rows.map((row) => [row.playerName, row.finalPosition, row.amountCents, row.prizeAmount])).toEqual([
      ["Fay", 1, 25_000, "250.00"],
      ["Eve", 2, 20_000, "200.00"],
      ["Dee", 3, 15_000, "150.00"],
      ["Cat", 4, 0, null],
      ["Ben", 5, 0, null],
      ["Ann", 6, 0, null],
    ]);
    expect(body.warnings).toContain("Deal: the 3 players still in share $600 as agreed (Chip chop at 3 handed)");
    expect(body.planHash).toMatch(/^[0-9a-f]{32}$/);
    expect(body.planHash).not.toBe(plain.planHash);
  });

  it("says why a deal cannot be paid, code DEAL_INVALID, and pays nothing", async () => {
    const { agent, tournament, id, order } = await dealScenario();

    const response = await preview(agent, tournament.id, {
      finishOrder: order,
      deal: deal([
        [id("Fay"), "250"],
        [id("Eve"), "200"],
        [id("Dee"), "140"],
      ]),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: false,
      code: "DEAL_INVALID",
      rows: [],
      dealable: { totalCents: 60_000 },
      dealProblems: [{ code: "DEAL_TOTAL", message: "The deal must share $600 (it is $10 short)" }],
    });
    expect(response.body.planHash).toBeUndefined();
  });

  it("names a player who is not still in", async () => {
    const { agent, tournament, id, order } = await dealScenario();

    const response = await preview(agent, tournament.id, {
      finishOrder: order,
      deal: deal([
        [id("Fay"), "300"],
        [id("Cat"), "300"],
      ]),
    });

    expect(response.body).toMatchObject({ ok: false, code: "DEAL_INVALID", dealProblems: [{ code: "DEAL_PLAYERS", registrationId: id("Cat") }] });
  });

  it("answers 400 VALIDATION for a deal of one player or without a reason", async () => {
    const { agent, tournament, id, order } = await dealScenario();

    for (const body of [deal([[id("Fay"), "600"]]), deal([[id("Fay"), "300"], [id("Eve"), "300"]], "  ")]) {
      const response = await preview(agent, tournament.id, { finishOrder: order, deal: body });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION");
    }
  });
});

describe("finalize with a deal", () => {
  it("pays the deal, keeps positions by the finish order, and records it in the snapshot, the public feed and the audit log", async () => {
    const { staff, agent, tournament, id, order } = await dealScenario();
    const agreed = deal([
      [id("Fay"), "250"],
      [id("Eve"), "200"],
      [id("Dee"), "150"],
    ]);
    const { planHash } = (await preview(agent, tournament.id, { finishOrder: order, deal: agreed })).body as FinalizePreviewDto;

    const response = await agent.post(finalizePath(tournament.id)).send({ finishOrder: order, deal: agreed, expectedPlanHash: planHash });

    expect(response.status).toBe(200);
    const stored = await results(tournament.id);
    expect(stored.get(id("Fay"))).toEqual({ position: 1, prize: "250.00" });
    expect(stored.get(id("Eve"))).toEqual({ position: 2, prize: "200.00" });
    expect(stored.get(id("Dee"))).toEqual({ position: 3, prize: "150.00" });
    expect(stored.get(id("Cat"))).toEqual({ position: 4, prize: null });

    const players = [
      { registrationId: id("Fay"), playerName: "Fay", position: 1, plannedCents: 30_000, amountCents: 25_000 },
      { registrationId: id("Eve"), playerName: "Eve", position: 2, plannedCents: 18_000, amountCents: 20_000 },
      { registrationId: id("Dee"), playerName: "Dee", position: 3, plannedCents: 12_000, amountCents: 15_000 },
    ];
    expect(response.body.snapshot.deal).toMatchObject({ reason: "Chip chop at 3 handed", totalCents: 60_000, players });
    expect(response.body.snapshot.paid.map((place: { amountCents: number }) => place.amountCents)).toEqual([25_000, 20_000, 15_000]);
    const [row] = await testDb().select().from(tournaments).where(eq(tournaments.id, tournament.id));
    expect(row.prizePoolSnapshot?.deal).toEqual(response.body.snapshot.deal);

    const entries = await activity(tournament.id);
    expect(entries.map((entry) => entry.eventType)).toEqual(["status_change", "deal"]);
    expect(entries[1]).toMatchObject({ description: "Deal: Fay $250, Eve $200, Dee $150 (Chip chop at 3 handed)", playerId: null });
    expect(JSON.parse(entries[1].eventData ?? "")).toEqual(response.body.snapshot.deal);
    expect(findForbiddenKeys(entries)).toEqual([]);
    expect(await audits(tournament.id)).toMatchObject([
      { action: "tournament.finalize", actorUserId: staff.owner.user.id, data: { netCents: 60_000, planHash, deal: response.body.snapshot.deal } },
    ]);

    // The deal and its reason are public, as the feed is.
    const publicView = await (await anon()).get(`/api/tournaments/${tournament.id}`);
    expect(publicView.body.prizePoolSnapshot.deal).toEqual(response.body.snapshot.deal);
    expect(findForbiddenKeys(publicView.body)).toEqual([]);
  });

  it("refuses a wrong deal with 409 DEAL_INVALID, its problems and what may be shared, and writes nothing", async () => {
    const { agent, tournament, id, order } = await dealScenario();

    const response = await agent.post(finalizePath(tournament.id)).send({
      finishOrder: order,
      deal: deal([
        [id("Fay"), "300"],
        [id("Eve"), "200"],
        [id("Dee"), "150"],
      ]),
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "DEAL_INVALID",
      error: "The deal must share $600 (it is $50 too much)",
      details: { dealProblems: [{ code: "DEAL_TOTAL" }], dealable: { totalCents: 60_000, players: [{ playerName: "Fay" }, {}, {}] } },
    });
    const [row] = await testDb().select().from(tournaments).where(eq(tournaments.id, tournament.id));
    expect(row).toMatchObject({ status: "in_progress", prizePoolSnapshot: null });
    expect(await activity(tournament.id)).toHaveLength(0);
  });

  it("refuses a deal with one player still in", async () => {
    const { agent, tournament, id } = await dealScenario({ busted: 5 });

    const response = await agent.post(finalizePath(tournament.id)).send({ deal: deal([[id("Fay"), "300"], [id("Eve"), "300"]]) });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "DEAL_INVALID", details: { dealProblems: [{ code: "DEAL_TOO_FEW_PLAYERS" }], dealable: null } });
  });

  it("refuses with PLAN_CHANGED when the amounts differ from the previewed deal", async () => {
    const { agent, tournament, id, order } = await dealScenario();
    const shown = deal([[id("Fay"), "250"], [id("Eve"), "200"], [id("Dee"), "150"]]);
    const { planHash } = (await preview(agent, tournament.id, { finishOrder: order, deal: shown })).body as FinalizePreviewDto;

    const changed = deal([[id("Fay"), "200"], [id("Eve"), "200"], [id("Dee"), "200"]]);
    const response = await agent.post(finalizePath(tournament.id)).send({ finishOrder: order, deal: changed, expectedPlanHash: planHash });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PLAN_CHANGED");
    expect(response.body.details.preview.rows.map((row: { amountCents: number }) => row.amountCents).slice(0, 3)).toEqual([20_000, 20_000, 20_000]);
  });

  it("lets a player finishing below the paid places take a share, listed among those paid", async () => {
    const { agent, tournament, id, order } = await dealScenario({ busted: 2 });

    const response = await agent.post(finalizePath(tournament.id)).send({
      finishOrder: order,
      deal: deal([[id("Fay"), "200"], [id("Eve"), "150"], [id("Dee"), "150"], [id("Cat"), "100"]], "Even-ish chop at 4 handed"),
    });

    expect(response.status).toBe(200);
    expect((await results(tournament.id)).get(id("Cat"))).toEqual({ position: 4, prize: "100.00" });
    expect(response.body.snapshot.paid.map((place: { position: number; basisPoints: number; amountCents: number }) => [place.position, place.basisPoints, place.amountCents])).toEqual([
      [1, 5000, 20_000],
      [2, 3000, 15_000],
      [3, 2000, 15_000],
      [4, 0, 10_000],
    ]);
  });

  it("corrects a tournament finalized with a deal: the preview warns without it, and the correction records the deal again", async () => {
    const { agent, tournament, id, order } = await dealScenario();
    const agreed = deal([[id("Fay"), "250"], [id("Eve"), "200"], [id("Dee"), "150"]]);
    expect((await agent.post(finalizePath(tournament.id)).send({ finishOrder: order, deal: agreed })).status).toBe(200);

    const without = (await preview(agent, tournament.id, { finishOrder: order, force: true })).body as FinalizePreviewDto;
    expect(without.warnings).toContain(
      "It was finalized with a deal (Chip chop at 3 handed): without one, the players still in are paid their places' payouts",
    );

    const swapped = [order[1], order[0], order[2]];
    const again = (await preview(agent, tournament.id, { finishOrder: swapped, force: true, deal: agreed })).body as FinalizePreviewDto;
    const response = await agent.post(finalizePath(tournament.id)).send({ finishOrder: swapped, force: true, deal: agreed, expectedPlanHash: again.planHash });

    expect(response.status).toBe(200);
    expect((await results(tournament.id)).get(id("Eve"))).toEqual({ position: 1, prize: "200.00" });
    expect(response.body.snapshot.deal.players.map((player: { playerName: string; position: number }) => [player.playerName, player.position])).toEqual([
      ["Eve", 1],
      ["Fay", 2],
      ["Dee", 3],
    ]);
    expect((await activity(tournament.id)).map((entry) => entry.eventType)).toEqual(["status_change", "deal", "tournament_refinalized", "deal"]);
    const refinalize = (await audits(tournament.id)).find((entry) => entry.action === "tournament.refinalize");
    expect(refinalize?.data).toMatchObject({ deal: response.body.snapshot.deal, previous: { snapshot: { deal: { reason: "Chip chop at 3 handed" } } } });
  });
});
