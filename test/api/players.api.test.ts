/**
 * Characterization of today's player API (server/routes.ts): the list, the
 * public create used by QR self-registration (with its duplicate-phone check),
 * and update.
 *
 * Reads and writes that are open to anyone today are exercised as an admin,
 * who keeps access once they are locked down. `it.fails` tests state the
 * correct behaviour for a known hole, tagged with its audit finding id; switch
 * them to `it` when the hole is fixed.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { players } from "@shared/schema";
import { createPlayer, createUser } from "../factories";
import { anon, asJson, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";

beforeEach(resetDb);

const playerRow = async (id: string) => (await testDb().select().from(players).where(eq(players.id, id)))[0];

describe("GET /api/players", () => {
  it("lists every player with every column", async () => {
    const linkedUser = await createUser();
    const alice = await createPlayer({ name: "Alice", phone: "021 555 0101", imageUrl: "/uploads/players/a.webp", userId: linkedUser.id });
    const bob = await createPlayer({ name: "Bob", email: null });
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.get("/api/players");

    expect(response.status).toBe(200);
    const listed = [...(response.body as Array<{ name: string }>)].sort((a, b) => a.name.localeCompare(b.name));
    expect(listed).toEqual([asJson(alice), asJson(bob)]);
  });

  it.fails("does not give anonymous visitors players' email addresses, phone numbers or linked accounts (SEC-09)", async () => {
    const linkedUser = await createUser();
    await createPlayer({ email: "alice@example.test", phone: "021 555 0101", userId: linkedUser.id });

    const response = await (await anon()).get("/api/players");

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("alice@example.test");
    expect(body).not.toContain("021 555 0101");
    expect(body).not.toContain(linkedUser.id);
  });
});

describe("POST /api/players", () => {
  it("lets anyone create a player, and ignores id and createdAt in the body", async () => {
    const response = await (await anon()).post("/api/players").send({
      id: "client-chosen-id",
      createdAt: "2000-01-01T00:00:00.000Z",
      name: "Walk-in Wendy",
      phone: "021 555 0199",
      email: "wendy@example.test",
      imageUrl: "/uploads/players/w.webp",
      unknownField: "dropped",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Walk-in Wendy",
      email: "wendy@example.test",
      phone: "021 555 0199",
      imageUrl: "/uploads/players/w.webp",
      userId: null,
      createdAt: expect.any(String),
    });
    expect(response.body.id).not.toBe("client-chosen-id");
    expect(asJson(await playerRow(response.body.id))).toEqual(response.body);
  });

  it("needs only a name", async () => {
    const response = await (await anon()).post("/api/players").send({ name: "Name Only" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: "Name Only", email: null, phone: null, imageUrl: null, userId: null });
  });

  it("rejects a body without a name or with a non-string phone", async () => {
    for (const [body, field] of [
      [{ phone: "021 555 0100" }, "name"],
      [{ name: "Numeric", phone: 215550100 }, "phone"],
    ] as const) {
      const response = await (await anon()).post("/api/players").send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid player data");
      expect(response.body.details).toEqual([expect.objectContaining({ path: [field] })]);
    }
    expect(await testDb().select().from(players)).toEqual([]);
  });

  it("refuses a phone number that is already registered, with 409", async () => {
    const existing = await createPlayer({ name: "Alice", phone: "021 555 0101" });

    const response = await (await anon()).post("/api/players").send({ name: "Alice Again", phone: "021 555 0101" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Phone number already registered");
    expect(await testDb().select().from(players)).toEqual([existing]);
  });

  it("compares phone numbers as exact strings, so differently formatted copies of a number are accepted", async () => {
    await createPlayer({ phone: "021 555 0101" });

    const response = await (await anon()).post("/api/players").send({ name: "Same Number", phone: "0215550101" });

    expect(response.status).toBe(201);
    expect(await testDb().select().from(players)).toHaveLength(2);
  });

  it("allows any number of players with the same email or with no phone", async () => {
    await createPlayer({ email: "shared@example.test", phone: null });

    for (const name of ["Twin One", "Twin Two"]) {
      const response = await (await anon()).post("/api/players").send({ name, email: "shared@example.test" });
      expect(response.status).toBe(201);
    }
    expect(await testDb().select().from(players).where(eq(players.email, "shared@example.test"))).toHaveLength(3);
  });

  it.fails("does not reveal who owns an already-registered phone number (SEC-09)", async () => {
    const existing = await createPlayer({ name: "Alice Example", email: "alice@example.test", phone: "021 555 0101" });

    const response = await (await anon()).post("/api/players").send({ name: "Probe", phone: "021 555 0101" });

    expect(response.status).toBe(409);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(existing.name);
    expect(body).not.toContain("alice@example.test");
  });

  it.fails("does not let an anonymous caller link the new player to a user account (SEC-04)", async () => {
    const account = await createUser();

    await (await anon()).post("/api/players").send({ name: "Impostor", userId: account.id });

    expect(await testDb().select().from(players).where(eq(players.userId, account.id))).toEqual([]);
  });
});

describe("PUT /api/players/:id", () => {
  it("updates the fields sent and leaves the rest alone", async () => {
    const player = await createPlayer({ name: "Old Name", phone: "021 555 0101", imageUrl: "/uploads/players/old.webp" });
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/players/${player.id}`).send({ name: "New Name", imageUrl: null });

    expect(response.status).toBe(200);
    const expected = { ...player, name: "New Name", imageUrl: null };
    expect(response.body).toEqual(asJson(expected));
    expect(await playerRow(player.id)).toEqual(expected);
  });

  it("does not check for duplicate phone numbers", async () => {
    await createPlayer({ phone: "021 555 0101" });
    const player = await createPlayer({ phone: "021 555 0202" });
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/players/${player.id}`).send({ phone: "021 555 0101" });

    expect(response.status).toBe(200);
    expect(response.body.phone).toBe("021 555 0101");
  });

  it("answers 404 for an unknown player", async () => {
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/players/${UNKNOWN_ID}`).send({ name: "Ghost" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Player not found" });
  });

  it("rejects an invalid body", async () => {
    const player = await createPlayer();
    const { agent } = await signIn({ role: "admin" });

    const response = await agent.put(`/api/players/${player.id}`).send({ name: 42 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid player data");
    expect(await playerRow(player.id)).toEqual(player);
  });

  it.fails("requires a signed-in user (SEC-04)", async () => {
    const player = await createPlayer({ name: "Alice", phone: "021 555 0101" });

    const response = await (await anon()).put(`/api/players/${player.id}`).send({ name: "Renamed by a stranger", phone: "000" });

    expect(response.status).toBe(401);
    expect(await playerRow(player.id)).toEqual(player);
  });
});
