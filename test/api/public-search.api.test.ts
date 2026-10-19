/**
 * GET /api/public/tournaments/:id/players?q= : the QR register page's "find yourself" search, which
 * replaces the page's use of the whole GET /api/players list (SEC-09, security-13). Names and photos
 * only; scoped to the tournament's club unless the viewer manages that club.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import { createClub, createPlayer, createRegistration, createTournament, createUser } from "../factories";
import { anon, resetDb, signIn, UNKNOWN_ID } from "../helpers";
import { signInClubRole } from "../helpers/club-staff";

beforeEach(resetDb);

const search = (tournamentId: string) => `/api/public/tournaments/${tournamentId}/players`;
const names = (body: Array<{ name: string }>) => body.map((player) => player.name);

/** A club with two tournaments: the one being signed up for, and an earlier one. */
async function clubWithHistory() {
  const club = await createClub();
  const earlier = await createTournament({ clubId: club.id, status: "completed" });
  const tonight = await createTournament({ clubId: club.id, status: "registration" });
  return { club, earlier, tonight };
}

describe("GET /api/public/tournaments/:id/players", () => {
  it("finds an anonymous visitor's club-mates by part of their name, A to Z, with public fields only", async () => {
    const { earlier, tonight } = await clubWithHistory();
    const linked = await createUser();
    const zoe = await createPlayer({ name: "Zoe Alder", phone: "021 555 0101", email: "zoe@example.test", userId: linked.id });
    const al = await createPlayer({ name: "Al Bundy", imageUrl: "/uploads/players/al.webp" });
    const both = await createPlayer({ name: "Sally Alvarez" });
    await createRegistration({ tournamentId: earlier.id, playerId: zoe.id });
    await createRegistration({ tournamentId: tonight.id, playerId: al.id });
    await createRegistration({ tournamentId: earlier.id, playerId: both.id });
    await createRegistration({ tournamentId: tonight.id, playerId: both.id });
    await createPlayer({ name: "Unrelated Al" });

    const response = await (await anon()).get(search(tonight.id)).query({ q: "AL" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: al.id, name: "Al Bundy", imageUrl: "/uploads/players/al.webp" },
      { id: both.id, name: "Sally Alvarez", imageUrl: null },
      { id: zoe.id, name: "Zoe Alder", imageUrl: null },
    ]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("never shows a visitor players who have only played at other clubs", async () => {
    const { tonight } = await clubWithHistory();
    const elsewhere = await createTournament({ clubId: (await createClub()).id });
    await createRegistration({ tournamentId: elsewhere.id, playerId: (await createPlayer({ name: "Alice Away" })).id });
    const stranger = await signIn();

    expect((await (await anon()).get(search(tonight.id)).query({ q: "alice" })).body).toEqual([]);
    expect((await stranger.agent.get(search(tonight.id)).query({ q: "alice" })).body).toEqual([]);
  });

  it.each(["owner", "manager"] as const)(
    "lets the club's %s find players from other clubs, to register a visitor, but never one who has not played anywhere (SEC-P2-01)",
    async (role) => {
      const { club, tonight } = await clubWithHistory();
      const elsewhere = await createTournament({ clubId: (await createClub()).id });
      await createRegistration({ tournamentId: elsewhere.id, playerId: (await createPlayer({ name: "Alice Away" })).id });
      await createPlayer({ name: "Alice New" });
      const { agent } = await signInClubRole(role, club.id);

      const response = await agent.get(search(tonight.id)).query({ q: "alice" });

      expect(response.status).toBe(200);
      // A player with no registration has no home club yet: whoever registered them first would get their details.
      expect(names(response.body)).toEqual(["Alice Away"]);
      expect(findForbiddenKeys(response.body)).toEqual([]);
    },
  );

  it("lets an admin find every player", async () => {
    const { club, tonight } = await clubWithHistory();
    const elsewhere = await createTournament({ clubId: (await createClub()).id });
    await createRegistration({ tournamentId: elsewhere.id, playerId: (await createPlayer({ name: "Alice Away" })).id });
    await createPlayer({ name: "Alice New" });
    const { agent } = await signInClubRole("admin", club.id);

    expect(names((await agent.get(search(tonight.id)).query({ q: "alice" })).body)).toEqual(["Alice Away", "Alice New"]);
  });

  it("matches % and _ literally, and returns at most `limit` players (10 by default)", async () => {
    const { tonight } = await clubWithHistory();
    for (const name of ["100% Al", "1000 Al", "A_B", "AxB", ...Array.from({ length: 12 }, (_, i) => `Bulk ${String(i).padStart(2, "0")}`)]) {
      await createRegistration({ tournamentId: tonight.id, playerId: (await createPlayer({ name })).id });
    }
    const app = await anon();

    expect(names((await app.get(search(tonight.id)).query({ q: "0%" })).body)).toEqual(["100% Al"]);
    expect(names((await app.get(search(tonight.id)).query({ q: "a_b" })).body)).toEqual(["A_B"]);
    expect((await app.get(search(tonight.id)).query({ q: "bulk" })).body).toHaveLength(10);
    expect((await app.get(search(tonight.id)).query({ q: "bulk", limit: 25 })).body).toHaveLength(12);
  });

  it("answers 400 without a search term, or for a limit over 25", async () => {
    const { tonight } = await clubWithHistory();
    const app = await anon();

    for (const query of [{}, { q: "  " }, { q: "x".repeat(61) }, { q: "al", limit: 26 }, { q: "al", limit: 0 }]) {
      const response = await app.get(search(tonight.id)).query(query);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION");
    }
  });

  it("answers 404 for an unknown tournament", async () => {
    const response = await (await anon()).get(search(UNKNOWN_ID)).query({ q: "al" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });
});
