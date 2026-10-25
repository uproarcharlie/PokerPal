/**
 * Round 5, items 7 and 8: a player's picture may be one of the app's built-in avatars, and a club may
 * ask every new player who signs up from its QR page for a picture (clubs.require_signup_photo:
 * 400 PHOTO_REQUIRED without one, asked before the phone number is looked at, and again at registration
 * for a player added elsewhere). Avatars are accepted only as a player's picture, are never logged
 * as orphaned uploads, and the clubs' and tournaments' images still refuse them.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_IDS, avatarUrl } from "@shared/domain/avatars";
import { players } from "@shared/schema";
import { createClub, createPlayer, createRegistration, createTournament } from "../factories";
import { anon, resetDb, signIn, testDb } from "../helpers";
import { signInClubRole, STAFF_ROLES } from "../helpers/club-staff";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const UPLOAD = "/uploads/player_avatar/0b9e7c2a-5d1f-4c3e-9a8b-7f6e5d4c3b2a/256.webp";
const PHOTO_REQUIRED = {
  error: "Add a photo or pick an avatar to sign up",
  code: "PHOTO_REQUIRED",
  details: [{ code: "custom", path: ["imageUrl"], message: "Add a photo or pick an avatar to sign up" }],
};

const allPlayers = () => testDb().select().from(players);
const playerRow = async (id: string) => (await testDb().select().from(players).where(eq(players.id, id)))[0];

/** A club, its tournament open for sign-ups, and the QR page's sign-up body for a newcomer. */
async function signUpNight({ requireSignupPhoto }: { requireSignupPhoto: boolean }) {
  const club = await createClub({ requireSignupPhoto });
  const tournament = await createTournament({ clubId: club.id, status: "registration" });
  const newcomer = { name: "Nina Newcomer", phone: "021 555 0142", tournamentId: tournament.id };
  return { club, tournament, newcomer };
}

describe("built-in avatars as a player's picture", () => {
  it("lets a QR sign-up pick any of the sixteen avatars, stored as its path", async () => {
    const { tournament } = await signUpNight({ requireSignupPhoto: false });

    for (const [index, id] of Array.from(AVATAR_IDS.entries())) {
      const response = await (await anon())
        .post("/api/players")
        .send({ name: `Avatar ${id}`, phone: `021 600 ${String(index).padStart(4, "0")}`, imageUrl: avatarUrl(id), tournamentId: tournament.id });

      expect(response.status).toBe(201);
      expect(response.body.imageUrl).toBe(`/avatars/${id}.svg`);
      expect((await playerRow(response.body.id)).imageUrl).toBe(`/avatars/${id}.svg`);
    }
  });

  it("refuses paths that only look like an avatar", async () => {
    const { newcomer } = await signUpNight({ requireSignupPhoto: false });

    for (const imageUrl of ["/avatars/unicorn.svg", "/avatars/shark.png", "/avatars/Shark.svg", "/avatars/../uploads/x.svg", "https://evil.example/avatars/shark.svg"]) {
      const response = await (await anon()).post("/api/players").send({ ...newcomer, imageUrl });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION", details: [expect.objectContaining({ path: ["imageUrl"] })] });
    }
    expect(await allPlayers()).toEqual([]);
  });

  it("lets the player's staff switch between an avatar and a photo, logging only the photo as an orphan once replaced", async () => {
    const club = await createClub();
    const player = await createPlayer({ name: "Desk Dan", phone: "021 555 0150", imageUrl: UPLOAD });
    await createRegistration({ tournamentId: (await createTournament({ clubId: club.id })).id, playerId: player.id });
    const { agent } = await signInClubRole("manager", club.id);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const toAvatar = await agent.put(`/api/players/${player.id}`).send({ imageUrl: avatarUrl("cowboy") });
    expect(toAvatar.status).toBe(200);
    expect(toAvatar.body.imageUrl).toBe("/avatars/cowboy.svg");
    expect(info.mock.calls.map(([line]) => line)).toEqual([expect.stringContaining(`orphaned, kept (replaced on player ${player.id}): `)]);
    expect(info.mock.calls[0][0]).toContain(UPLOAD);
    info.mockClear();

    const toOtherAvatar = await agent.put(`/api/players/${player.id}`).send({ imageUrl: avatarUrl("rocket") });
    const removed = await agent.put(`/api/players/${player.id}`).send({ imageUrl: null });

    expect([toOtherAvatar.status, removed.status]).toEqual([200, 200]);
    expect((await playerRow(player.id)).imageUrl).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it("still refuses an avatar as a club's logo or a tournament's picture", async () => {
    const { agent, user } = await signIn();
    const club = await createClub({ ownerId: user.id });
    const tournament = await createTournament({ clubId: club.id });

    const logo = await agent.put(`/api/clubs/${club.id}`).send({ imageUrl: avatarUrl("spade") });
    const picture = await agent.put(`/api/tournaments/${tournament.id}`).send({ imageUrl: avatarUrl("spade") });

    for (const response of [logo, picture]) {
      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([expect.objectContaining({ path: ["imageUrl"] })]);
    }
  });
});

describe("a club that asks every new player for a picture (PHOTO_REQUIRED)", () => {
  it("refuses a new player's QR sign-up without one, and creates nobody", async () => {
    const { newcomer } = await signUpNight({ requireSignupPhoto: true });

    for (const imageUrl of [undefined, null, ""]) {
      const response = await (await anon()).post("/api/players").send({ ...newcomer, imageUrl });

      expect(response.status).toBe(400);
      expect(response.body).toEqual(PHOTO_REQUIRED);
    }
    expect(await allPlayers()).toEqual([]);
  });

  it("signs them up with a photo or an avatar", async () => {
    const { newcomer } = await signUpNight({ requireSignupPhoto: true });

    const withAvatar = await (await anon()).post("/api/players").send({ ...newcomer, imageUrl: avatarUrl("lucky-clover") });
    const withPhoto = await (await anon()).post("/api/players").send({ ...newcomer, name: "Paul Photo", phone: "021 555 0143", imageUrl: UPLOAD });

    expect([withAvatar.status, withPhoto.status]).toEqual([201, 201]);
    expect((await allPlayers()).map((player) => player.imageUrl).sort()).toEqual(["/avatars/lucky-clover.svg", UPLOAD].sort());
  });

  it("asks for one before looking at the number, so the answer never tells whether a number is stored (R5REV-SEC-02)", async () => {
    const { newcomer } = await signUpNight({ requireSignupPhoto: true });
    await createPlayer({ name: newcomer.name, phone: "021-555-0142", imageUrl: null });
    await createPlayer({ name: "Someone Else", phone: "021 555 0199" });

    const stored = await (await anon()).post("/api/players").send({ ...newcomer, name: "nina  NEWCOMER" });
    const taken = await (await anon()).post("/api/players").send({ ...newcomer, phone: "021 555 0199" });
    const free = await (await anon()).post("/api/players").send({ ...newcomer, phone: "021 555 0198" });

    for (const response of [stored, taken, free]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual(PHOTO_REQUIRED);
    }
    expect(await allPlayers()).toHaveLength(2);
  });

  it("matches a returning player who sends one, who keeps the picture they have, and says a number is taken", async () => {
    const { newcomer } = await signUpNight({ requireSignupPhoto: true });
    const returning = await createPlayer({ name: newcomer.name, phone: "021-555-0142", imageUrl: null });
    await createPlayer({ name: "Someone Else", phone: "021 555 0199" });

    const matched = await (await anon()).post("/api/players").send({ ...newcomer, name: "nina  NEWCOMER", imageUrl: avatarUrl("shark") });
    const taken = await (await anon()).post("/api/players").send({ ...newcomer, phone: "021 555 0199", imageUrl: avatarUrl("shark") });

    expect(matched.status).toBe(200);
    expect(matched.body).toMatchObject({ id: returning.id, existing: true, imageUrl: null });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("PHONE_TAKEN");
    expect(await allPlayers()).toHaveLength(2);
  });

  it.each(STAFF_ROLES)("does not hold the club's %s to it, signed in on the QR page", async (role) => {
    const { club, newcomer } = await signUpNight({ requireSignupPhoto: true });
    const { agent } = await signInClubRole(role, club.id);

    const response = await agent.post("/api/players").send(newcomer);

    expect(response.status).toBe(201);
    expect(response.body.imageUrl).toBeNull();
  });

  it("holds a signed-in visitor who is not the club's staff to it", async () => {
    const { newcomer } = await signUpNight({ requireSignupPhoto: true });
    const { agent } = await signIn();

    const response = await agent.post("/api/players").send(newcomer);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("PHOTO_REQUIRED");
  });

  it("asks nothing of a club that has not switched it on, nor of staff adding a player for their own club", async () => {
    const { newcomer } = await signUpNight({ requireSignupPhoto: false });
    const strict = await createClub({ requireSignupPhoto: true });
    const manager = await signInClubRole("manager", strict.id);

    const qr = await (await anon()).post("/api/players").send(newcomer);
    const desk = await manager.agent.post("/api/players").send({ name: "Desk Add", phone: "021 555 0144", clubId: strict.id });

    expect([qr.status, desk.status]).toEqual([201, 201]);
  });

  it("is the club's own setting: its staff switch it on and off, and every visitor can read it", async () => {
    const { club, tournament, newcomer } = await signUpNight({ requireSignupPhoto: false });
    const { agent } = await signInClubRole("manager", club.id);

    const on = await agent.put(`/api/clubs/${club.id}`).send({ requireSignupPhoto: true });
    expect(on.status).toBe(200);
    expect(on.body.requireSignupPhoto).toBe(true);
    expect((await (await anon()).get(`/api/clubs/${club.id}`)).body.requireSignupPhoto).toBe(true);
    expect((await (await anon()).post("/api/players").send(newcomer)).body.code).toBe("PHOTO_REQUIRED");

    const off = await agent.put(`/api/clubs/${club.id}`).send({ requireSignupPhoto: false });
    expect(off.body.requireSignupPhoto).toBe(false);
    const signedUp = await (await anon()).post("/api/players").send({ ...newcomer, tournamentId: tournament.id });
    expect(signedUp.status).toBe(201);
  });
});

describe("registering at a club that asks for a picture (R5REV-SEC-01)", () => {
  const register = async (tournamentId: string, body: Record<string, unknown>) => (await anon()).post(`/api/tournaments/${tournamentId}/registrations`).send(body);

  it("refuses a player without one who was added with no club, or at another club, whose rule never applied", async () => {
    const { tournament } = await signUpNight({ requireSignupPhoto: true });
    const elsewhere = await signUpNight({ requireSignupPhoto: false });

    const noClub = await (await anon()).post("/api/players").send({ name: "Sly Skipper", phone: "021 555 0150" });
    const otherClub = await (await anon()).post("/api/players").send({ name: "Visiting Vic", phone: "021 555 0151", tournamentId: elsewhere.tournament.id });
    expect([noClub.status, otherClub.status]).toEqual([201, 201]);

    for (const created of [noClub, otherClub]) {
      const response = await register(tournament.id, { playerId: created.body.id, signUpToken: created.body.signUpToken });
      expect(response.status).toBe(400);
      expect(response.body).toEqual(PHOTO_REQUIRED);
    }
  });

  it("registers a player added on its own QR page, a returning player of the club, and anyone with a picture", async () => {
    const { club, tournament, newcomer } = await signUpNight({ requireSignupPhoto: true });
    const added = await (await anon()).post("/api/players").send({ ...newcomer, imageUrl: avatarUrl("star") });
    const regular = await createPlayer({ name: "Regular Rita", imageUrl: null });
    await createRegistration({ tournamentId: (await createTournament({ clubId: club.id })).id, playerId: regular.id });
    const pictured = await (await anon()).post("/api/players").send({ name: "Pic Pete", phone: "021 555 0152", imageUrl: avatarUrl("ace") });

    const responses = [
      await register(tournament.id, { playerId: added.body.id, signUpToken: added.body.signUpToken }),
      await register(tournament.id, { playerId: regular.id }),
      await register(tournament.id, { playerId: pictured.body.id, signUpToken: pictured.body.signUpToken }),
    ];

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
  });

  it("holds nobody to it at a club that has not switched it on", async () => {
    const { tournament } = await signUpNight({ requireSignupPhoto: false });
    const created = await (await anon()).post("/api/players").send({ name: "No Pic Nick", phone: "021 555 0153" });

    expect((await register(tournament.id, { playerId: created.body.id, signUpToken: created.body.signUpToken })).status).toBe(201);
  });
});
