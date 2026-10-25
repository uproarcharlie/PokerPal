/**
 * The club API (server/routes/clubs.ts): public reads with a public projection (no ownerId) and
 * `viewer.canManage`, create by any signed-in user (who becomes the owner), update by the club's
 * staff with a narrow schema, delete by its owner or an admin, slugs, description sanitising and
 * the member counts.
 */
import { and, eq } from "drizzle-orm";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, clubs, players, seasons, tournamentRegistrations, tournaments, type Club } from "@shared/schema";
import { CLUB_DESCRIPTION_STORED_MAX, MAX_CLUBS_PER_OWNER } from "@shared/api/clubs";
import { findForbiddenKeys, pickFields, PUBLIC_CLUB_FIELDS } from "@shared/api/public";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import {
  createClub,
  createPlayer,
  createRegistration,
  createSeason,
  createTournament,
  createUser,
  FACTORY_PASSWORD,
} from "../factories";
import { anon, asJson, loginAs, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const clubRow = async (id: string) => (await testDb().select().from(clubs).where(eq(clubs.id, id)))[0];

/** The club as the API serves it to a viewer. */
const asClubDto = (club: Club, canManage = false, canOwn = canManage) =>
  asJson({ ...pickFields(club, PUBLIC_CLUB_FIELDS), viewer: { canManage, canOwn } });

const UNAUTHENTICATED = { error: "Authentication required", code: "UNAUTHENTICATED" };

describe("GET /api/clubs", () => {
  it("lists every club, oldest first, without its owner, to anonymous visitors", async () => {
    const owner = await createUser();
    const owned = await createClub({ name: "B Club", ownerId: owner.id, description: "<p>Hi</p>", createdAt: new Date("2026-01-01") });
    const orphan = await createClub({ name: "A Club", createdAt: new Date("2026-02-01") });

    const response = await (await anon()).get("/api/clubs");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([asClubDto(owned), asClubDto(orphan)]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(owner.id);
  });

  it("tells each signed-in viewer which clubs they can manage: owner, manager, admin", async () => {
    const { club, owner, manager, stranger, admin } = await clubWithStaff();
    const other = await createClub();

    for (const [who, expected] of [
      [owner, { [club.id]: true, [other.id]: false }],
      [manager, { [club.id]: true, [other.id]: false }],
      [stranger, { [club.id]: false, [other.id]: false }],
      [admin, { [club.id]: true, [other.id]: true }],
    ] as const) {
      const response = await who.agent.get("/api/clubs");

      expect(response.status).toBe(200);
      const flags = Object.fromEntries((response.body as Array<{ id: string; viewer: { canManage: boolean } }>).map((c) => [c.id, c.viewer.canManage]));
      expect(flags).toEqual(expected);
    }
  });

  it("serves a stored description sanitised, without rewriting the row (SEC-08)", async () => {
    const stored = '<p>Hi</p><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>';
    const club = await createClub({ description: stored });

    const response = await (await anon()).get("/api/clubs");

    expect(response.body[0].description).toBe("<p>Hi</p>x");
    expect((await clubRow(club.id)).description).toBe(stored);
  });

  it("returns an empty list when there are no clubs", async () => {
    const response = await (await anon()).get("/api/clubs");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("sends a stored social link only when it is an http(s) URL: older rows were never checked (P2REV0-SEC-05)", async () => {
    const club = await createClub({
      discordUrl: "javascript:alert(document.cookie)",
      twitterUrl: "data:text/html,<script>alert(1)</script>",
      facebookUrl: "  https://facebook.example/club  ",
      instagramUrl: "not a url",
      websiteUrl: "https://club.example/",
    });

    const listed = (await (await anon()).get("/api/clubs")).body[0];
    const single = (await (await anon()).get(`/api/clubs/${club.id}`)).body;

    for (const body of [listed, single]) {
      expect(body).toMatchObject({
        discordUrl: null,
        twitterUrl: null,
        facebookUrl: "https://facebook.example/club",
        instagramUrl: null,
        websiteUrl: "https://club.example/",
      });
    }
    expect((await clubRow(club.id)).discordUrl).toBe("javascript:alert(document.cookie)");
  });

  it("gives only the first clubs, oldest first, with ?limit= (the home page's short list), and refuses a bad limit (P2REV0-SEC-02)", async () => {
    const first = await createClub({ name: "First", createdAt: new Date("2026-01-01") });
    const second = await createClub({ name: "Second", createdAt: new Date("2026-02-01") });
    await createClub({ name: "Third", createdAt: new Date("2026-03-01") });

    const response = await (await anon()).get("/api/clubs?limit=2");

    expect(response.status).toBe(200);
    expect(response.body.map((club: { id: string }) => club.id)).toEqual([first.id, second.id]);
    expect((await (await anon()).get("/api/clubs?limit=0")).status).toBe(400);
    expect((await (await anon()).get("/api/clubs?limit=1000")).status).toBe(400);
  });
});

describe("GET /api/clubs/:id", () => {
  it("returns the club's public projection", async () => {
    const club = await createClub({ address: "1 Queen St, Auckland", ownerId: (await createUser()).id, rakeLabel: "AP" });

    const response = await (await anon()).get(`/api/clubs/${club.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asClubDto(club));
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("says whether the viewer can manage it", async () => {
    const { club, manager, stranger } = await clubWithStaff();

    expect((await manager.agent.get(`/api/clubs/${club.id}`)).body.viewer).toEqual({ canManage: true, canOwn: false });
    expect((await stranger.agent.get(`/api/clubs/${club.id}`)).body.viewer).toEqual({ canManage: false, canOwn: false });
  });

  it("answers 404 for an unknown id", async () => {
    const response = await (await anon()).get(`/api/clubs/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found", code: "NOT_FOUND" });
  });
});

describe("GET /api/clubs/slug/:slug", () => {
  it("finds a club by its slug", async () => {
    const club = await createClub({ slug: "central-stars" });

    const response = await (await anon()).get("/api/clubs/slug/central-stars");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asClubDto(club));
  });

  it("ignores case, so /club/Central-Stars works (CC-17)", async () => {
    const club = await createClub({ slug: "central-stars" });

    const response = await (await anon()).get("/api/clubs/slug/Central-Stars");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(club.id);
  });

  it("prefers the exact slug when legacy slugs differ only in case", async () => {
    const lower = await createClub({ slug: "night-owls" });
    const upper = await createClub({ slug: "Night-Owls" });

    expect((await (await anon()).get("/api/clubs/slug/night-owls")).body.id).toBe(lower.id);
    expect((await (await anon()).get("/api/clubs/slug/Night-Owls")).body.id).toBe(upper.id);
  });

  it("answers 404 for an unknown slug", async () => {
    const response = await (await anon()).get("/api/clubs/slug/nobody");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found", code: "NOT_FOUND" });
  });
});

describe("POST /api/clubs", () => {
  it("requires a signed-in, active user", async () => {
    const response = await (await anon()).post("/api/clubs").send({ name: "Night Owls", slug: "night-owls" });
    const { deactivated } = await clubWithStaff();
    const fromDeactivated = await deactivated.agent.post("/api/clubs").send({ name: "Night Owls", slug: "night-owls" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(fromDeactivated.status).toBe(401);
    expect(await testDb().select().from(clubs).where(eq(clubs.slug, "night-owls"))).toHaveLength(0);
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
      rakeLabel: "AP",
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
      rakeLabel: "AP",
      defaultSeatsPerTable: null,
      defaultTableShape: null,
      requireSignupPhoto: false,
      theme: null,
      createdAt: expect.any(String),
      viewer: { canManage: true, canOwn: true },
    });
    expect(response.body.id).not.toBe("client-chosen-id");
    expect(response.body.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    const row = await clubRow(response.body.id);
    expect(row.ownerId).toBe(user.id);
    expect(asClubDto(row, true)).toEqual(response.body);
  });

  it("never generates a slug: the client must send one", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Night Owls" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid club data", code: "VALIDATION" });
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["slug"] })]);
  });

  it("rejects a body without a name", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ slug: "nameless" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid club data");
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["name"] })]);
  });

  it("answers a slug another club already has, in any case, with 409 and keeps that club as it was (SEC-07)", async () => {
    const first = await createClub({ slug: "central-stars", name: "Central Stars" });
    const { agent } = await signIn();

    for (const slug of ["central-stars", "Central-Stars"]) {
      const response = await agent.post("/api/clubs").send({ name: "Copycat", slug });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "That club URL is already taken", code: "SLUG_TAKEN" });
    }
    expect(await testDb().select().from(clubs)).toEqual([first]);
  });

  it("stores the slug lower-cased", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Night Owls", slug: "Night-Owls" });

    expect(response.status).toBe(201);
    expect(response.body.slug).toBe("night-owls");
  });

  it("refuses slugs that are not lowercase words joined by hyphens, or that are reserved (SEC-07, CC-17)", async () => {
    const { agent } = await signIn();

    for (const slug of ["../Has Spaces", "a", "admin", "trailing-", "x".repeat(61)]) {
      const response = await agent.post("/api/clubs").send({ name: "Bad slug", slug });

      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([expect.objectContaining({ path: ["slug"] })]);
    }
    expect(await testDb().select().from(clubs)).toEqual([]);
  });

  it("keeps the rich-text editor's formatting, with links made safe", async () => {
    const { agent } = await signIn();
    const description =
      '<h2>Welcome</h2><p><strong>Weekly</strong> games, <em>all</em> levels. <a href="https://example.test">Info</a></p><ul><li>Fridays</li></ul>';

    const response = await agent.post("/api/clubs").send({ name: "Rich", slug: "rich", description });

    expect(response.status).toBe(201);
    const stored =
      '<h2>Welcome</h2><p><strong>Weekly</strong> games, <em>all</em> levels. <a href="https://example.test/" rel="noopener noreferrer nofollow">Info</a></p><ul><li>Fridays</li></ul>';
    expect((await clubRow(response.body.id)).description).toBe(stored);
    expect(response.body.description).toBe(stored);
  });

  it("never stores script-bearing HTML in a description, on create or update (SEC-08)", async () => {
    const { agent, user } = await signIn();
    const payload = '<p>Hi</p><img src=x onerror="alert(1)"><script>alert(2)</script><iframe srcdoc="<script>alert(3)</script>"></iframe>';
    const existing = await createClub({ ownerId: user.id });

    const created = await agent.post("/api/clubs").send({ name: "Evil", slug: "evil", description: payload });
    const updated = await agent.put(`/api/clubs/${existing.id}`).send({ description: payload });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    const rows = await testDb().select().from(clubs);
    expect(rows).toHaveLength(2);
    for (const club of rows) expect(club.description).toBe("<p>Hi</p>");
  });

  it("stores an empty editor (or only markup) as no description", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Blank", slug: "blank", description: "<p></p>" });

    expect(response.status).toBe(201);
    expect((await clubRow(response.body.id)).description).toBeNull();
  });

  it("never stores a javascript: URL in a social link (SEC-08)", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/clubs").send({ name: "Evil", slug: "evil", discordUrl: "javascript:alert(1)" });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["discordUrl"] })]);
    expect(await testDb().select().from(clubs)).toEqual([]);
  });

  it("refuses a description that would be too long once its formatting is saved (P2REV0-SEC-02)", async () => {
    const { agent } = await signIn();
    // 15,000 "<" characters are stored as "&lt;": 60,000 characters on every public list.
    const response = await agent.post("/api/clubs").send({ name: "Angles", slug: "angles", description: "<".repeat(15_000) });

    expect(15_000 * "&lt;".length).toBeGreaterThan(CLUB_DESCRIPTION_STORED_MAX);
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["description"] })]);
    expect(await testDb().select().from(clubs)).toEqual([]);
  });

  it(`lets one account own at most ${MAX_CLUBS_PER_OWNER} clubs, admins excepted (P2REV0-SEC-02)`, async () => {
    const { agent, user } = await signIn();
    for (let n = 0; n < MAX_CLUBS_PER_OWNER; n++) await createClub({ ownerId: user.id });

    const refused = await agent.post("/api/clubs").send({ name: "One Too Many", slug: "one-too-many" });
    const admin = await loginAs("admin");
    for (let n = 0; n < MAX_CLUBS_PER_OWNER; n++) await createClub({ ownerId: admin.user.id });
    const byAdmin = await admin.agent.post("/api/clubs").send({ name: "Admin's Club", slug: "admins-club" });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "CLUB_LIMIT_REACHED" });
    expect(await testDb().select().from(clubs).where(eq(clubs.slug, "one-too-many"))).toEqual([]);
    expect(byAdmin.status).toBe(201);
  });

  it("counts two creates at once by one account against its limit only once each", async () => {
    const { agent, user } = await signIn();
    for (let n = 0; n < MAX_CLUBS_PER_OWNER - 1; n++) await createClub({ ownerId: user.id });

    const [a, b] = await Promise.all([
      agent.post("/api/clubs").send({ name: "Race A", slug: "race-a" }),
      agent.post("/api/clubs").send({ name: "Race B", slug: "race-b" }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await testDb().select().from(clubs).where(eq(clubs.ownerId, user.id))).toHaveLength(MAX_CLUBS_PER_OWNER);
  });

  it("throttles opening clubs per account and per address, counting only clubs actually opened (P2REV0-SEC-02)", async () => {
    const app = await createApp({
      env: loadEnv(process.env),
      sessionStore: new session.MemoryStore(),
      rateLimits: { enabled: true, limits: { clubCreate: 2, clubCreateVisitor: 3 } },
    });
    const agentFor = async () => {
      const agent = request.agent(app);
      const user = await createUser();
      expect((await agent.post("/api/auth/login").send({ email: user.email, password: FACTORY_PASSWORD })).status).toBe(200);
      return agent;
    };
    const first = await agentFor();
    const open = (agent: request.Agent, slug: string) => agent.post("/api/clubs").send({ name: slug, slug });

    expect((await first.post("/api/clubs").send({ slug: "no-name" })).status).toBe(400);
    expect((await open(first, "club-one")).status).toBe(201);
    expect((await open(first, "club-two")).status).toBe(201);
    const perAccount = await open(first, "club-three");
    expect(perAccount.status).toBe(429);
    expect(perAccount.body.code).toBe("RATE_LIMITED");

    const second = await agentFor();
    expect((await open(second, "club-four")).status).toBe(201);
    expect((await open(second, "club-five")).status).toBe(429);
    expect(await testDb().select().from(clubs)).toHaveLength(3);
  });

  it("accepts only an image from our own storage, and only a time zone that exists", async () => {
    const { agent } = await signIn();

    const foreign = await agent.post("/api/clubs").send({ name: "A", slug: "club-a", imageUrl: "https://elsewhere.test/logo.png" });
    const zone = await agent.post("/api/clubs").send({ name: "B", slug: "club-b", timezone: "Mars/Olympus" });
    const own = await agent.post("/api/clubs").send({ name: "C", slug: "club-c", imageUrl: "/uploads/clubs/logo.webp" });

    expect(foreign.status).toBe(400);
    expect(foreign.body.details).toEqual([expect.objectContaining({ path: ["imageUrl"] })]);
    expect(zone.status).toBe(400);
    expect(zone.body.details).toEqual([expect.objectContaining({ path: ["timezone"] })]);
    expect(own.status).toBe(201);
    expect(own.body.imageUrl).toBe("/uploads/clubs/logo.webp");
  });
});

describe("PUT /api/clubs/:id", () => {
  it("requires a signed-in, active user", async () => {
    const { club, deactivated } = await clubWithStaff();

    const response = await (await anon()).put(`/api/clubs/${club.id}`).send({ name: "Renamed" });
    const fromDeactivated = await deactivated.agent.put(`/api/clubs/${club.id}`).send({ name: "Renamed" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(fromDeactivated.status).toBe(401);
    expect(await clubRow(club.id)).toEqual(club);
  });

  it("lets the owner change the fields sent and leaves the rest alone", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id, address: "1 Queen St" });

    const response = await agent.put(`/api/clubs/${club.id}`).send({ name: "Renamed", slug: "renamed", websiteUrl: "https://x.test" });

    expect(response.status).toBe(200);
    const expected = { ...club, name: "Renamed", slug: "renamed", websiteUrl: "https://x.test" };
    expect(response.body).toEqual(asClubDto(expected, true));
    expect(await clubRow(club.id)).toEqual(expected);
  });

  it("lets a manager and an admin update it, but nobody else, including on a club with no owner", async () => {
    const { club, manager, admin, stranger } = await clubWithStaff();
    const ownerlessClub = await createClub();

    expect((await manager.agent.put(`/api/clubs/${club.id}`).send({ address: "By manager" })).status).toBe(200);
    expect((await admin.agent.put(`/api/clubs/${club.id}`).send({ description: "<p>Edited by admin</p>" })).body.description).toBe(
      "<p>Edited by admin</p>",
    );
    for (const target of [club, ownerlessClub]) {
      const before = await clubRow(target.id);
      const response = await stranger.agent.put(`/api/clubs/${target.id}`).send({ name: "Hijacked" });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "You don't have permission to manage this club", code: "FORBIDDEN" });
      expect(await clubRow(target.id)).toEqual(before);
    }
  });

  it("answers 404 for an unknown club", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/clubs/${UNKNOWN_ID}`).send({ name: "Ghost" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found", code: "NOT_FOUND" });
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

  it("does not let the owner hand the club to someone else or orphan it (SEC-07)", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id });
    const someoneElse = await createUser();

    await agent.put(`/api/clubs/${club.id}`).send({ ownerId: someoneElse.id });
    expect((await clubRow(club.id)).ownerId).toBe(user.id);

    await agent.put(`/api/clubs/${club.id}`).send({ ownerId: null });
    expect((await clubRow(club.id)).ownerId).toBe(user.id);
  });

  it("accepts an unchanged legacy slug as stored, but checks a changed one", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id, slug: "Legacy_Slug" });
    await createClub({ slug: "taken" });

    const unchanged = await agent.put(`/api/clubs/${club.id}`).send({ slug: "Legacy_Slug", name: "Kept" });
    const invalid = await agent.put(`/api/clubs/${club.id}`).send({ slug: "Still_Bad" });
    const taken = await agent.put(`/api/clubs/${club.id}`).send({ slug: "Taken" });

    expect(unchanged.status).toBe(200);
    expect(unchanged.body.slug).toBe("Legacy_Slug");
    expect(invalid.status).toBe(400);
    expect(invalid.body.details).toEqual([expect.objectContaining({ path: ["slug"] })]);
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("SLUG_TAKEN");
    expect((await clubRow(club.id)).slug).toBe("Legacy_Slug");
  });

  it("stores the AP label, blank meaning the default", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id });

    expect((await agent.put(`/api/clubs/${club.id}`).send({ rakeLabel: " AP " })).body.rakeLabel).toBe("AP");
    expect((await clubRow(club.id)).rakeLabel).toBe("AP");
    expect((await agent.put(`/api/clubs/${club.id}`).send({ rakeLabel: "" })).body.rakeLabel).toBeNull();
    expect((await agent.put(`/api/clubs/${club.id}`).send({ rakeLabel: "x".repeat(17) })).status).toBe(400);
  });

  it("accepts an unchanged legacy image URL, but a new one must come from our storage", async () => {
    const { agent, user } = await signIn();
    const legacy = "https://legacy-bucket.r2.cloudflarestorage.com/clubs/old logo.png";
    const club = await createClub({ ownerId: user.id, imageUrl: legacy });

    expect((await agent.put(`/api/clubs/${club.id}`).send({ imageUrl: legacy, name: "Same image" })).status).toBe(200);
    expect((await agent.put(`/api/clubs/${club.id}`).send({ imageUrl: "https://elsewhere.test/x.png" })).status).toBe(400);
    expect((await agent.put(`/api/clubs/${club.id}`).send({ imageUrl: null })).body.imageUrl).toBeNull();
  });
});

describe("DELETE /api/clubs/:id", () => {
  it("requires a signed-in, active user", async () => {
    const { club, deactivated } = await clubWithStaff();

    const response = await (await anon()).delete(`/api/clubs/${club.id}`);
    const fromDeactivated = await deactivated.agent.delete(`/api/clubs/${club.id}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
    expect(fromDeactivated.status).toBe(401);
    expect(await clubRow(club.id)).toEqual(club);
  });

  it("refuses a stranger and a manager: only the owner or an admin deletes a club", async () => {
    const { club, manager, stranger } = await clubWithStaff();

    for (const who of [stranger, manager]) {
      const response = await who.agent.delete(`/api/clubs/${club.id}`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Only the club's owner or an admin can do that", code: "FORBIDDEN" });
    }
    expect(await clubRow(club.id)).toEqual(club);
  });

  it("lets the owner delete the club, which also deletes its seasons, tournaments and registrations but not players, and audits it", async () => {
    const { agent, user } = await signIn();
    const logo = "/uploads/club_logo/0b5a6a3c-7d25-4c4e-9f43-0e1f6d3b2a11/256.webp";
    const banner = "/uploads/tournament_banner/5f0e9c3d-6a1b-4c2d-8e7f-1a2b3c4d5e6f/1600.webp";
    const club = await createClub({ ownerId: user.id, imageUrl: logo });
    const season = await createSeason({ clubId: club.id });
    const tournament = await createTournament({ clubId: club.id, seasonId: season.id, imageUrl: banner });
    const player = await createPlayer();
    await createRegistration({ tournamentId: tournament.id, playerId: player.id });
    const otherClub = await createClub();
    const otherTournament = await createTournament({ clubId: otherClub.id });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await agent.delete(`/api/clubs/${club.id}`);

    // The logo and the banners stay in storage, logged as orphans for a later clean-up (P2-PRODDATA-03).
    expect(info).toHaveBeenCalledWith(
      `[images] orphaned, kept (club ${club.id} (with its tournaments) was deleted): ${[64, 128, 256].map((w) => logo.replace("256", String(w))).join(" ")} ${banner.replace("1600", "800")} ${banner}`,
    );
    info.mockRestore();

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    const db = testDb();
    expect(await clubRow(club.id)).toBeUndefined();
    expect(await db.select().from(seasons).where(eq(seasons.clubId, club.id))).toEqual([]);
    expect((await db.select().from(tournaments)).map((row) => row.id)).toEqual([otherTournament.id]);
    expect(await db.select().from(tournamentRegistrations)).toEqual([]);
    expect(await db.select().from(players).where(eq(players.id, player.id))).toEqual([player]);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "club.delete"), eq(auditLog.targetId, club.id)))).toEqual([
      expect.objectContaining({
        actorUserId: user.id,
        targetType: "club",
        data: { name: club.name, slug: club.slug, imageUrl: logo, tournamentImageUrls: [banner] },
      }),
    ]);
  });

  it("lets an admin delete a club they do not own", async () => {
    const { club, admin } = await clubWithStaff();

    const response = await admin.agent.delete(`/api/clubs/${club.id}`);

    expect(response.status).toBe(204);
    expect(await clubRow(club.id)).toBeUndefined();
  });

  it("answers 404 for an unknown club", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.delete(`/api/clubs/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Club not found", code: "NOT_FOUND" });
  });
});

describe("member counts", () => {
  async function clubsWithMembers() {
    const club = await createClub();
    const otherClub = await createClub();
    const quiet = await createClub();
    const [first, second] = [await createTournament({ clubId: club.id }), await createTournament({ clubId: club.id })];
    const elsewhere = await createTournament({ clubId: otherClub.id });
    await createTournament({ clubId: quiet.id });
    const [alice, bob, carol, dave] = [await createPlayer(), await createPlayer(), await createPlayer(), await createPlayer()];
    await createRegistration({ tournamentId: first.id, playerId: alice.id, paymentConfirmed: true });
    await createRegistration({ tournamentId: first.id, playerId: bob.id, paymentConfirmed: true });
    await createRegistration({ tournamentId: second.id, playerId: bob.id, paymentConfirmed: true });
    await createRegistration({ tournamentId: second.id, playerId: carol.id, paymentConfirmed: false });
    await createRegistration({ tournamentId: elsewhere.id, playerId: dave.id, paymentConfirmed: true });
    await createRegistration({ tournamentId: elsewhere.id, playerId: alice.id, paymentConfirmed: true });
    return { club, otherClub, quiet };
  }

  it("GET /api/clubs/:id/members-count counts distinct players registered in any of the club's tournaments, paid or not", async () => {
    const { club } = await clubsWithMembers();

    const response = await (await anon()).get(`/api/clubs/${club.id}/members-count`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 3 });
  });

  it("GET /api/clubs/:id/members-count answers zero for a club with no registrations and for an unknown club", async () => {
    const { quiet } = await clubsWithMembers();

    for (const id of [quiet.id, UNKNOWN_ID]) {
      const response = await (await anon()).get(`/api/clubs/${id}/members-count`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0 });
    }
  });

  it("GET /api/clubs/member-counts gives the same count for every club in one call", async () => {
    const { club, otherClub, quiet } = await clubsWithMembers();

    const response = await (await anon()).get("/api/clubs/member-counts");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ [club.id]: 3, [otherClub.id]: 2, [quiet.id]: 0 });
  });

  it("counts a player the club added who has not registered yet, as its Players list and dashboard do: one rule (P2REV4-CQ2-12)", async () => {
    const owner = await createUser();
    const club = await createClub({ ownerId: owner.id });
    const { agent } = await loginAs({ email: owner.email });
    const added = await agent.post("/api/players").send({ name: "New Nora", phone: "021 555 0199", clubId: club.id });
    expect(added.status).toBe(201);

    const list = await agent.get(`/api/players?clubId=${club.id}`);
    const one = await (await anon()).get(`/api/clubs/${club.id}/members-count`);
    const all = await (await anon()).get("/api/clubs/member-counts");
    const dashboard = await agent.get("/api/dashboard/stats");

    expect(list.body.map((player: { name: string }) => player.name)).toEqual(["New Nora"]);
    expect(one.body).toEqual({ count: 1 });
    expect(all.body).toEqual({ [club.id]: 1 });
    expect(dashboard.body.totalPlayers).toBe(1);
  });
});
