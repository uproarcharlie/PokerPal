/**
 * A club's colours through the API (round 5, item 13; round5-contracts §3.5): who may set them, what
 * PUT /api/clubs/:id refuses (and stores nothing), what it stores, that every other save keeps them,
 * and that they reach the club's public screens (club page, TV, seat finder, season page) and no other
 * club's. The Colours tab and ClubThemeScope build on exactly these answers.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import { CENTRAL_STARS_THEME, type ClubTheme } from "@shared/domain/theme";
import { clubs } from "@shared/schema";
import { getPool } from "../../server/db";
import { seedCentralStarsTheme } from "../../server/db/seeds";
import { createClub, createSeason, createTournament } from "../factories";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const RED: ClubTheme = { v: 1, preset: null, colors: { primary: "#C0392B", accent: "#F1C40F" } };

const storedTheme = async (clubId: string) => (await testDb().select({ theme: clubs.theme }).from(clubs).where(eq(clubs.id, clubId)))[0].theme;

/** Every public screen of a club that wears its colours: the club itself, the TV, the seat finder and the season page. */
async function publicThemes(clubId: string) {
  const visitor = await anon();
  const tournament = await createTournament({ clubId, status: "in_progress" });
  const season = await createSeason({ clubId });
  return {
    club: (await visitor.get(`/api/clubs/${clubId}`)).body.theme,
    display: (await visitor.get(`/api/public/tournaments/${tournament.id}/display`)).body.club.theme,
    seating: (await visitor.get(`/api/public/tournaments/${tournament.id}/seating`)).body.club.theme,
    season: (await visitor.get(`/api/public/seasons/${season.id}/leaderboard`)).body.club.theme,
  };
}

describe("who may change a club's colours", () => {
  it("is its owner, its managers and admins", async () => {
    const { club, owner, manager, admin } = await clubWithStaff();

    for (const [who, theme] of [
      [owner, RED],
      [manager, CENTRAL_STARS_THEME],
      [admin, null],
    ] as const) {
      const response = await who.agent.put(`/api/clubs/${club.id}`).send({ theme });
      expect(response.status).toBe(200);
      expect(response.body.theme).toEqual(theme);
      expect(await storedTheme(club.id)).toEqual(theme);
    }
  });

  it("is nobody else: signed-out visitors, deactivated managers and strangers change nothing", async () => {
    const { club, stranger, deactivated } = await clubWithStaff();

    expect((await (await anon()).put(`/api/clubs/${club.id}`).send({ theme: RED })).status).toBe(401);
    expect((await deactivated.agent.put(`/api/clubs/${club.id}`).send({ theme: RED })).status).toBe(401);
    const refused = await stranger.agent.put(`/api/clubs/${club.id}`).send({ theme: RED });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("FORBIDDEN");
    expect(await storedTheme(club.id)).toBeNull();
  });
});

describe("PUT /api/clubs/:id { theme }", () => {
  it.each([
    ["a colour that is not #RRGGBB", { ...RED, colors: { ...RED.colors, primary: "red" } }, ["theme", "colors", "primary"], "Main colour: use a colour like #1E7BFF"],
    ["a missing accent", { v: 1, preset: null, colors: { primary: "#C0392B" } }, ["theme", "colors", "accent"], "Accent colour: use a colour like #1E7BFF"],
    ["an optional colour that does not read", { ...RED, colors: { ...RED.colors, primaryGlow: "#12" } }, ["theme", "colors", "primaryGlow"], "Glow: use a colour like #1E7BFF"],
    ["a colour it does not know", { ...RED, colors: { ...RED.colors, text: "#FFFFFF" } }, ["theme", "colors", "text"], "Unknown colour"],
    ["a setting it does not know (nothing unchecked is stored)", { ...RED, fonts: { display: "Impact" } }, ["theme", "fonts"], "Unknown theme setting"],
    ["another version", { ...RED, v: 2 }, ["theme", "v"], "Theme version must be 1"],
    ["a preset it does not know", { ...RED, preset: "neon" }, ["theme", "preset"], "Unknown preset"],
    ["no colours", { v: 1, preset: null }, ["theme", "colors"], "Choose the colours"],
  ])("refuses %s, saying where, and stores nothing", async (_, theme, path, message) => {
    const { club, owner } = await clubWithStaff();
    await testDb().update(clubs).set({ theme: CENTRAL_STARS_THEME }).where(eq(clubs.id, club.id));

    const response = await owner.agent.put(`/api/clubs/${club.id}`).send({ name: "Renamed", theme });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
    expect(response.body.details).toContainEqual(expect.objectContaining({ path, message }));
    const [row] = await testDb().select().from(clubs).where(eq(clubs.id, club.id));
    expect(row.theme).toEqual(CENTRAL_STARS_THEME);
    expect(row.name).toBe(club.name);
  });

  it("refuses a theme that is not an object", async () => {
    const { club, owner } = await clubWithStaff();
    for (const theme of ["#1E7BFF", ["#1E7BFF"], 1]) {
      const response = await owner.agent.put(`/api/clubs/${club.id}`).send({ theme });
      expect(response.status).toBe(400);
      expect(response.body.details).toContainEqual(expect.objectContaining({ path: ["theme"], message: "A theme is an object" }));
    }
  });

  it("stores the colours sent in upper case, inventing none of the optional ones", async () => {
    const { club, owner } = await clubWithStaff();

    const response = await owner.agent.put(`/api/clubs/${club.id}`).send({ theme: { v: 1, preset: null, colors: { primary: " #c0392b", accent: "#f1c40f" } } });

    expect(response.body.theme).toEqual(RED);
    expect(await storedTheme(club.id)).toEqual(RED);
    expect(Object.keys((await storedTheme(club.id))?.colors ?? {}).sort()).toEqual(["accent", "primary"]);
  });

  it("keeps the colours when any other setting is saved (the profile and social tabs send no theme)", async () => {
    const { club, owner } = await clubWithStaff();
    await owner.agent.put(`/api/clubs/${club.id}`).send({ theme: CENTRAL_STARS_THEME });

    const response = await owner.agent.put(`/api/clubs/${club.id}`).send({ name: "Central Stars Poker", websiteUrl: "https://centralstars.test" });

    expect(response.body.theme).toEqual(CENTRAL_STARS_THEME);
    expect(await storedTheme(club.id)).toEqual(CENTRAL_STARS_THEME);
  });
});

describe("a club's colours on its public screens", () => {
  it("reach the club page, the TV, the seat finder and the season page; null takes them all back to the LovePoker look", async () => {
    const { club, owner } = await clubWithStaff();
    await owner.agent.put(`/api/clubs/${club.id}`).send({ theme: CENTRAL_STARS_THEME });

    expect(await publicThemes(club.id)).toEqual({ club: CENTRAL_STARS_THEME, display: CENTRAL_STARS_THEME, seating: CENTRAL_STARS_THEME, season: CENTRAL_STARS_THEME });

    await owner.agent.put(`/api/clubs/${club.id}`).send({ theme: null });

    expect(await publicThemes(club.id)).toEqual({ club: null, display: null, seating: null, season: null });
  });

  it("are the club's alone: another club keeps the LovePoker look, and the club list carries each club's own", async () => {
    const { club, owner } = await clubWithStaff();
    const other = await createClub({ name: "Night Owls", slug: "night-owls" });
    await owner.agent.put(`/api/clubs/${club.id}`).send({ theme: CENTRAL_STARS_THEME });

    expect(await publicThemes(other.id)).toEqual({ club: null, display: null, seating: null, season: null });
    const listed = (await (await anon()).get("/api/clubs")).body as Array<{ id: string; theme: ClubTheme | null }>;
    expect(Object.fromEntries(listed.map((entry) => [entry.id, entry.theme]))).toEqual({ [club.id]: CENTRAL_STARS_THEME, [other.id]: null });
    expect(findForbiddenKeys(listed)).toEqual([]);
  });

  it("read as none on the TV, the seat finder and the season page when what is stored does not read", async () => {
    const { club } = await clubWithStaff();
    await testDb()
      .update(clubs)
      .set({ theme: { v: 1, preset: null, colors: { primary: "url(javascript:alert(1))", accent: "#F1C40F" } } as unknown as ClubTheme })
      .where(eq(clubs.id, club.id));

    const { display, seating, season } = await publicThemes(club.id);

    expect({ display, seating, season }).toEqual({ display: null, seating: null, season: null });
  });

  it("stay cleared after the next boot when the Central Stars owner clears them", async () => {
    const { club, owner } = await clubWithStaff({ name: "Central Stars", slug: "central-stars" });
    expect((await seedCentralStarsTheme(getPool())).applied).toBe(true);
    expect(await storedTheme(club.id)).toEqual(CENTRAL_STARS_THEME);

    await owner.agent.put(`/api/clubs/${club.id}`).send({ theme: null });
    await seedCentralStarsTheme(getPool());

    expect(await storedTheme(club.id)).toBeNull();
    expect((await publicThemes(club.id)).display).toBeNull();
  });
});
