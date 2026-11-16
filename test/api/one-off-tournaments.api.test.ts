/**
 * One-off games (round 7, item 7): tournaments with no season and no points system. Created and edited
 * through PUT/POST /api/tournaments (server/services/tournaments.ts pointsSettings): no season means
 * no points system, and points are tracked only with one; a game still open may leave its season, a
 * closed one keeps what it scored with. The list filters them (`oneOff`), finalize pays their prizes
 * and scores no points, so no season leaderboard ever shows them, and the TV's QR code leads to the
 * tournament page instead of a season.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { tournamentRegistrations, tournaments } from "@shared/schema";
import { createPlayer, createPointsSystem, createRegistration, createSeason, createTournament, createTournamentScenario } from "../factories";
import { createClock } from "../factories/clock";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const tournamentRow = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

const newTournament = (clubId: string, extra: Record<string, unknown> = {}) => ({
  name: "Charity Night",
  clubId,
  startDateTime: "2026-11-20T07:00:00.000Z",
  buyInAmount: "40",
  maxPlayers: 30,
  ...extra,
});

/** A club with its staff signed in, a season and that season's points system. */
async function clubWithSeason() {
  const staff = await clubWithStaff();
  const season = await createSeason({ clubId: staff.club.id, name: "Summer League" });
  const points = await createPointsSystem({ seasonId: season.id, participationPoints: 5 });
  return { staff, agent: staff.owner.agent, season, points };
}

const pointsOf = (row: { seasonId: string | null; pointsSystemId: string | null; trackPoints: boolean | null }) => ({
  seasonId: row.seasonId,
  pointsSystemId: row.pointsSystemId,
  trackPoints: row.trackPoints,
});

describe("creating a one-off game", () => {
  it("stores no season, no points system and no points, whatever trackPoints says", async () => {
    const { staff, agent } = await clubWithSeason();

    const response = await agent.post("/api/tournaments").send(newTournament(staff.club.id, { seasonId: "", pointsSystemId: "", trackPoints: true }));

    expect(response.status).toBe(201);
    expect(pointsOf(response.body)).toEqual({ seasonId: null, pointsSystemId: null, trackPoints: false });
    expect(pointsOf(await tournamentRow(response.body.id))).toEqual({ seasonId: null, pointsSystemId: null, trackPoints: false });
  });

  it("tracks points only with a points system: a season game without one scores none", async () => {
    const { staff, agent, season, points } = await clubWithSeason();

    const scored = await agent.post("/api/tournaments").send(newTournament(staff.club.id, { seasonId: season.id, pointsSystemId: points.id }));
    const unscored = await agent.post("/api/tournaments").send(newTournament(staff.club.id, { seasonId: season.id, trackPoints: true }));
    const switchedOff = await agent
      .post("/api/tournaments")
      .send(newTournament(staff.club.id, { seasonId: season.id, pointsSystemId: points.id, trackPoints: false }));

    expect(pointsOf(scored.body)).toEqual({ seasonId: season.id, pointsSystemId: points.id, trackPoints: true });
    expect(pointsOf(unscored.body)).toEqual({ seasonId: season.id, pointsSystemId: null, trackPoints: false });
    expect(pointsOf(switchedOff.body)).toEqual({ seasonId: season.id, pointsSystemId: points.id, trackPoints: false });
  });

  it("still refuses a points system with no season", async () => {
    const { staff, agent, points } = await clubWithSeason();

    const response = await agent.post("/api/tournaments").send(newTournament(staff.club.id, { pointsSystemId: points.id }));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "POINTS_SYSTEM_NOT_IN_SEASON" });
    expect(await testDb().select().from(tournaments)).toEqual([]);
  });

  it("takes a free tournament: a $0 buy-in (round 7, item 8)", async () => {
    const { staff, agent } = await clubWithSeason();

    const response = await agent.post("/api/tournaments").send(newTournament(staff.club.id, { buyInAmount: "0" }));

    expect(response.status).toBe(201);
    expect((await tournamentRow(response.body.id)).buyInAmount).toBe("0.00");
  });
});

describe("moving a tournament off its season", () => {
  it.each(["scheduled", "registration", "in_progress"] as const)("makes a %s game a one-off, taking its points system with it", async (status) => {
    const { staff, agent, season, points } = await clubWithSeason();
    const tournament = await createTournament({ clubId: staff.club.id, status, seasonId: season.id, pointsSystemId: points.id, trackPoints: true });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: null });

    expect(response.status).toBe(200);
    expect(pointsOf(response.body)).toEqual({ seasonId: null, pointsSystemId: null, trackPoints: false });
    expect(pointsOf(await tournamentRow(tournament.id))).toEqual({ seasonId: null, pointsSystemId: null, trackPoints: false });
  });

  it("puts a one-off game into a season with its points system, scoring again", async () => {
    const { staff, agent, season, points } = await clubWithSeason();
    const tournament = await createTournament({ clubId: staff.club.id, seasonId: null, trackPoints: false });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: season.id, pointsSystemId: points.id, trackPoints: true });

    expect(response.status).toBe(200);
    expect(pointsOf(await tournamentRow(tournament.id))).toEqual({ seasonId: season.id, pointsSystemId: points.id, trackPoints: true });
  });

  it("refuses a move to another season that keeps the old season's points system", async () => {
    const { staff, agent, season, points } = await clubWithSeason();
    const winter = await createSeason({ clubId: staff.club.id });
    const tournament = await createTournament({ clubId: staff.club.id, seasonId: season.id, pointsSystemId: points.id });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: winter.id });

    expect(response.body).toMatchObject({ code: "POINTS_SYSTEM_NOT_IN_SEASON" });
    expect(pointsOf(await tournamentRow(tournament.id))).toMatchObject({ seasonId: season.id, pointsSystemId: points.id });
  });

  it("leaves the stored points alone on an edit that does not touch them", async () => {
    const { staff, agent, season } = await clubWithSeason();
    // Made before round 7: a season, no points system, trackPoints on (the column's default).
    const tournament = await createTournament({ clubId: staff.club.id, seasonId: season.id, trackPoints: true });

    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ name: "Renamed" })).status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({ name: "Renamed", trackPoints: true });
  });

  it.each(["completed", "cancelled"] as const)("keeps a %s game in its season, with what it scored with", async (status) => {
    const { staff, agent, season, points } = await clubWithSeason();
    const tournament = await createTournament({ clubId: staff.club.id, status, seasonId: season.id, pointsSystemId: points.id, trackPoints: true });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: null });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TOURNAMENT_CLOSED", details: { fields: ["seasonId"] } });
    expect(response.body.error).toContain("its prize pool, season and points settings can no longer change");
    expect(pointsOf(await tournamentRow(tournament.id))).toEqual({ seasonId: season.id, pointsSystemId: points.id, trackPoints: true });
  });

  it("accepts a closed game's points resent as the form now reads them: trackPoints with no points system is no points", async () => {
    const { staff, agent } = await clubWithSeason();
    // A finished one-off made before round 7, with the column's trackPoints default.
    const tournament = await createTournament({ clubId: staff.club.id, status: "completed", seasonId: null, trackPoints: true });

    const response = await agent.put(`/api/tournaments/${tournament.id}`).send({ trackPoints: false, seasonId: null, pointsSystemId: null, name: "Final night" });

    expect(response.status).toBe(200);
    // Frozen as it finished: nothing about its points is written.
    expect(await tournamentRow(tournament.id)).toMatchObject({ name: "Final night", seasonId: null, pointsSystemId: null, trackPoints: true });
  });
});

describe("GET /api/tournaments?oneOff=", () => {
  it("keeps only the one-off games, or only the season games, with the other filters", async () => {
    const { staff, season } = await clubWithSeason();
    const league = await createTournament({ clubId: staff.club.id, seasonId: season.id });
    const oneOff = await createTournament({ clubId: staff.club.id, seasonId: null });
    const finishedOneOff = await createTournament({ clubId: staff.club.id, seasonId: null, status: "completed" });
    const ids = async (query: string) => ((await (await anon()).get(`/api/tournaments${query}`)).body as { id: string }[]).map((row) => row.id);

    expect(await ids("?oneOff=true")).toEqual([oneOff.id, finishedOneOff.id]);
    expect(await ids("?oneOff=false")).toEqual([league.id]);
    expect(await ids(`?oneOff=true&status=completed&clubId=${staff.club.id}`)).toEqual([finishedOneOff.id]);
    expect(await ids(`?oneOff=true&seasonId=${season.id}`)).toEqual([]);
    expect(await ids("")).toHaveLength(3);
  });

  it("refuses anything but true or false", async () => {
    const response = await (await anon()).get("/api/tournaments?oneOff=yes");

    expect(response.status).toBe(400);
  });
});

describe("finalizing a one-off game", () => {
  it("pays the prizes, scores no points and leaves the season's leaderboard as it was", async () => {
    const owner = await clubWithStaff();
    // A league game in progress, with a points system, that the TD turns into a one-off before the end.
    const scenario = await createTournamentScenario({
      players: 4,
      buyIn: "50.00",
      owner: { id: owner.owner.user.id },
      eliminations: [0, 1, 2],
      points: { participation: 5, allocations: [{ position: 1, points: 100 }] },
      tournament: { status: "in_progress", trackPoints: true },
    });
    const { season, tournament } = scenario;
    const champion = await createPlayer({ name: "Last Season's Champ" });
    const earlier = await createTournament({ clubId: scenario.club.id, seasonId: season.id, status: "completed" });
    await createRegistration({ tournamentId: earlier.id, playerId: champion.id, paymentConfirmed: true, finalPosition: 1, pointsAwarded: 100 });
    const leaderboard = async () => (await (await anon()).get(`/api/public/seasons/${season.id}/leaderboard`)).body;
    const { agent } = owner.owner;
    expect((await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: null })).status).toBe(200);
    const before = await leaderboard();

    const response = await agent.post(`/api/tournaments/${tournament.id}/finalize`);

    expect(response.status).toBe(200);
    expect(response.body.snapshot.points).toEqual({ trackPoints: false, pointsSystem: null, allocations: [] });
    const results = await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournament.id));
    expect(results.map((row) => row.pointsAwarded)).toEqual([null, null, null, null]);
    expect(results.filter((row) => row.prizeAmount !== null).length).toBeGreaterThan(0);
    expect(await tournamentRow(tournament.id)).toMatchObject({ status: "completed", seasonId: null, pointsSystemId: null });
    const after = await leaderboard();
    expect(after.entries).toEqual(before.entries);
    expect(after.tournaments).toEqual(before.tournaments);
    expect(after.entries.map((entry: { player: { name: string } }) => entry.player.name)).toEqual(["Last Season's Champ"]);
  });
});

describe("the TV's QR code for a one-off game", () => {
  it("leads to the tournament page once the game leaves its season", async () => {
    const { staff, agent, season } = await clubWithSeason();
    const tournament = await createTournament({ clubId: staff.club.id, seasonId: season.id, status: "in_progress" });
    await createClock({ tournamentId: tournament.id, displaySettings: { qrTarget: "season" } });
    const display = async () => (await (await anon()).get(`/api/public/tournaments/${tournament.id}/display`)).body;

    expect((await display()).qr).toEqual({ target: "season", path: `/season/${season.id}` });
    await agent.put(`/api/tournaments/${tournament.id}`).send({ seasonId: null });

    const body = await display();
    expect(body.qr).toEqual({ target: "tournament", path: `/tournament/${tournament.id}` });
    expect(body.season).toBeNull();
    expect(body.tournament.seasonId).toBeNull();
  });
});
