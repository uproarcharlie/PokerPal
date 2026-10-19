/**
 * The player API: the staff list (GET /api/players is no longer public: SEC-09, security-13), sign-up
 * from the QR page (public, narrow DTO, phone de-duplication that never reveals who owns a number:
 * SEC-04, SEC-09, perf-24) and staff edits (SEC-04, img-04, img-24).
 */
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import { auditLog, playerHomeClubs, players, tournamentRegistrations } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament, createUser } from "../factories";
import { anon, asJson, getApp, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { signUpTokenFor } from "../helpers/sign-up";
import { CLUB_ROLES, signInClubRole, signInDeactivatedManager, STAFF_ROLES } from "../helpers/club-staff";

beforeEach(resetDb);

const playerRow = async (id: string) => (await testDb().select().from(players).where(eq(players.id, id)))[0];
const allPlayers = () => testDb().select().from(players);

/** A player as staff see them: no linked account id. */
const staffView = (player: typeof players.$inferSelect) => {
  const { userId: _userId, ...rest } = asJson(player) as Record<string, unknown>;
  return rest;
};

/** A player on a staff list: contact details only when the viewer may edit them (ClubPlayer). */
const clubView = (player: typeof players.$inferSelect, canEdit: boolean) => ({
  ...staffView(canEdit ? player : { ...player, email: null, phone: null }),
  canEdit,
});

/** A club whose tournament `player` registered for. */
async function clubOf(...registered: Array<{ id: string }>) {
  const club = await createClub();
  const tournament = await createTournament({ clubId: club.id });
  for (const player of registered) await createRegistration({ tournamentId: tournament.id, playerId: player.id });
  return club;
}

describe("GET /api/players", () => {
  it("refuses anonymous visitors, who used to get every player's email and phone (SEC-09)", async () => {
    await createPlayer({ email: "alice@example.test", phone: "021 555 0101" });

    const response = await (await anon()).get("/api/players");

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain("alice@example.test");
  });

  it("gives an admin every player, oldest first, with contact details but never the linked account", async () => {
    const linked = await createUser();
    const alice = await createPlayer({ name: "Alice", phone: "021 555 0101", userId: linked.id, createdAt: new Date("2026-01-01T00:00:00Z") });
    const bob = await createPlayer({ name: "Bob", email: null, createdAt: new Date("2026-02-01T00:00:00Z") });
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.get("/api/players");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([clubView(alice, true), clubView(bob, true)]);
    expect(JSON.stringify(response.body)).not.toContain(linked.id);
  });

  it.each(["owner", "manager"] as const)("gives a club %s only the players who have played at their club", async (role) => {
    const regular = await createPlayer({ name: "Regular" });
    const elsewhere = await createPlayer({ name: "Elsewhere" });
    const club = await clubOf(regular);
    await clubOf(elsewhere);
    await createPlayer({ name: "Never Played" });
    const { agent } = await signInClubRole(role, club.id);

    const response = await agent.get("/api/players");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([clubView(regular, true)]);
  });

  it("lists a visitor from another club without their contact details or edit rights: only the home club has them", async () => {
    const regular = await createPlayer({ name: "Regular", phone: "021 555 0101", email: "regular@example.test" });
    const home = await clubOf(regular);
    const visited = await clubOf(regular);
    const atHome = await signInClubRole("owner", home.id);
    const visiting = await signInClubRole("owner", visited.id);

    expect((await atHome.agent.get("/api/players")).body).toEqual([clubView(regular, true)]);
    expect((await visiting.agent.get("/api/players")).body).toEqual([clubView(regular, false)]);
  });

  it("gives a signed-in user with no club an empty list", async () => {
    await clubOf(await createPlayer());
    const { agent } = await signIn();

    const response = await agent.get("/api/players");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("filters by name (case-insensitive, % and _ matched literally) and by one of the viewer's clubs", async () => {
    const alice = await createPlayer({ name: "Alice Smith" });
    const percent = await createPlayer({ name: "100% Al" });
    const alfred = await createPlayer({ name: "Alfred" });
    const club = await clubOf(alice, percent);
    const otherClub = await clubOf(alfred);
    const { agent } = await signIn({ role: "admin" });

    const byName = await agent.get("/api/players").query({ q: "SMITH" });
    const literal = await agent.get("/api/players").query({ q: "0%" });
    const byClub = await agent.get("/api/players").query({ q: "al", clubId: otherClub.id });
    const manager = await signInClubRole("manager", club.id);
    const outsideScope = await manager.agent.get("/api/players").query({ clubId: otherClub.id });

    expect(byName.body.map((p: { name: string }) => p.name)).toEqual(["Alice Smith"]);
    expect(literal.body.map((p: { name: string }) => p.name)).toEqual(["100% Al"]);
    expect(byClub.body.map((p: { name: string }) => p.name)).toEqual(["Alfred"]);
    expect(outsideScope.body).toEqual([]);
  });

  it("refuses a deactivated account's open session", async () => {
    const club = await createClub();
    const { agent } = await signInDeactivatedManager(club.id);

    expect((await agent.get("/api/players")).status).toBe(401);
  });
});

describe("POST /api/players", () => {
  it("lets an anonymous visitor sign up, answering with the public fields only", async () => {
    const response = await (await anon()).post("/api/players").send({
      id: "client-chosen-id",
      createdAt: "2000-01-01T00:00:00.000Z",
      name: "  Walk-in Wendy ",
      phone: "021 555 0199",
      email: "Wendy@Example.test",
      imageUrl: "/uploads/players/w.webp",
      unknownField: "dropped",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Walk-in Wendy",
      imageUrl: "/uploads/players/w.webp",
      signUpToken: expect.stringMatching(/^\d+\.[A-Za-z0-9_-]+$/),
    });
    expect(findForbiddenKeys(response.body)).toEqual([]);
    expect(response.body.id).not.toBe("client-chosen-id");
    expect(await playerRow(response.body.id)).toMatchObject({
      name: "Walk-in Wendy",
      phone: "021 555 0199",
      email: "wendy@example.test",
      userId: null,
    });
  });

  it("never lets a sign-up link the player to a user account (SEC-04)", async () => {
    const account = await createUser();

    const response = await (await anon()).post("/api/players").send({ name: "Impostor", phone: "021 555 0100", userId: account.id });

    expect(response.status).toBe(201);
    expect(await testDb().select().from(players).where(eq(players.userId, account.id))).toEqual([]);
  });

  it("needs a phone number from an anonymous visitor", async () => {
    for (const phone of [undefined, "", "n/a"]) {
      const response = await (await anon()).post("/api/players").send({ name: "No Number", phone });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "Invalid player data", code: "VALIDATION", details: [{ path: ["phone"] }] });
    }
    expect(await allPlayers()).toEqual([]);
  });

  it("lets signed-in staff create a player with only a name, answering with the staff fields", async () => {
    const { agent } = await signIn();

    const response = await agent.post("/api/players").send({ name: "Name Only" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Name Only",
      email: null,
      phone: null,
      imageUrl: null,
      createdAt: expect.any(String),
      signUpToken: expect.any(String),
    });
  });

  it("rejects a body without a name, with a non-string phone or with a link that is not an uploaded image", async () => {
    for (const [body, field] of [
      [{ phone: "021 555 0100" }, "name"],
      [{ name: "Numeric", phone: 215550100 }, "phone"],
      [{ name: "Script", phone: "021 555 0100", imageUrl: "javascript:alert(1)" }, "imageUrl"],
      [{ name: "Hotlink", phone: "021 555 0100", imageUrl: "https://tracker.example/pixel.png" }, "imageUrl"],
    ] as const) {
      const response = await (await anon()).post("/api/players").send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid player data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await allPlayers()).toEqual([]);
  });

  it("returns the stored player (200, existing: true) when the phone and name match, however they are typed", async () => {
    const alice = await createPlayer({ name: "Alice O'Neil", phone: "021 555 0101", email: "alice@example.test" });

    const response = await (await anon()).post("/api/players").send({ name: " alice  o'neil", phone: "(021) 555-0101" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: alice.id, name: "Alice O'Neil", imageUrl: null, existing: true, signUpToken: expect.any(String) });
    expect(await allPlayers()).toEqual([alice]);
  });

  it("refuses a phone registered under another name with 409 PHONE_TAKEN, naming nobody (SEC-09)", async () => {
    const existing = await createPlayer({ name: "Alice Example", email: "alice@example.test", phone: "021 555 0101" });

    const response = await (await anon()).post("/api/players").send({ name: "Probe", phone: "0215550101" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: expect.stringContaining("already registered"), code: "PHONE_TAKEN" });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(existing.name);
    expect(body).not.toContain("alice@example.test");
    expect(await allPlayers()).toEqual([existing]);
  });

  it("names the player who has the number only to staff who may manage them", async () => {
    const existing = await createPlayer({ name: "Alice Example", phone: "021 555 0101" });
    const club = await clubOf(existing);
    const manager = await signInClubRole("manager", club.id);
    const stranger = await signIn();

    const toManager = await manager.agent.post("/api/players").send({ name: "Typo", phone: "021 555 0101" });
    const toStranger = await stranger.agent.post("/api/players").send({ name: "Typo", phone: "021 555 0101" });

    expect(toManager.status).toBe(409);
    expect(toManager.body.details).toEqual({ player: { id: existing.id, name: "Alice Example", imageUrl: null } });
    expect(toStranger.status).toBe(409);
    expect(toStranger.body.details).toBeUndefined();
  });

  it("treats a number with a leading + as a different number", async () => {
    await createPlayer({ name: "Local", phone: "64215550101" });

    const response = await (await anon()).post("/api/players").send({ name: "Intl", phone: "+64 21 555 0101" });

    expect(response.status).toBe(201);
    expect(await allPlayers()).toHaveLength(2);
  });

  it("creates one player when the same new number signs up twice at once", async () => {
    const app = await anon();

    const responses = await Promise.all(
      [1, 2, 3].map(() => app.post("/api/players").send({ name: "Double Tap", phone: "021 555 0123" })),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await allPlayers()).toHaveLength(1);
  });

  it("allows any number of players with the same email", async () => {
    await createPlayer({ email: "shared@example.test", phone: null });

    for (const [name, phone] of [["Twin One", "021 000 0001"], ["Twin Two", "021 000 0002"]]) {
      const response = await (await anon()).post("/api/players").send({ name, phone, email: "shared@example.test" });
      expect(response.status).toBe(201);
    }
    expect(await testDb().select().from(players).where(eq(players.email, "shared@example.test"))).toHaveLength(3);
  });
});

describe("PUT /api/players/:id", () => {
  /** A player who has played at a club, and that club. */
  async function regular(overrides: Partial<typeof players.$inferInsert> = {}) {
    const player = await createPlayer({ name: "Old Name", phone: "021 555 0101", imageUrl: "/uploads/players/old.webp", ...overrides });
    const club = await clubOf(player);
    return { player, club };
  }

  it("refuses anonymous visitors (SEC-04) and a deactivated account, and leaves the player alone", async () => {
    const { player, club } = await regular();
    const deactivated = await signInDeactivatedManager(club.id);

    const anonymous = await (await anon()).put(`/api/players/${player.id}`).send({ name: "Renamed by a stranger" });
    const disabled = await deactivated.agent.put(`/api/players/${player.id}`).send({ name: "Renamed" });

    expect([anonymous.status, disabled.status]).toEqual([401, 401]);
    expect(await playerRow(player.id)).toEqual(player);
  });

  it.each(CLUB_ROLES)("as the club's %s", async (role) => {
    const { player, club } = await regular();
    const { agent } = await signInClubRole(role, club.id);

    const response = await agent.put(`/api/players/${player.id}`).send({ name: "New Name" });

    if (STAFF_ROLES.includes(role)) {
      expect(response.status).toBe(200);
      expect(response.body).toEqual(staffView({ ...player, name: "New Name" }));
    } else {
      expect(response.status).toBe(403);
      expect(await playerRow(player.id)).toEqual(player);
    }
  });

  it("lets only an admin edit a player who has never registered anywhere", async () => {
    const loner = await createPlayer();
    const owner = await signInClubRole("owner", (await createClub()).id);
    const admin = await signIn({ role: "admin" });

    expect((await owner.agent.put(`/api/players/${loner.id}`).send({ name: "X" })).status).toBe(403);
    expect((await admin.agent.put(`/api/players/${loner.id}`).send({ name: "X" })).status).toBe(200);
  });

  it("updates the fields sent, clears a removed photo (img-04) and never links an account", async () => {
    const account = await createUser();
    const { player, club } = await regular({ email: "old@example.test" });
    const { agent } = await signInClubRole("manager", club.id);

    const response = await agent.put(`/api/players/${player.id}`).send({ imageUrl: null, email: " ", userId: account.id });

    expect(response.status).toBe(200);
    const expected = { ...player, imageUrl: null, email: null };
    expect(response.body).toEqual(staffView(expected));
    expect(await playerRow(player.id)).toEqual(expected);
  });

  it("accepts only our own uploads as a new photo (img-24), but keeps an unchanged legacy one", async () => {
    const { player, club } = await regular({ imageUrl: "https://legacy-bucket.example/players/old.webp" });
    const { agent } = await signInClubRole("manager", club.id);

    const foreign = await agent.put(`/api/players/${player.id}`).send({ imageUrl: "https://tracker.example/pixel.png" });
    const unchanged = await agent.put(`/api/players/${player.id}`).send({ name: "Kept", imageUrl: player.imageUrl });
    const ours = await agent.put(`/api/players/${player.id}`).send({ imageUrl: "/uploads/players/new.webp" });

    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ error: "Invalid player data", details: [{ path: ["imageUrl"] }] });
    expect([unchanged.status, ours.status]).toEqual([200, 200]);
    expect((await playerRow(player.id)).imageUrl).toBe("/uploads/players/new.webp");
  });

  it("refuses a new phone number another player has (409 PHONE_TAKEN), but keeps an unchanged one", async () => {
    await createPlayer({ name: "Legacy Twin", phone: "021 555 0101" });
    await createPlayer({ name: "Other", phone: "021 555 0303" });
    const { player, club } = await regular({ phone: "021 555 0101" });
    const { agent } = await signInClubRole("owner", club.id);

    const unchanged = await agent.put(`/api/players/${player.id}`).send({ phone: "021-555-0101", name: "Renamed" });
    const clash = await agent.put(`/api/players/${player.id}`).send({ phone: "0215550303" });
    const free = await agent.put(`/api/players/${player.id}`).send({ phone: "021 555 0404" });

    expect(unchanged.status).toBe(200);
    expect(unchanged.body).toMatchObject({ phone: "021-555-0101", name: "Renamed" });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("PHONE_TAKEN");
    expect(free.status).toBe(200);
    expect((await playerRow(player.id)).phone).toBe("021 555 0404");
  });

  it("answers 404 for an unknown player", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/players/${UNKNOWN_ID}`).send({ name: "Ghost" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Player not found", code: "NOT_FOUND" });
  });

  it("rejects an invalid or empty body", async () => {
    const { player } = await regular();
    const { agent } = await signIn({ role: "admin" });

    for (const body of [{ name: 42 }, {}]) {
      const response = await agent.put(`/api/players/${player.id}`).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid player data");
    }
    expect(await playerRow(player.id)).toEqual(player);
  });
});

describe("a stranger who opens a club cannot take over other clubs' players (SEC-P2-01)", () => {
  it("can register a found player into their own tournament, but gets neither their contact details nor the right to edit them", async () => {
    // The victim's club: the club they first played at.
    const victim = await createPlayer({ name: "Victim Person", phone: "021 555 1234", email: "victim@example.test" });
    const victimClub = await clubOf(victim);
    const victimOwner = await signInClubRole("owner", victimClub.id);

    // Anyone can open an account, then a club, then a tournament.
    const stranger = request.agent(await getApp());
    const signUp = await stranger.post("/api/auth/register").send({ email: "stranger@example.test", password: "Sturdy-Pass2", name: "Stranger" });
    expect(signUp.status).toBe(201);
    const club = await stranger.post("/api/clubs").send({ name: "Stranger Club", slug: "stranger-club" });
    expect(club.status).toBe(201);
    const tournament = await stranger
      .post("/api/tournaments")
      .send({ clubId: club.body.id, name: "Bait", startDateTime: "2026-05-01T07:00:00.000Z", buyInAmount: 10, maxPlayers: 40 });
    expect(tournament.status).toBe(201);

    // Their staff search finds the victim (public fields only), and they can register them.
    const found = await stranger.get(`/api/public/tournaments/${tournament.body.id}/players`).query({ q: "Victim" });
    expect(found.body).toEqual([{ id: victim.id, name: "Victim Person", imageUrl: null }]);
    const registered = await stranger.post(`/api/tournaments/${tournament.body.id}/registrations`).send({ playerId: victim.id });
    expect(registered.status).toBe(201);

    // That registration grants nothing over the victim's record.
    const list = await stranger.get("/api/players").query({ clubId: club.body.id });
    expect(list.body).toEqual([clubView(victim, false)]);
    expect(JSON.stringify(list.body)).not.toContain("victim@example.test");
    expect(JSON.stringify(list.body)).not.toContain("555 1234");
    const desk = await stranger.get(`/api/tournaments/${tournament.body.id}/pending-registrations`);
    expect(desk.body[0].player).toEqual(clubView(victim, false));
    const edit = await stranger.put(`/api/players/${victim.id}`).send({ name: "Renamed By Attacker", phone: "000" });
    expect(edit.status).toBe(403);
    const lookup = await stranger.post("/api/players").send({ name: "Victim Person", phone: "021 555 1234" });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual({ id: victim.id, name: "Victim Person", imageUrl: null, existing: true, signUpToken: expect.any(String) });
    expect(await playerRow(victim.id)).toEqual(victim);

    // The victim's own club keeps both.
    expect((await victimOwner.agent.get("/api/players")).body).toEqual([clubView(victim, true)]);
    expect((await victimOwner.agent.put(`/api/players/${victim.id}`).send({ name: "Victim P." })).status).toBe(200);
  });

  it("gains nothing when a visitor who typed in another club's player's details signs them up into its tournament", async () => {
    const victim = await createPlayer({ name: "Victim", phone: "021 555 1234" });
    const victimClub = await clubOf(victim);
    const other = await createClub();
    const open = await createTournament({ clubId: other.id, status: "registration" });
    const otherOwner = await signInClubRole("owner", other.id);
    const victimOwner = await signInClubRole("owner", victimClub.id);

    // Only a visitor who knows the name and phone gets the sign-up token (POST /api/players matches them).
    const typedIn = await (await anon()).post("/api/players").send({ name: "Victim", phone: "021 555 1234" });
    expect(typedIn.status).toBe(200);
    const signUp = { playerId: victim.id, signUpToken: typedIn.body.signUpToken };
    expect((await (await anon()).post(`/api/tournaments/${open.id}/registrations`).send(signUp)).status).toBe(201);

    expect((await otherOwner.agent.put(`/api/players/${victim.id}`).send({ name: "X" })).status).toBe(403);
    expect((await otherOwner.agent.get("/api/players")).body).toEqual([clubView(victim, false)]);
    expect((await victimOwner.agent.put(`/api/players/${victim.id}`).send({ name: "Still ours" })).status).toBe(200);
  });

  it("cannot take a club's players by waiting for that club to delete their first tournament, or itself (P2REV0-01)", async () => {
    const victim = await createPlayer({ name: "Victim Person", phone: "021 999 1234", email: "victim@example.test" });
    const home = await createClub();
    const homeTournament = await createTournament({ clubId: home.id });
    await createRegistration({ tournamentId: homeTournament.id, playerId: victim.id });
    const homeOwner = await signInClubRole("owner", home.id);

    // A stranger's club registers the victim second: today it sees no contact details and cannot edit.
    const stranger = await createClub();
    await createRegistration({ tournamentId: (await createTournament({ clubId: stranger.id })).id, playerId: victim.id });
    const strangerOwner = await signInClubRole("owner", stranger.id);
    expect((await strangerOwner.agent.get("/api/players")).body).toEqual([clubView(victim, false)]);

    // The home club deletes its tournament, then the club: the victim does not move to the stranger.
    expect((await homeOwner.agent.delete(`/api/tournaments/${homeTournament.id}`)).status).toBe(200);
    expect((await strangerOwner.agent.get("/api/players")).body).toEqual([clubView(victim, false)]);
    expect((await strangerOwner.agent.put(`/api/players/${victim.id}`).send({ phone: "021 000 0000" })).status).toBe(403);
    expect((await homeOwner.agent.delete(`/api/clubs/${home.id}`)).status).toBe(204);
    expect((await strangerOwner.agent.get("/api/players")).body).toEqual([clubView(victim, false)]);
    expect((await strangerOwner.agent.put(`/api/players/${victim.id}`).send({ phone: "021 000 0000" })).status).toBe(403);
    expect(await playerRow(victim.id)).toEqual(victim);

    // With its home club gone, only an admin may edit the victim.
    const { agent: admin } = await signIn({ role: "admin" });
    expect((await admin.put(`/api/players/${victim.id}`).send({ name: "Victim P." })).status).toBe(200);
  });
});

const homeClubOf = async (playerId: string) =>
  (await testDb().select().from(playerHomeClubs).where(eq(playerHomeClubs.playerId, playerId)))[0]?.clubId ?? null;

describe("the club that adds a player is their home club, so nobody can claim them later (P2REV0-SEC-03)", () => {
  it("keeps a QR sign-up whose registration did not go through with that tournament's club, whoever registers them next", async () => {
    const home = await createClub();
    const full = await createTournament({ clubId: home.id, status: "registration", maxPlayers: 2 });
    for (let n = 0; n < 2; n++) await createRegistration({ tournamentId: full.id, playerId: (await createPlayer()).id });
    const homeOwner = await signInClubRole("owner", home.id);

    // The QR page adds the player, then the sign-up is refused: the tournament is full.
    const created = await (await anon()).post("/api/players").send({ name: "Late Comer", phone: "021 555 7777", tournamentId: full.id });
    expect(created.status).toBe(201);
    const refused = await (await anon())
      .post(`/api/tournaments/${full.id}/registrations`)
      .send({ playerId: created.body.id, signUpToken: created.body.signUpToken });
    expect(refused.body.code).toBe("TOURNAMENT_FULL");
    expect(await homeClubOf(created.body.id)).toBe(home.id);

    // Someone who knows the name and number opens a club and registers the player there.
    const stranger = await createClub();
    const bait = await createTournament({ clubId: stranger.id, status: "registration" });
    const strangerOwner = await signInClubRole("owner", stranger.id);
    const lookup = await strangerOwner.agent.post("/api/players").send({ name: "Late Comer", phone: "021 555 7777", clubId: stranger.id });
    expect(lookup.status).toBe(200);
    expect(lookup.body).not.toHaveProperty("phone");
    expect((await strangerOwner.agent.post(`/api/tournaments/${bait.id}/registrations`).send({ playerId: lookup.body.id })).status).toBe(201);

    // Their club still gets neither the contact details nor the edits; the club that added the player keeps both.
    expect(await homeClubOf(created.body.id)).toBe(home.id);
    expect((await strangerOwner.agent.get("/api/players")).body).toEqual([expect.objectContaining({ id: created.body.id, phone: null, canEdit: false })]);
    expect((await strangerOwner.agent.put(`/api/players/${created.body.id}`).send({ name: "Taken" })).status).toBe(403);
    expect((await homeOwner.agent.get("/api/players")).body).toContainEqual(expect.objectContaining({ id: created.body.id, phone: "021 555 7777", canEdit: true }));
    expect((await homeOwner.agent.put(`/api/players/${created.body.id}`).send({ name: "Late Comer Jr" })).status).toBe(200);
  });

  it("lets a returning QR sign-up find themselves at the club that added them, and register with the token again", async () => {
    const home = await createClub();
    const first = await createTournament({ clubId: home.id, status: "registration" });
    const created = await (await anon()).post("/api/players").send({ name: "Returner", phone: "021 555 8888", tournamentId: first.id });
    const next = await createTournament({ clubId: home.id, status: "registration" });

    const found = await (await anon()).get(`/api/public/tournaments/${next.id}/players`).query({ q: "Return" });
    const again = await (await anon()).post("/api/players").send({ name: "returner", phone: "0215558888", tournamentId: next.id });
    const signedUp = await (await anon())
      .post(`/api/tournaments/${next.id}/registrations`)
      .send({ playerId: created.body.id, signUpToken: again.body.signUpToken });

    expect(found.body).toEqual([{ id: created.body.id, name: "Returner", imageUrl: null }]);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: created.body.id, existing: true });
    expect(signedUp.status).toBe(201);
    // Found by the search, so even without the token the club's own page may sign them up.
    expect((await (await anon()).post(`/api/tournaments/${first.id}/registrations`).send({ playerId: created.body.id })).status).toBe(201);
  });

  it("makes the staff member's club the home club of a player they add, listed with contact details at once", async () => {
    const club = await createClub();
    const manager = await signInClubRole("manager", club.id);

    const response = await manager.agent.post("/api/players").send({ name: "Desk Add", phone: "021 555 9999", email: "desk@example.test", clubId: club.id });

    expect(response.status).toBe(201);
    expect(await homeClubOf(response.body.id)).toBe(club.id);
    expect((await manager.agent.get("/api/players")).body).toEqual([expect.objectContaining({ id: response.body.id, email: "desk@example.test", canEdit: true })]);
  });

  it("refuses a club the caller does not run (403), an unknown club or tournament (404), a club named anonymously (401), and a finished tournament (409)", async () => {
    const club = await createClub();
    const { agent } = await signIn();
    const body = { name: "Someone", phone: "021 555 0001" };

    expect((await agent.post("/api/players").send({ ...body, clubId: club.id })).status).toBe(403);
    expect((await agent.post("/api/players").send({ ...body, clubId: UNKNOWN_ID })).status).toBe(404);
    expect((await (await anon()).post("/api/players").send({ ...body, tournamentId: UNKNOWN_ID })).status).toBe(404);
    expect((await (await anon()).post("/api/players").send({ ...body, clubId: club.id })).status).toBe(401);
    const finished = await createTournament({ clubId: club.id, status: "completed" });
    expect((await (await anon()).post("/api/players").send({ ...body, tournamentId: finished.id })).body.code).toBe("TOURNAMENT_CLOSED");
    expect(await allPlayers()).toEqual([]);
  });
});

describe("legacy duplicates: a returning player is matched to the row with their history (P2REV3-PROD-01)", () => {
  it("answers the newer row that holds the registrations, not the older empty one, and the QR sign-up lands there", async () => {
    const club = await createClub();
    const orphan = await createPlayer({ name: "Twin Player", phone: "021 444 1111", createdAt: new Date("2025-10-12T19:25:55Z") });
    const real = await createPlayer({ name: "Twin Player", phone: "021 444 1111", createdAt: new Date("2025-10-12T19:27:35Z") });
    const done = await createTournament({ clubId: club.id, status: "completed" });
    await createRegistration({ tournamentId: done.id, playerId: real.id, pointsAwarded: 50 });
    const open = await createTournament({ clubId: club.id, status: "registration" });

    const matched = await (await anon()).post("/api/players").send({ name: "Twin Player", phone: "021 444 1111", tournamentId: open.id });
    const signedUp = await (await anon())
      .post(`/api/tournaments/${open.id}/registrations`)
      .send({ playerId: matched.body.id, signUpToken: matched.body.signUpToken });

    expect(matched.status).toBe(200);
    expect(matched.body.id).toBe(real.id);
    expect(signedUp.status).toBe(201);
    const rows = await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.playerId, orphan.id));
    expect(rows).toEqual([]);
  });

  it("prefers the duplicate who played at this club over one who played elsewhere more recently, and the oldest when none has played", async () => {
    const here = await createClub();
    const elsewhere = await createClub();
    const local = await createPlayer({ name: "Pat Smith", phone: "021 444 2222", createdAt: new Date("2025-01-01T00:00:00Z") });
    const visitor = await createPlayer({ name: "Pat Smith", phone: "021 444 2222", createdAt: new Date("2025-02-01T00:00:00Z") });
    await createRegistration({ tournamentId: (await createTournament({ clubId: here.id })).id, playerId: local.id, registrationTime: new Date("2026-01-01T00:00:00Z") });
    await createRegistration({ tournamentId: (await createTournament({ clubId: elsewhere.id })).id, playerId: visitor.id, registrationTime: new Date("2026-06-01T00:00:00Z") });
    const open = await createTournament({ clubId: here.id, status: "registration" });
    const oldest = await createPlayer({ name: "Lee Jones", phone: "021 444 3333", createdAt: new Date("2025-01-01T00:00:00Z") });
    await createPlayer({ name: "Lee Jones", phone: "021 444 3333", createdAt: new Date("2025-03-01T00:00:00Z") });

    const pat = await (await anon()).post("/api/players").send({ name: "Pat Smith", phone: "021 444 2222", tournamentId: open.id });
    const patAnywhere = await (await anon()).post("/api/players").send({ name: "Pat Smith", phone: "021 444 2222" });
    const lee = await (await anon()).post("/api/players").send({ name: "Lee Jones", phone: "021 444 3333", tournamentId: open.id });

    expect(pat.body.id).toBe(local.id);
    expect(patAnywhere.body.id).toBe(visitor.id);
    expect(lee.body.id).toBe(oldest.id);
  });
});

describe("a registration records the club of the player's first surviving registration (P2REV3-PROD-03)", () => {
  it("gives a player an older build registered (no home club row) their first club, not the club registering them now", async () => {
    const first = await createClub();
    const later = await createClub();
    const player = await createPlayer({ name: "Old Build" });
    // Written as the build before home clubs were stored did: a registration and no home-club row.
    await testDb().insert(tournamentRegistrations).values({
      tournamentId: (await createTournament({ clubId: first.id })).id,
      playerId: player.id,
      registrationTime: new Date("2026-01-01T00:00:00Z"),
    });
    const open = await createTournament({ clubId: later.id, status: "registration" });

    const response = await (await anon())
      .post(`/api/tournaments/${open.id}/registrations`)
      .send({ playerId: player.id, signUpToken: signUpTokenFor(player.id) });

    expect(response.status).toBe(201);
    expect(await homeClubOf(player.id)).toBe(first.id);
  });
});

describe("player edits are audited (P2REV0-01)", () => {
  it("records who changed a player's name, phone or email, with the before and after of what changed", async () => {
    const player = await createPlayer({ name: "Alice", phone: "021 555 0101", email: "alice@example.test" });
    const club = await clubOf(player);
    const { agent, user } = await signInClubRole("owner", club.id);

    expect((await agent.put(`/api/players/${player.id}`).send({ phone: "021 555 0199", name: "Alice" })).status).toBe(200);
    expect((await agent.put(`/api/players/${player.id}`).send({ name: "Alice" })).status).toBe(200);

    expect(await testDb().select().from(auditLog).where(eq(auditLog.action, "player.update"))).toEqual([
      expect.objectContaining({
        actorUserId: user.id,
        targetType: "player",
        targetId: player.id,
        data: { before: { phone: "021 555 0101" }, after: { phone: "021 555 0199" } },
      }),
    ]);
  });
});
