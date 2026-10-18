/**
 * Characterization of today's club API (server/routes.ts): reads, create,
 * update and delete with their ownership checks, slugs, and the members count.
 *
 * `it.fails` tests state the correct behaviour for a known hole, tagged with
 * its audit finding id. They pass while the hole is open; when it is fixed,
 * Vitest reports them as failing, so switch them to `it`.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { clubs, players, seasons, tournamentRegistrations, tournaments } from "@shared/schema";
import {
  createClub,
  createPlayer,
  createRegistration,
  createSeason,
  createTournament,
  createUser,
} from "../factories";
import { anon, asJson, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const clubRow = async (id: string) => (await testDb().select().from(clubs).where(eq(clubs.id, id)))[0];

describe("GET /api/clubs", () => {
  it("lists every club, with every column, to anonymous visitors", async () => {
    const owner = await createUser();
    const owned = await createClub({ name: "A Club", ownerId: owner.id, description: "<p>Hi</p>" });
    const orphan = await createClub({ name: "B Club" });

    const response = await (await anon()).get("/api/clubs");

    expect(response.status).toBe(200);
    const listed = [...(response.body as Array<{ name: string }>)].sort((a, b) => a.name.localeCompare(b.name));
    expect(listed).toEqual([asJson(owned), asJson(orphan)]);
  });

  it("returns an empty list when there are no clubs", async () => {
    const response = await (await anon()).get("/api/clubs");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("GET /api/clubs/:id", () => {
  it("returns the club", async () => {
    const club = await createClub({ address: "1 Queen St, Auckland" });

    const response = await (await anon()).get(`/api/clubs/${club.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asJson(club));
  });

  it("answers 404 for an unknown id", async () => {
    const response = await (await anon()).get(`/api/clubs/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found" });
  });
});

describe("GET /api/clubs/slug/:slug", () => {
  it("finds a club by its exact slug", async () => {
    const club = await createClub({ slug: "central-stars" });

    const response = await (await anon()).get("/api/clubs/slug/central-stars");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asJson(club));
  });

  it("matches the slug case-sensitively", async () => {
    await createClub({ slug: "central-stars" });

    const response = await (await anon()).get("/api/clubs/slug/Central-Stars");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found" });
  });
});

describe("POST /api/clubs", () => {
  it("requires a signed-in user", async () => {
    const response = await (await anon()).post("/api/clubs").send({ name: "Night Owls", slug: "night-owls" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect(await testDb().select().from(clubs)).toHaveLength(0);
  });

  it("creates the club owned by the caller, whatever owner, id or createdAt the body names", async () => {
    const { agent, user } = await signIn();
    const someoneElse = await createUser();

    const response = await agent.post("/api/clubs").send({
      id: "client-chosen-id",
      createdAt: "2000-01-01T00:00:00.000Z",
      ownerId: someoneElse.id,
      name: "Night Owls",
      slug: "night-owls",
      description: "<p>Fridays at <strong>7pm</strong></p>",
      timezone: "Pacific/Auckland",
      websiteUrl: "https://nightowls.example",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Night Owls",
      slug: "night-owls",
      description: "<p>Fridays at <strong>7pm</strong></p>",
      imageUrl: null,
      timezone: "Pacific/Auckland",
      address: null,
      discordUrl: null,
      twitterUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      websiteUrl: "https://nightowls.example",
      ownerId: user.id,
      createdAt: expect.any(String),
    });
    expect(response.body.id).not.toBe("client-chosen-id");
    expect(response.body.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(asJson(await clubRow(response.body.id))).toEqual(response.body);
  });

  it("never generates a slug: the client must send one", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Night Owls" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid club data" });
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["slug"] })]);
  });

  it("rejects a body without a name", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ slug: "nameless" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid club data");
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["name"] })]);
  });

  it("refuses a slug another club already has and keeps the first club as it was", async () => {
    const first = await createClub({ slug: "central-stars", name: "Central Stars" });
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Copycat", slug: "central-stars" });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const withSlug = await testDb().select().from(clubs).where(eq(clubs.slug, "central-stars"));
    expect(withSlug).toEqual([first]);
  });

  it.fails("answers a duplicate slug with 409 Conflict, not 500 (SEC-07)", async () => {
    await createClub({ slug: "central-stars" });
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Copycat", slug: "central-stars" });

    expect(response.status).toBe(409);
  });

  it.fails("refuses slugs that are not lowercase letters, digits and hyphens (SEC-07, CC-17)", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Spaced Out", slug: "../Has Spaces" });

    expect(response.status).toBe(400);
  });

  it("stores rich-text formatting in the description as sent", async () => {
    const { agent } = await signIn();
    const description = '<h2>Welcome</h2><p><strong>Weekly</strong> games, <em>all</em> levels. <a href="https://example.test">Info</a></p><ul><li>Fridays</li></ul>';

    const response = await agent.post("/api/clubs").send({ name: "Rich", slug: "rich", description });

    expect(response.status).toBe(201);
    expect((await clubRow(response.body.id)).description).toBe(description);
  });

  it.fails("never stores script-bearing HTML in a description, on create or update (SEC-08)", async () => {
    const { agent, user } = await signIn();
    const payload = '<p>Hi</p><img src=x onerror="alert(1)"><script>alert(2)</script><iframe srcdoc="<script>alert(3)</script>"></iframe>';
    const existing = await createClub({ ownerId: user.id });

    const created = await agent.post("/api/clubs").send({ name: "Evil", slug: "evil", description: payload });
    const updated = await agent.put(`/api/clubs/${existing.id}`).send({ description: payload });

    // Stored sanitised, or refused outright; a server error that stores nothing is no fix.
    expect([201, 400, 422]).toContain(created.status);
    expect([200, 400, 422]).toContain(updated.status);
    const rows = await testDb().select().from(clubs);
    expect(rows).toHaveLength(created.status === 201 ? 2 : 1);
    for (const club of rows) {
      expect(club.description ?? "").not.toMatch(/onerror|<script|<iframe/i);
    }
  });

  it.fails("never stores a javascript: URL in a social link (SEC-08)", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Evil", slug: "evil", discordUrl: "javascript:alert(1)" });

    // Stored without the link, or refused outright; a server error that stores nothing is no fix.
    expect([201, 400, 422]).toContain(response.status);
    const rows = await testDb().select().from(clubs);
    expect(rows).toHaveLength(response.status === 201 ? 1 : 0);
    for (const club of rows) {
      expect(club.discordUrl ?? "").not.toMatch(/^\s*javascript:/i);
    }
  });
});

describe("PUT /api/clubs/:id", () => {
  it("requires a signed-in user", async () => {
    const club = await createClub();

    const response = await (await anon()).put(`/api/clubs/${club.id}`).send({ name: "Renamed" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect(await clubRow(club.id)).toEqual(club);
  });

  it("lets the owner change the fields sent and leaves the rest alone", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id, address: "1 Queen St" });

    const response = await agent.put(`/api/clubs/${club.id}`).send({ name: "Renamed", slug: "renamed", websiteUrl: "https://x.test" });

    expect(response.status).toBe(200);
    const expected = { ...club, name: "Renamed", slug: "renamed", websiteUrl: "https://x.test" };
    expect(response.body).toEqual(asJson(expected));
    expect(await clubRow(club.id)).toEqual(expected);
  });

  it("lets an admin update a club they do not own", async () => {
    const { agent } = await signIn({ role: "admin" });
    const club = await createClub({ ownerId: (await createUser()).id });

    const response = await agent.put(`/api/clubs/${club.id}`).send({ description: "<p>Edited by admin</p>" });

    expect(response.status).toBe(200);
    expect(response.body.description).toBe("<p>Edited by admin</p>");
  });

  it("refuses a member who does not own the club, including a club with no owner", async () => {
    const { agent } = await signIn();
    const othersClub = await createClub({ ownerId: (await createUser()).id });
    const ownerlessClub = await createClub();

    for (const club of [othersClub, ownerlessClub]) {
      const response = await agent.put(`/api/clubs/${club.id}`).send({ name: "Hijacked" });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "You don't have permission to update this club" });
      expect(await clubRow(club.id)).toEqual(club);
    }
  });

  it("answers 404 for an unknown club", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/clubs/${UNKNOWN_ID}`).send({ name: "Ghost" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found" });
  });

  it("rejects an invalid body and leaves the club unchanged", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id });

    const response = await agent.put(`/api/clubs/${club.id}`).send({ name: 42 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid club data");
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["name"] })]);
    expect(await clubRow(club.id)).toEqual(club);
  });

  it.fails("does not let the owner hand the club to someone else or orphan it (SEC-07)", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id });
    const someoneElse = await createUser();

    await agent.put(`/api/clubs/${club.id}`).send({ ownerId: someoneElse.id });
    expect((await clubRow(club.id)).ownerId).toBe(user.id);

    await agent.put(`/api/clubs/${club.id}`).send({ ownerId: null });
    expect((await clubRow(club.id)).ownerId).toBe(user.id);
  });
});

describe("DELETE /api/clubs/:id", () => {
  it("requires a signed-in user", async () => {
    const club = await createClub();

    const response = await (await anon()).delete(`/api/clubs/${club.id}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
    expect(await clubRow(club.id)).toEqual(club);
  });

  it("refuses a member who does not own the club", async () => {
    const { agent } = await signIn();
    const club = await createClub({ ownerId: (await createUser()).id });

    const response = await agent.delete(`/api/clubs/${club.id}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "You don't have permission to delete this club" });
    expect(await clubRow(club.id)).toEqual(club);
  });

  it("lets the owner delete the club, which also deletes its seasons, tournaments and registrations but not players", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id });
    const season = await createSeason({ clubId: club.id });
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id });
    const player = await createPlayer();
    await createRegistration({ tournamentId: tournament.id, playerId: player.id });
    const otherClub = await createClub();
    const otherTournament = await createTournament({ clubId: otherClub.id });

    const response = await agent.delete(`/api/clubs/${club.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    const db = testDb();
    expect(await clubRow(club.id)).toBeUndefined();
    expect(await db.select().from(seasons).where(eq(seasons.clubId, club.id))).toEqual([]);
    expect((await db.select().from(tournaments)).map((row) => row.id)).toEqual([otherTournament.id]);
    expect(await db.select().from(tournamentRegistrations)).toEqual([]);
    expect(await db.select().from(players).where(eq(players.id, player.id))).toEqual([player]);
  });

  it("lets an admin delete a club they do not own", async () => {
    const { agent } = await signIn({ role: "admin" });
    const club = await createClub({ ownerId: (await createUser()).id });

    const response = await agent.delete(`/api/clubs/${club.id}`);

    expect(response.status).toBe(204);
    expect(await clubRow(club.id)).toBeUndefined();
  });

  it("answers 404 for an unknown club", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.delete(`/api/clubs/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found" });
  });
});

describe("GET /api/clubs/:id/members-count", () => {
  it("counts distinct players registered in any of the club's tournaments, paid or not", async () => {
    const club = await createClub();
    const otherClub = await createClub();
    const [first, second] = [await createTournament({ clubId: club.id }), await createTournament({ clubId: club.id })];
    const elsewhere = await createTournament({ clubId: otherClub.id });
    const [alice, bob, carol, dave] = [await createPlayer(), await createPlayer(), await createPlayer(), await createPlayer()];
    await createRegistration({ tournamentId: first.id, playerId: alice.id, paymentConfirmed: true });
    await createRegistration({ tournamentId: first.id, playerId: bob.id, paymentConfirmed: true });
    await createRegistration({ tournamentId: second.id, playerId: bob.id, paymentConfirmed: true });
    await createRegistration({ tournamentId: second.id, playerId: carol.id, paymentConfirmed: false });
    await createRegistration({ tournamentId: elsewhere.id, playerId: dave.id, paymentConfirmed: true });

    const response = await (await anon()).get(`/api/clubs/${club.id}/members-count`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 3 });
  });

  it("answers zero for a club with no registrations and for an unknown club", async () => {
    const club = await createClub();
    await createTournament({ clubId: club.id });

    for (const id of [club.id, UNKNOWN_ID]) {
      const response = await (await anon()).get(`/api/clubs/${id}/members-count`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0 });
    }
  });
});
