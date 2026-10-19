/**
 * User management under /api/admin: the user list, admin edits, impersonation and the audit log.
 * Admin access is the database's role, read on every request (SEC-11); edits never echo the password
 * hash or wipe fields that were not sent (SEC-14); impersonation is audited, cannot target admins or
 * disabled accounts, and always offers the way back (SEC-13).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog, users, type AuditLogEntry, type User } from "@shared/schema";
import { createPlayer, createUser, FACTORY_PASSWORD, factoryPasswordHash, type NewUser } from "../factories";
import { SESSION_TABLE } from "../../server/config/auth";
import { getApp, loginAs, resetDb, signIn, testDb, type SignedIn } from "../helpers";

beforeEach(resetDb);

const UNAUTHENTICATED = { error: "Authentication required", code: "UNAUTHENTICATED" };
const ADMIN_REQUIRED = { error: "Admin access required", code: "FORBIDDEN" };

/** A factory user with the admin role, signed in. */
async function signedInAdmin(overrides: Partial<NewUser> = {}): Promise<SignedIn & { admin: User }> {
  const admin = await createUser({ role: "admin", ...overrides });
  return { admin, ...(await loginAs({ email: admin.email })) };
}

async function storedUser(id: string): Promise<User> {
  const [row] = await testDb().select().from(users).where(eq(users.id, id));
  return row;
}

async function auditRows(action?: string): Promise<AuditLogEntry[]> {
  return testDb()
    .select()
    .from(auditLog)
    .where(action ? eq(auditLog.action, action) : undefined)
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
}

/** The `pokerpal.sid=<value>` pair a response sets. */
function cookieOf(response: request.Response): string {
  const cookie = response.get("Set-Cookie")?.find((value) => value.startsWith("pokerpal.sid="));
  if (!cookie) throw new Error(`No session cookie in ${response.status} response`);
  return cookie.split(";")[0];
}

/** Who /api/auth/me says the agent is: the user's id, or the status when it is not 200. */
async function whoAmI(agent: request.Agent): Promise<string | number> {
  const response = await agent.get("/api/auth/me");
  return response.status === 200 ? response.body.user.id : response.status;
}

describe("GET /api/admin/users", () => {
  it("requires a signed-in, active admin", async () => {
    const anonymous = await request(await getApp()).get("/api/admin/users");
    const { agent: member } = await signIn();
    const { agent: disabledAdmin, admin } = await signedInAdmin();
    await testDb().update(users).set({ isActive: false }).where(eq(users.id, admin.id));

    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual(UNAUTHENTICATED);
    const refused = await member.get("/api/admin/users");
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual(ADMIN_REQUIRED);
    expect((await disabledAdmin.get("/api/admin/users")).status).toBe(401);
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

  it("changes only the fields sent: an absent phone is kept, a blank one cleared (SEC-14)", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ name: "Steady", email: "steady@example.test", phone: "021 555 0199" });

    expect((await agent.put(`/api/admin/users/${target.id}`).send({ role: "admin" })).status).toBe(200);
    expect(await storedUser(target.id)).toMatchObject({
      name: "Steady",
      email: "steady@example.test",
      phone: "021 555 0199",
      role: "admin",
      isActive: true,
    });

    expect((await agent.put(`/api/admin/users/${target.id}`).send({ phone: "  " })).status).toBe(200);
    expect((await storedUser(target.id)).phone).toBeNull();
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

  it("never returns the password hash (SEC-14)", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ name: "Renamed" });

    expect(response.status).toBe(200);
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(response.body)).not.toContain(factoryPasswordHash());
  });

  it.each([
    ["a role other than admin or full_member", "role", { role: "superuser" }],
    ["an empty name (SEC-14)", "name", { name: "   " }],
    ["a malformed new email", "email", { email: "not-an-email" }],
    ["a non-boolean status", "isActive", { isActive: "no" }],
  ])("refuses %s and changes nothing", async (_case, field, body) => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ name: "Has A Name" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid user data", code: "VALIDATION" });
    expect(response.body.details.map((issue: { path: string[] }) => issue.path.join("."))).toContain(field);
    expect(await storedUser(target.id)).toMatchObject({ name: "Has A Name", role: "full_member", isActive: true });
  });

  it("refuses an empty update", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    const response = await agent.put(`/api/admin/users/${target.id}`).send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION" });
  });

  it("accepts an unchanged email that predates the address check", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser({ email: "old.timer@localhost" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ email: "Old.Timer@localhost", role: "admin" });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: "old.timer@localhost", role: "admin" });
  });

  it("refuses another user's email, ignoring case", async () => {
    const { agent } = await signedInAdmin();
    await createUser({ email: "occupied@example.test" });
    const target = await createUser({ name: "Unchanged" });

    const response = await agent.put(`/api/admin/users/${target.id}`).send({ name: "Changed", email: "OCCUPIED@example.test" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "An account with that email already exists", code: "EMAIL_TAKEN" });
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
      expect(response.body).toEqual({ error: "User not found", code: "NOT_FOUND" });
    }
  });

  it("refuses to let admins demote or disable themselves (SEC-14)", async () => {
    const { agent, admin } = await signedInAdmin();

    const demote = await agent.put(`/api/admin/users/${admin.id}`).send({ role: "full_member" });
    const disable = await agent.put(`/api/admin/users/${admin.id}`).send({ isActive: false });

    for (const response of [demote, disable]) {
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "CANNOT_MODIFY_SELF" });
    }
    expect(await storedUser(admin.id)).toMatchObject({ role: "admin", isActive: true });
    // Their own name is theirs to change.
    expect((await agent.put(`/api/admin/users/${admin.id}`).send({ name: "Renamed Admin", role: "admin" })).status).toBe(200);
  });

  it("never leaves the platform without an active admin, even when two admins demote each other at once", async () => {
    const { agent: first, admin: firstAdmin } = await signedInAdmin();
    const { agent: second, admin: secondAdmin } = await signedInAdmin();

    const [one, two] = await Promise.all([
      first.put(`/api/admin/users/${secondAdmin.id}`).send({ role: "full_member" }),
      second.put(`/api/admin/users/${firstAdmin.id}`).send({ role: "full_member" }),
    ]);

    // One wins. The other is refused: LAST_ADMIN if it was already past the admin check, else signed out.
    expect([one.status, two.status].filter((status) => status === 200)).toHaveLength(1);
    const loser = one.status === 200 ? two : one;
    expect([401, 409]).toContain(loser.status);
    if (loser.status === 409) expect(loser.body).toMatchObject({ code: "LAST_ADMIN" });
    const remaining = await testDb()
      .select()
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
    expect(remaining).toHaveLength(1);
  });

  it("stops a disabled user from signing in", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();

    await agent.put(`/api/admin/users/${target.id}`).send({ isActive: false });

    const login = await request(await getApp()).post("/api/auth/login").send({ email: target.email, password: FACTORY_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body).toEqual({ error: "Account is disabled", code: "ACCOUNT_DISABLED" });
  });

  it("gives a promoted user admin access at once, on the session they already have", async () => {
    const { agent } = await signedInAdmin();
    const target = await createUser();
    const { agent: promoted } = await loginAs({ email: target.email });
    expect((await promoted.get("/api/admin/users")).status).toBe(403);

    await agent.put(`/api/admin/users/${target.id}`).send({ role: "admin" });

    expect((await promoted.get("/api/admin/users")).status).toBe(200);
  });

  it("signs a demoted admin out everywhere (SEC-11)", async () => {
    const { agent: demoted, admin } = await signedInAdmin();
    const { agent: elsewhere } = await loginAs({ email: admin.email });
    const { agent: other } = await signedInAdmin();

    expect((await other.put(`/api/admin/users/${admin.id}`).send({ role: "full_member" })).status).toBe(200);

    expect((await demoted.get("/api/admin/users")).status).toBe(401);
    expect(await whoAmI(elsewhere)).toBe(401);
    expect((await other.get("/api/admin/users")).status).toBe(200);
  });

  it("takes admin access away at once even when the role changes outside the API (SEC-11)", async () => {
    const { agent, admin } = await signedInAdmin();

    await testDb().update(users).set({ role: "full_member" }).where(eq(users.id, admin.id));

    const response = await agent.get("/api/admin/users");
    expect(response.status).toBe(403);
    expect(response.body).toEqual(ADMIN_REQUIRED);
  });

  it("signs a disabled user out everywhere, but leaves a renamed one signed in (SEC-11)", async () => {
    const { agent } = await signedInAdmin();
    const disabled = await createUser();
    const renamed = await createUser();
    const { agent: disabledSession } = await loginAs({ email: disabled.email });
    const { agent: renamedSession } = await loginAs({ email: renamed.email });

    await agent.put(`/api/admin/users/${disabled.id}`).send({ isActive: false });
    await agent.put(`/api/admin/users/${renamed.id}`).send({ name: "New Name" });

    expect(await whoAmI(disabledSession)).toBe(401);
    expect(await whoAmI(renamedSession)).toBe(renamed.id);
  });

  it("audits what changed (user.update), with the values before and after, and nothing when nothing changed", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser({ name: "Before", phone: "021 1" });

    await agent.put(`/api/admin/users/${target.id}`).send({ name: "After", phone: "021 1", role: "full_member" });
    await agent.put(`/api/admin/users/${target.id}`).send({ name: "After" });

    const rows = await auditRows("user.update");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: admin.id, targetType: "user", targetId: target.id, ip: expect.any(String) });
    expect(rows[0].data).toEqual({ before: { name: "Before" }, after: { name: "After" } });
  });
});

describe("POST /api/admin/users/:userId/impersonate", () => {
  it("requires a signed-in admin", async () => {
    const target = await createUser();
    const { agent: member } = await signIn();

    expect((await request(await getApp()).post(`/api/admin/users/${target.id}/impersonate`)).status).toBe(401);
    const refused = await member.post(`/api/admin/users/${target.id}/impersonate`);
    expect(refused.status).toBe(403);
    expect(await whoAmI(member)).not.toBe(target.id);
  });

  it("switches the admin's browser to the target user under a new session id", async () => {
    const admin = await createUser({ role: "admin", name: "Ada Admin" });
    const target = await createUser({ name: "Target" });
    const app = await getApp();
    const adminCookie = cookieOf(await request(app).post("/api/auth/login").send({ email: admin.email, password: FACTORY_PASSWORD }));

    const response = await request(app).post(`/api/admin/users/${target.id}/impersonate`).set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Impersonation started");
    expect(response.body.user).toMatchObject({ id: target.id, name: "Target", role: "full_member" });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    const impersonationCookie = cookieOf(response);
    expect(impersonationCookie).not.toBe(adminCookie);
    // The session id the admin had before is gone (SEC-12).
    expect((await request(app).get("/api/auth/me").set("Cookie", adminCookie)).status).toBe(401);

    const me = await request(app).get("/api/auth/me").set("Cookie", impersonationCookie);
    expect(me.body.user.id).toBe(target.id);
    expect(me.body.impersonator).toEqual({ id: admin.id, name: "Ada Admin", email: admin.email });
    expect((await request(app).get("/api/admin/users").set("Cookie", impersonationCookie)).status).toBe(403);
  });

  it("is audited as impersonation.start, by the admin, of the target", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser();

    await agent.post(`/api/admin/users/${target.id}/impersonate`);

    const [row] = await auditRows("impersonation.start");
    expect(row).toMatchObject({ actorUserId: admin.id, targetType: "user", targetId: target.id, ip: expect.any(String) });
  });

  it("answers 404 for an unknown user and leaves the session alone", async () => {
    const { agent, admin } = await signedInAdmin();

    const response = await agent.post("/api/admin/users/no-such-user/impersonate");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "User not found", code: "NOT_FOUND" });
    expect(await whoAmI(agent)).toBe(admin.id);
  });

  it("refuses to impersonate a disabled user (SEC-13)", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser({ isActive: false });

    const response = await agent.post(`/api/admin/users/${target.id}/impersonate`);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "USER_INACTIVE" });
    expect(await whoAmI(agent)).toBe(admin.id);
  });

  it("refuses to impersonate an admin, oneself included (SEC-13)", async () => {
    const { agent, admin } = await signedInAdmin();
    const otherAdmin = await createUser({ role: "admin" });

    for (const id of [otherAdmin.id, admin.id]) {
      const response = await agent.post(`/api/admin/users/${id}/impersonate`);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Admins can't be impersonated", code: "CANNOT_IMPERSONATE_ADMIN" });
    }
    expect(await whoAmI(agent)).toBe(admin.id);
    expect(await auditRows("impersonation.start")).toEqual([]);
  });

  it("cannot be chained: the impersonated user is not an admin", async () => {
    const { agent } = await signedInAdmin();
    const first = await createUser();
    const second = await createUser();
    await agent.post(`/api/admin/users/${first.id}/impersonate`);

    expect((await agent.post(`/api/admin/users/${second.id}/impersonate`)).status).toBe(403);
    expect(await whoAmI(agent)).toBe(first.id);
  });
});

describe("POST /api/admin/stop-impersonation", () => {
  it("requires a signed-in user", async () => {
    const response = await request(await getApp()).post("/api/admin/stop-impersonation");

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it("refuses when the session is not impersonating anyone", async () => {
    const { agent } = await signedInAdmin();

    const response = await agent.post("/api/admin/stop-impersonation");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Not currently impersonating", code: "NOT_IMPERSONATING" });
  });

  it("keeps writing the role fields the build before Phase 2 authorized from, so a rollback keeps sessions working (P2-PROD-03)", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser();
    const sessionOf = async (userId: string) => {
      const result = await testDb().execute(sql`SELECT sess FROM ${sql.identifier(SESSION_TABLE)} WHERE sess->>'userId' = ${userId}`);
      return (result.rows as Array<{ sess: Record<string, unknown> }>).map((row) => row.sess);
    };

    expect(await sessionOf(admin.id)).toEqual([expect.objectContaining({ userId: admin.id, role: "admin" })]);
    await agent.post(`/api/admin/users/${target.id}/impersonate`);
    expect(await sessionOf(target.id)).toEqual([
      expect.objectContaining({ userId: target.id, role: "full_member", originalAdminId: admin.id, originalAdminRole: "admin" }),
    ]);
    await agent.post("/api/admin/stop-impersonation");
    expect(await sessionOf(admin.id)).toEqual([expect.objectContaining({ userId: admin.id, role: "admin" })]);
  });

  it("restores the admin's own session and admin access, under a new session id, and audits it", async () => {
    const { agent, admin } = await signedInAdmin({ name: "Original Admin" });
    const target = await createUser();
    const impersonationCookie = cookieOf(await agent.post(`/api/admin/users/${target.id}/impersonate`));

    const response = await agent.post("/api/admin/stop-impersonation");

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Impersonation ended");
    expect(response.body.user).toMatchObject({ id: admin.id, name: "Original Admin", role: "admin" });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    const me = await agent.get("/api/auth/me");
    expect(me.body).toMatchObject({ user: { id: admin.id }, impersonator: null });
    expect((await agent.get("/api/admin/users")).status).toBe(200);
    // The impersonation's session id is gone, and there is nothing left to stop.
    expect((await request(await getApp()).get("/api/auth/me").set("Cookie", impersonationCookie)).status).toBe(401);
    expect((await agent.post("/api/admin/stop-impersonation")).status).toBe(400);

    const [row] = await auditRows("impersonation.stop");
    expect(row).toMatchObject({
      actorUserId: admin.id,
      targetId: target.id,
      data: { endedBy: "stop", restored: true, startedAt: expect.any(String), asUserId: target.id },
    });
  });

  it("does not restore admin access to an admin demoted while impersonating, and ends the session (SEC-11)", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser();
    await agent.post(`/api/admin/users/${target.id}/impersonate`);
    await testDb().update(users).set({ role: "full_member" }).where(eq(users.id, admin.id));

    const response = await agent.post("/api/admin/stop-impersonation");

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: "UNAUTHENTICATED" });
    expect((await agent.get("/api/admin/users")).status).toBe(401);
    expect(await whoAmI(agent)).toBe(401);
    expect((await auditRows("impersonation.stop"))[0]).toMatchObject({ data: { endedBy: "stop", restored: false } });
  });
});

describe("an impersonation ends with the admin's access", () => {
  it("when the admin is disabled through the API, their impersonation session is signed out", async () => {
    const { agent: impersonating, admin } = await signedInAdmin();
    const { agent: otherAdmin } = await signedInAdmin();
    const target = await createUser();
    await impersonating.post(`/api/admin/users/${target.id}/impersonate`);

    await otherAdmin.put(`/api/admin/users/${admin.id}`).send({ isActive: false });

    expect(await whoAmI(impersonating)).toBe(401);
  });

  it("when the admin loses admin access any other way, /api/auth/me ends the session", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser();
    await agent.post(`/api/admin/users/${target.id}/impersonate`);

    await testDb().update(users).set({ role: "full_member" }).where(eq(users.id, admin.id));

    expect(await whoAmI(agent)).toBe(401);
  });

  it("signing out records the end of the impersonation", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser();
    await agent.post(`/api/admin/users/${target.id}/impersonate`);

    expect((await agent.post("/api/auth/logout")).status).toBe(200);

    const [row] = await auditRows("impersonation.stop");
    expect(row).toMatchObject({ actorUserId: admin.id, targetId: target.id, data: { endedBy: "sign-out", restored: false } });
    expect(await whoAmI(agent)).toBe(401);
  });

  it("signing in to another account records the end of the impersonation", async () => {
    const { agent, admin } = await signedInAdmin();
    const target = await createUser();
    const other = await createUser();
    await agent.post(`/api/admin/users/${target.id}/impersonate`);

    await agent.post("/api/auth/login").send({ email: other.email, password: FACTORY_PASSWORD });

    const me = await agent.get("/api/auth/me");
    expect(me.body).toMatchObject({ user: { id: other.id }, impersonator: null });
    const [row] = await auditRows("impersonation.stop");
    expect(row).toMatchObject({ actorUserId: admin.id, targetId: target.id, data: { endedBy: "sign-in" } });
  });
});

describe("GET /api/admin/audit-log", () => {
  it("requires a signed-in admin", async () => {
    const { agent: member } = await signIn();

    expect((await request(await getApp()).get("/api/admin/audit-log")).status).toBe(401);
    expect((await member.get("/api/admin/audit-log")).status).toBe(403);
  });

  it("lists entries newest first, filtered by actor, target and time, up to the limit", async () => {
    const { agent, admin } = await signedInAdmin();
    const rows = await testDb()
      .insert(auditLog)
      .values([
        { action: "club.delete", actorUserId: admin.id, targetType: "club", targetId: "c1", createdAt: new Date("2026-05-01T00:00:00Z") },
        { action: "club.delete", actorUserId: "someone", targetType: "club", targetId: "c2", createdAt: new Date("2026-05-02T00:00:00Z") },
        { action: "user.update", actorUserId: admin.id, targetType: "user", targetId: "u1", data: { before: { name: "A" } }, createdAt: new Date("2026-05-03T00:00:00Z") },
      ])
      .returning();
    const [first, second, third] = rows;

    const all = await agent.get("/api/admin/audit-log");
    expect(all.status).toBe(200);
    expect(all.body.map((row: AuditLogEntry) => row.id)).toEqual([third.id, second.id, first.id]);
    expect(all.body[0]).toEqual({
      id: third.id,
      action: "user.update",
      actorUserId: admin.id,
      targetType: "user",
      targetId: "u1",
      data: { before: { name: "A" } },
      ip: null,
      createdAt: "2026-05-03T00:00:00.000Z",
    });

    const ids = async (query: string) => (await agent.get(`/api/admin/audit-log?${query}`)).body.map((row: AuditLogEntry) => row.id);
    expect(await ids(`actorUserId=${admin.id}`)).toEqual([third.id, first.id]);
    expect(await ids("targetType=club&targetId=c2")).toEqual([second.id]);
    expect(await ids("before=2026-05-03T00:00:00Z")).toEqual([second.id, first.id]);
    expect(await ids("limit=1")).toEqual([third.id]);
  });

  it("refuses a malformed query", async () => {
    const { agent } = await signedInAdmin();

    for (const query of ["limit=0", "limit=501", "before=yesterday"]) {
      const response = await agent.get(`/api/admin/audit-log?${query}`);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "Invalid audit log query", code: "VALIDATION" });
    }
  });
});
