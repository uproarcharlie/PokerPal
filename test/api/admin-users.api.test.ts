/**
 * Characterization tests for user management under /api/admin as it behaves
 * today: the user list, admin edits, and impersonation.
 *
 * Known bugs from the audit are written as the behaviour we want, wrapped in
 * `it.fails` and tagged with the finding id. They pass while the bug is there;
 * once it is fixed they fail, and `.fails` must be removed.
 */
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { users, type User } from "@shared/schema";
import { createPlayer, createUser, FACTORY_PASSWORD, factoryPasswordHash, type NewUser } from "../factories";
import { getApp, loginAs, resetDb, signIn, testDb, type SignedIn } from "../helpers";

beforeEach(resetDb);

/** A factory user with the admin role, signed in (the session records the role at login). */
async function signedInAdmin(overrides: Partial<NewUser> = {}): Promise<SignedIn & { admin: User }> {
  const admin = await createUser({ role: "admin", ...overrides });
  return { admin, ...(await loginAs({ email: admin.email })) };
}

async function storedUser(id: string): Promise<User> {
  const [row] = await testDb().select().from(users).where(eq(users.id, id));
  return row;
}

describe("GET /api/admin/users", () => {
  it("requires a signed-in admin", async () => {
    const anonymous = await request(await getApp()).get("/api/admin/users");
    const { agent: member } = await signIn();

    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: "Authentication required" });
    const refused = await member.get("/api/admin/users");
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "Admin access required" });
  });

  it("lists every user and every player together, newest first, without password hashes", async () => {
    const { agent, admin } = await signedInAdmin({ name: "Ada Admin", createdAt: new Date("2026-01-01T00:00:00Z") });
    const member = await createUser({
      name: "Mo Member",
      phone: "021 000",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      lastLoginAt: new Date("2026-03-02T10:00:00Z"),
    });
    const player = await createPlayer({
      name: "Pat Player",
      email: "",
      phone: null,
      userId: member.id,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    const response = await agent.get("/api/admin/users");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: member.id,
        name: "Mo Member",
        email: member.email,
        phone: "021 000",
        role: "full_member",
        type: "user",
        isActive: true,
        lastLoginAt: "2026-03-02T10:00:00.000Z",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: player.id,
        name: "Pat Player",
        email: null,
        phone: null,
        role: "club_member",
        type: "player",
        isActive: true,
        lastLoginAt: null,
        createdAt: "2026-02-01T00:00:00.000Z",
        userId: member.id,
      },
      {
        id: admin.id,
        name: "Ada Admin",
        email: admin.email,
        phone: null,
        role: "admin",
        type: "user",
        isActive: true,
        lastLoginAt: expect.any(String),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("PUT /api/admin/users/:userId", () => {
  it("requires a signed-in admin", async () => {
    const target = await createUser();
    const { agent: member } = await signIn();

    const anonymous = await request(await getApp()).put(`/api/admin/users/${target.id}`).send({ role: "admin" });
    const refused = await member.put(`/api/admin/users/${target.id}`).send({ role: "admin" });

    expect(anonymous.status).toBe(401);
    expect(refused.status).toBe(403);
    expect((await storedUser(target.id)).role).toBe("full_member");
  });

  it("updates name, email, phone, role and status, trimming them and lowercasing the email", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ name: "Before" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send({
      name: "  After  ",
      email: " After.Address@Example.TEST ",
      phone: " 021 777 ",
      role: "admin",
      isActive: false,
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("User updated successfully");
    const expected = { id: target.id, name: "After", email: "after.address@example.test", phone: "021 777", role: "admin", isActive: false };
    expect(response.body.user).toMatchObject(expected);
    expect(await storedUser(target.id)).toMatchObject(expected);
  });

  it("leaves name, email, role and status alone when they are not sent", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ name: "Steady", email: "steady@example.test" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ role: "admin" });

    expect(response.status).toBe(200);
    expect(await storedUser(target.id)).toMatchObject({
      name: "Steady",
      email: "steady@example.test",
      role: "admin",
      isActive: true,
    });
  });

  it("ignores every other field, so it cannot set a password hash", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    const response = await agent
      .put(`/api/admin/users/${target.id}`)
      .send({ name: target.name, passwordHash: "$2b$04$attackerchosenhashattackerchosenhashattac", id: "new-id" });

    expect(response.status).toBe(200);
    expect(await storedUser(target.id)).toMatchObject({ id: target.id, passwordHash: factoryPasswordHash() });
    await expect(loginAs({ email: target.email })).resolves.toMatchObject({ user: { id: target.id } });
  });

  it("refuses a role other than admin or full_member", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ role: "superuser" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid role" });
    expect((await storedUser(target.id)).role).toBe("full_member");
  });

  it("refuses another user's email, ignoring case", async () => {
    const { agent } = await signedInAdmin();
    await createUser({ email: "occupied@example.test" });
    const target = await createUser({ name: "Unchanged" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ name: "Changed", email: "OCCUPIED@example.test" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Email is already in use" });
    expect((await storedUser(target.id)).name).toBe("Unchanged");
  });

  it("accepts the user's own email", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ email: "mine@example.test" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ email: "Mine@Example.test" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("mine@example.test");
  });

  it("answers 404 for an id that is not a user, including a player's id", async () => {
    const { agent } = await signedInAdmin();
    const player = await createPlayer();

    for (const id of ["no-such-user", player.id]) {
      const response = await agent.put(`/api/admin/users/${id}`).send({ name: "Ghost" });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "User not found" });
    }
  });

  it("stops a disabled user from signing in", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    await agent.put(`/api/admin/users/${target.id}`).send({ isActive: false });

    const login = await request(await getApp()).post("/api/auth/login").send({ email: target.email, password: FACTORY_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body).toEqual({ error: "Account is disabled" });
  });

  it("gives a promoted user admin access from their next login", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    await agent.put(`/api/admin/users/${target.id}`).send({ role: "admin" });

    const { agent: promoted } = await loginAs({ email: target.email });
    expect((await promoted.get("/api/admin/users")).status).toBe(200);
  });

  // Known bug SEC-14: the route returns storage.updateUser's row as-is, bcrypt hash included.
  it.fails("never returns the password hash (SEC-14)", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ name: "Renamed" });

    expect(response.status).toBe(200);
    expect(response.body.user).not.toHaveProperty("passwordHash");
  });

  // Known bug SEC-14: `phone?.trim() || null` wipes the phone number whenever the request leaves it out.
  it.fails("keeps the phone number when it is not sent (SEC-14)", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ phone: "021 555 0199" });

    await agent.put(`/api/admin/users/${target.id}`).send({ role: "admin" });

    expect((await storedUser(target.id)).phone).toBe("021 555 0199");
  });

  // Known bug SEC-14: an empty name is trimmed to "" and saved.
  it.fails("refuses an empty name (SEC-14)", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ name: "Has A Name" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ name: "   " });

    expect(response.status).toBe(400);
    expect((await storedUser(target.id)).name).toBe("Has A Name");
  });

  // Known bug SEC-14: an admin can demote or disable themselves, which can leave no admin at all.
  it.fails("refuses to let admins demote or disable themselves (SEC-14)", async () => {
    const { agent, admin } = await signedInAdmin();

    const demote = await agent.put(`/api/admin/users/${admin.id}`).send({ role: "full_member" });
    const disable = await agent.put(`/api/admin/users/${admin.id}`).send({ isActive: false });

    expect([demote.status, disable.status]).toEqual([400, 400]);
    expect(await storedUser(admin.id)).toMatchObject({ role: "admin", isActive: true });
  });

  // Known bug SEC-11: requireAdmin trusts the role cached in the session at login, for up to 7 days.
  it.fails("takes admin access away from a demoted admin's open session (SEC-11)", async () => {
    const { agent: demoted, admin } = await signedInAdmin();
    const { agent: other } = await signedInAdmin();

    expect((await other.put(`/api/admin/users/${admin.id}`).send({ role: "full_member" })).status).toBe(200);

    expect((await demoted.get("/api/admin/users")).status).toBe(403);
  });
});

describe("POST /api/admin/users/:userId/impersonate", () => {
  it("requires a signed-in admin", async () => {
    const target = await createUser();
    const { agent: member } = await signIn();

    expect((await request(await getApp()).post(`/api/admin/users/${target.id}/impersonate`)).status).toBe(401);
    const refused = await member.post(`/api/admin/users/${target.id}/impersonate`);
    expect(refused.status).toBe(403);
    expect((await member.get("/api/auth/me")).body.user.id).not.toBe(target.id);
  });

  it("switches the admin's session to the target user, role included", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ name: "Target" });

    const response = await agent.post(`/api/admin/users/${target.id}/impersonate`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Impersonation started");
    expect(response.body.user).toMatchObject({ id: target.id, name: "Target", role: "full_member" });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect((await agent.get("/api/auth/me")).body.user.id).toBe(target.id);
    expect((await agent.get("/api/admin/users")).status).toBe(403);
  });

  it("answers 404 for an unknown user and leaves the session alone", async () => {
    const { agent, admin } = await signedInAdmin();

    const response = await agent.post("/api/admin/users/no-such-user/impersonate");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "User not found" });
    expect((await agent.get("/api/auth/me")).body.user.id).toBe(admin.id);
  });

  // Known bug SEC-13: only the target's existence is checked, so a disabled account can be impersonated.
  it.fails("refuses to impersonate a disabled user (SEC-13)", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser({ isActive: false });

    const response = await agent.post(`/api/admin/users/${target.id}/impersonate`);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect((await agent.get("/api/auth/me")).body.user.id).toBe(admin.id);
  });
});

describe("POST /api/admin/stop-impersonation", () => {
  it("requires a signed-in user", async () => {
    const response = await request(await getApp()).post("/api/admin/stop-impersonation");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
  });

  it("refuses when the session is not impersonating anyone", async () => {
    const { agent } = await signedInAdmin();

    const response = await agent.post("/api/admin/stop-impersonation");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Not currently impersonating" });
  });

  it("restores the admin's own session and admin access", async () => {
    const { agent, admin } = await signedInAdmin({ name: "Original Admin" });
    const target = await createUser();
    await agent.post(`/api/admin/users/${target.id}/impersonate`);

    const response = await agent.post("/api/admin/stop-impersonation");

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Impersonation ended");
    expect(response.body.user).toMatchObject({ id: admin.id, name: "Original Admin", role: "admin" });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect((await agent.get("/api/auth/me")).body.user.id).toBe(admin.id);
    expect((await agent.get("/api/admin/users")).status).toBe(200);
    // Back to normal: there is nothing left to stop.
    expect((await agent.post("/api/admin/stop-impersonation")).status).toBe(400);
  });

  it("returns to the admin who started, even after impersonating through another admin", async () => {
    const { agent, admin } = await signedInAdmin();
    const otherAdmin = await createUser({ role: "admin" });
    const member = await createUser();

    await agent.post(`/api/admin/users/${otherAdmin.id}/impersonate`);
    const second = await agent.post(`/api/admin/users/${member.id}/impersonate`);
    expect(second.status).toBe(200);
    const stopped = await agent.post("/api/admin/stop-impersonation");

    expect(stopped.body.user.id).toBe(admin.id);
    expect((await agent.get("/api/auth/me")).body.user.id).toBe(admin.id);
  });

  // Known bug SEC-11: the admin role is restored from the session, not re-checked in the database.
  it.fails("does not restore admin access to an admin demoted while impersonating (SEC-11)", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser();
    await agent.post(`/api/admin/users/${target.id}/impersonate`);
    await testDb().update(users).set({ role: "full_member" }).where(eq(users.id, admin.id));

    await agent.post("/api/admin/stop-impersonation");

    expect([401, 403]).toContain((await agent.get("/api/admin/users")).status);
  });
});
