/**
 * Characterization tests for the account endpoints under /api/auth as they
 * behave today: register, login, logout, me, profile and change-password.
 *
 * Known bugs from the audit are written as the behaviour we want, wrapped in
 * `it.fails` and tagged with the finding id. They pass while the bug is there;
 * once it is fixed they fail, and `.fails` must be removed.
 */
import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { users } from "@shared/schema";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { createUser, FACTORY_PASSWORD } from "../factories";
import { getApp, loginAs, resetDb, testDb } from "../helpers";

beforeEach(resetDb);

const NEW_PASSWORD = "Sturdy-Pass2";

/** Every column of `users` except the password hash, which no auth response includes. */
const USER_KEYS = ["createdAt", "email", "id", "imageUrl", "isActive", "lastLoginAt", "name", "phone", "role", "updatedAt"];

/** The `pokerpal.sid=<value>` pair a response sets, if any. */
function sessionCookie(response: request.Response): string | undefined {
  return response
    .get("Set-Cookie")
    ?.find((cookie) => cookie.startsWith("pokerpal.sid="))
    ?.split(";")[0];
}

/** The session id inside a signed cookie value (`s:<id>.<signature>`, URL-encoded). */
function sessionId(cookie: string | undefined): string | undefined {
  return cookie ? /^pokerpal\.sid=s%3A([^.]+)\./.exec(cookie)?.[1] : undefined;
}

/** GET /api/auth/me as whoever `cookie` belongs to (no one, when it is omitted). */
async function me(cookie?: string): Promise<request.Response> {
  const call = request(await getApp()).get("/api/auth/me");
  return cookie ? call.set("Cookie", cookie) : call;
}

async function storedUser(email: string) {
  const [row] = await testDb().select().from(users).where(eq(users.email, email));
  return row;
}

async function userCount(): Promise<number> {
  const [{ total }] = await testDb().select({ total: count() }).from(users);
  return total;
}

/** A separate app, so rate-limit counters start at zero and no other test shares them. */
function isolatedApp() {
  return createApp({ env: loadEnv(process.env), sessionStore: new session.MemoryStore() });
}

describe("POST /api/auth/register", () => {
  it("creates a full member, signs them in and returns them without the password hash", async () => {
    const response = await request(await getApp()).post("/api/auth/register").send({
      email: "  New.Member@Example.TEST ",
      password: NEW_PASSWORD,
      name: "  New Member  ",
      phone: " 021 555 0100 ",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      message: "Registration successful",
      user: {
        id: expect.any(String),
        email: "new.member@example.test",
        name: "New Member",
        phone: "021 555 0100",
        imageUrl: null,
        role: "full_member",
        isActive: true,
        lastLoginAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    const signedIn = await me(sessionCookie(response));
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toMatchObject({ id: response.body.user.id, email: "new.member@example.test" });
  });

  it("sets an HttpOnly, SameSite=Lax session cookie for the whole site that expires in seven days", async () => {
    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: "cookie@example.test", password: NEW_PASSWORD, name: "Cookie" });

    const [cookie] = response.get("Set-Cookie") ?? [];
    const attributes = cookie.split("; ");
    expect(attributes[0]).toMatch(/^pokerpal\.sid=s%3A[^.]+\.[^;]+$/);
    expect(attributes.slice(1).filter((attribute) => !attribute.startsWith("Expires="))).toEqual([
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
    ]);
    const expires = Date.parse(attributes.find((attribute) => attribute.startsWith("Expires="))!.slice("Expires=".length));
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expires - (Date.now() + sevenDays))).toBeLessThan(60_000);
  });

  it("stores a cost-12 bcrypt hash of the password, never the password itself", async () => {
    await request(await getApp())
      .post("/api/auth/register")
      .send({ email: "hash@example.test", password: NEW_PASSWORD, name: "Hash" });

    const row = await storedUser("hash@example.test");
    expect(row.passwordHash).toMatch(/^\$2b\$12\$/);
    expect(row.passwordHash).not.toContain(NEW_PASSWORD);
    expect(await bcrypt.compare(NEW_PASSWORD, row.passwordHash)).toBe(true);
  });

  it("always creates a full member, whatever role or status the request asks for", async () => {
    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: "sneaky@example.test", password: NEW_PASSWORD, name: "Sneaky", role: "admin", isActive: false });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ role: "full_member", isActive: true });
    expect(await storedUser("sneaky@example.test")).toMatchObject({ role: "full_member", isActive: true });
  });

  it.each([
    ["omitted", undefined],
    ["blank", "   "],
  ])("stores no phone number when it is %s", async (_case, phone) => {
    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: "nophone@example.test", password: NEW_PASSWORD, name: "No Phone", phone });

    expect(response.status).toBe(201);
    expect(response.body.user.phone).toBeNull();
  });

  it.each([
    ["email", { password: NEW_PASSWORD, name: "No Email" }],
    ["password", { email: "nopass@example.test", name: "No Password" }],
    ["name", { email: "noname@example.test", password: NEW_PASSWORD }],
    ["email (empty)", { email: "", password: NEW_PASSWORD, name: "Empty Email" }],
  ])("refuses a registration without %s", async (_missing, body) => {
    const response = await request(await getApp()).post("/api/auth/register").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Email, password, and name are required" });
    expect(sessionCookie(response)).toBeUndefined();
    expect(await userCount()).toBe(0);
  });

  it.each([
    [
      "short",
      [
        "Password must be at least 8 characters long",
        "Password must contain at least one uppercase letter",
        "Password must contain at least one number",
      ],
    ],
    ["alllowercase1", ["Password must contain at least one uppercase letter"]],
    ["ALLUPPERCASE1", ["Password must contain at least one lowercase letter"]],
    ["NoDigitsHere", ["Password must contain at least one number"]],
  ])("refuses the weak password %j and lists every rule it breaks", async (password, details) => {
    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: "weak@example.test", password, name: "Weak" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Password does not meet requirements", details });
    expect(await userCount()).toBe(0);
  });

  it("refuses an email that is already registered, ignoring case and surrounding spaces", async () => {
    await createUser({ email: "taken@example.test" });

    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: " Taken@Example.TEST ", password: NEW_PASSWORD, name: "Second" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "User with this email already exists" });
    expect(sessionCookie(response)).toBeUndefined();
    expect(await userCount()).toBe(1);
  });

  // Known bug SEC-27: a non-string field reaches `email.toLowerCase()` and the route answers 500.
  it.fails("refuses non-string fields with 400 (SEC-27)", async () => {
    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: 42, password: NEW_PASSWORD, name: "Number Email" });

    expect(response.status).toBe(400);
  });

  // Known bug SEC-27: the email format is never checked, so "not-an-email" becomes an account.
  it.fails("refuses an email address that is not one (SEC-27)", async () => {
    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: NEW_PASSWORD, name: "Bad Email" });

    expect(response.status).toBe(400);
    expect(await userCount()).toBe(0);
  });

  // Known bug SEC-12: register writes into the session the browser already had instead of regenerating it.
  it.fails("issues a new session id when registering on a browser that already has a session (SEC-12)", async () => {
    const existing = await createUser();
    const login = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: existing.email, password: FACTORY_PASSWORD });
    const before = sessionCookie(login);

    const registered = await request(await getApp())
      .post("/api/auth/register")
      .set("Cookie", before!)
      .send({ email: "second@example.test", password: NEW_PASSWORD, name: "Second" });

    expect(registered.status).toBe(201);
    expect(sessionId(sessionCookie(registered))).not.toBe(sessionId(before));
    expect((await me(before)).status).toBe(401);
  });
});

describe("POST /api/auth/login", () => {
  it("signs a user in and returns them without the password hash", async () => {
    const created = await createUser({ name: "Logan", phone: "021 123" });

    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: created.email, password: FACTORY_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Login successful");
    expect(Object.keys(response.body.user).sort()).toEqual(USER_KEYS);
    expect(response.body.user).toMatchObject({
      id: created.id,
      email: created.email,
      name: "Logan",
      phone: "021 123",
      role: "full_member",
      isActive: true,
    });
    expect((await me(sessionCookie(response))).body.user).toMatchObject({ id: created.id });
  });

  it("matches the email ignoring case and surrounding spaces", async () => {
    const created = await createUser({ email: "mixed.case@example.test" });

    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: "  Mixed.Case@EXAMPLE.test ", password: FACTORY_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(created.id);
  });

  it("records the login time", async () => {
    const created = await createUser();
    const startedAt = Date.now();

    await request(await getApp()).post("/api/auth/login").send({ email: created.email, password: FACTORY_PASSWORD });

    const { lastLoginAt } = await storedUser(created.email);
    expect(lastLoginAt?.getTime()).toBeGreaterThanOrEqual(startedAt - 1_000);
    expect(lastLoginAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it.each([
    ["email", { password: FACTORY_PASSWORD }],
    ["password", { email: "someone@example.test" }],
  ])("refuses a login without %s", async (_missing, body) => {
    const response = await request(await getApp()).post("/api/auth/login").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Email and password are required" });
  });

  it("gives the same answer for a wrong password and an unknown email, and sets no cookie", async () => {
    const created = await createUser();
    const app = await getApp();

    const wrongPassword = await request(app).post("/api/auth/login").send({ email: created.email, password: "Wrong-Pass1" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.test", password: FACTORY_PASSWORD });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Invalid email or password" });
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  it("refuses a disabled account with the right password", async () => {
    const created = await createUser({ isActive: false });

    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: created.email, password: FACTORY_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Account is disabled" });
    expect(sessionCookie(response)).toBeUndefined();
  });

  it("switches the browser to the account that signed in last", async () => {
    const first = await createUser();
    const second = await createUser();
    const { agent } = await loginAs({ email: first.email });

    await agent.post("/api/auth/login").send({ email: second.email, password: FACTORY_PASSWORD });

    expect((await agent.get("/api/auth/me")).body.user.id).toBe(second.id);
  });

  // Known bug CC-10: the disabled check runs before the password check, so anyone can learn an account is disabled.
  it.fails("answers a wrong password on a disabled account like any other wrong password (CC-10)", async () => {
    const created = await createUser({ isActive: false });

    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: created.email, password: "Wrong-Pass1" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid email or password" });
  });

  // Known bug SEC-27: a non-string email reaches `email.toLowerCase()` and the route answers 500.
  it.fails("refuses non-string credentials with 400 (SEC-27)", async () => {
    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: ["someone@example.test"], password: FACTORY_PASSWORD });

    expect(response.status).toBe(400);
  });

  // Known bug SEC-12: login writes into the session the browser already had instead of regenerating it.
  it.fails("issues a new session id when signing in on a browser that already has a session (SEC-12)", async () => {
    const first = await createUser();
    const second = await createUser();
    const app = await getApp();
    const before = sessionCookie(
      await request(app).post("/api/auth/login").send({ email: first.email, password: FACTORY_PASSWORD }),
    );

    const after = await request(app)
      .post("/api/auth/login")
      .set("Cookie", before!)
      .send({ email: second.email, password: FACTORY_PASSWORD });

    expect(after.status).toBe(200);
    expect(sessionId(sessionCookie(after))).not.toBe(sessionId(before));
    expect((await me(before)).status).toBe(401);
  });

  // Known bug SEC-10: the API limiter skips failed requests, so failed logins are never counted.
  it.fails("throttles repeated failed logins with 429 (SEC-10)", async () => {
    const created = await createUser();
    const app = await isolatedApp();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await request(app).post("/api/auth/login").send({ email: created.email, password: "Wrong-Pass1" });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
  });

  // Known bug CC-13: urlencoded bodies are parsed, so a cross-site HTML form can sign a victim in (login CSRF).
  it.fails("never signs anyone in from a form-encoded login, which any site's HTML form can send (CC-13)", async () => {
    const created = await createUser();

    const response = await request(await getApp())
      .post("/api/auth/login")
      .type("form")
      .send({ email: created.email, password: FACTORY_PASSWORD });

    // Refused (415 for the content type, or 400 once the body is no longer parsed), and no session.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(sessionCookie(response)).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session on the server and clears the cookie", async () => {
    const created = await createUser();
    const login = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: created.email, password: FACTORY_PASSWORD });
    const cookie = sessionCookie(login)!;

    const response = await request(await getApp()).post("/api/auth/logout").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Logout successful" });
    expect(response.get("Set-Cookie")).toEqual(["pokerpal.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
    // The old cookie is dead even if a browser keeps sending it.
    expect((await me(cookie)).body).toEqual({ error: "Not authenticated" });
  });

  it("succeeds when no one is signed in", async () => {
    const response = await request(await getApp()).post("/api/auth/logout");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Logout successful" });
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user without the password hash", async () => {
    const created = await createUser({ name: "Meredith" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.get("/api/auth/me");

    expect(response.status).toBe(200);
    expect(Object.keys(response.body)).toEqual(["user"]);
    expect(Object.keys(response.body.user).sort()).toEqual(USER_KEYS);
    expect(response.body.user).toMatchObject({ id: created.id, email: created.email, name: "Meredith", role: "full_member" });
  });

  it.each([
    ["no cookie", undefined],
    ["a forged cookie", "pokerpal.sid=s%3Aforged.c2lnbmF0dXJl"],
  ])("answers 401 with %s", async (_case, cookie) => {
    const response = await me(cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });

  it("answers 401 once the signed-in user has been deleted", async () => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    await testDb().delete(users).where(eq(users.id, created.id));
    const response = await agent.get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "User not found" });
  });

  // Known bug SEC-11: isActive is only checked at login, so a deactivated user's open session keeps working.
  it.fails("answers 401 once the signed-in user has been deactivated (SEC-11)", async () => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    await testDb().update(users).set({ isActive: false }).where(eq(users.id, created.id));

    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });
});

describe("PUT /api/auth/profile", () => {
  it("requires a signed-in user", async () => {
    const response = await request(await getApp()).put("/api/auth/profile").send({ name: "X", email: "x@example.test" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
  });

  it("updates name, email and phone, trimmed, with the email lowercased", async () => {
    const created = await createUser({ name: "Old Name", phone: "000" });
    const { agent } = await loginAs({ email: created.email });
    const startedAt = Date.now();

    const response = await agent
      .put("/api/auth/profile")
      .send({ name: "  New Name ", email: " New.Address@Example.TEST ", phone: " 021 999 " });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Profile updated successfully");
    expect(Object.keys(response.body.user).sort()).toEqual(USER_KEYS);
    expect(response.body.user).toMatchObject({
      id: created.id,
      name: "New Name",
      email: "new.address@example.test",
      phone: "021 999",
    });
    const row = await storedUser("new.address@example.test");
    expect(row).toMatchObject({ id: created.id, name: "New Name", phone: "021 999" });
    // Written from the app's clock (column defaults use the database server's local time instead).
    expect(row.updatedAt!.getTime()).toBeGreaterThanOrEqual(startedAt - 1_000);
    expect(row.updatedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    // The new address is the one to sign in with.
    await expect(loginAs({ email: "new.address@example.test" })).resolves.toMatchObject({ user: { id: created.id } });
  });

  it.each([
    ["omitted", undefined],
    ["blank", ""],
  ])("clears the phone number when it is %s", async (_case, phone) => {
    const created = await createUser({ phone: "021 555" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: created.name, email: created.email, phone });

    expect(response.status).toBe(200);
    expect(response.body.user.phone).toBeNull();
    expect((await storedUser(created.email)).phone).toBeNull();
  });

  it.each([
    ["name", { email: "keep@example.test" }],
    ["email", { name: "Keep" }],
  ])("refuses an update without %s", async (_missing, body) => {
    const created = await createUser({ email: "keep@example.test", name: "Keep" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Name and email are required" });
  });

  it("refuses another user's email, ignoring case, and changes nothing", async () => {
    await createUser({ email: "someone.else@example.test" });
    const created = await createUser({ name: "Mine" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: "Changed", email: "Someone.Else@Example.test" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Email is already in use" });
    expect(await storedUser(created.email)).toMatchObject({ name: "Mine" });
  });

  it("accepts the user's own email in different case and stores it lowercased", async () => {
    const created = await createUser({ email: "own.address@example.test" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: "Same Me", email: "OWN.Address@example.test" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("own.address@example.test");
  });

  // Known bug SEC-27: a non-string name reaches `name.trim()` and the route answers 500.
  it.fails("refuses non-string fields with 400 (SEC-27)", async () => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: { first: "Ann" }, email: created.email });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/change-password", () => {
  it("requires a signed-in user", async () => {
    const response = await request(await getApp())
      .post("/api/auth/change-password")
      .send({ currentPassword: FACTORY_PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
  });

  it("replaces the password and keeps the current session signed in", async () => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    const response = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: FACTORY_PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Password changed successfully" });
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    await expect(loginAs({ email: created.email })).rejects.toThrow(/returned 401/);
    await expect(loginAs({ email: created.email, password: NEW_PASSWORD })).resolves.toMatchObject({
      user: { id: created.id },
    });
  });

  it.each([
    ["currentPassword", { newPassword: NEW_PASSWORD }],
    ["newPassword", { currentPassword: FACTORY_PASSWORD }],
  ])("refuses a change without %s", async (_missing, body) => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.post("/api/auth/change-password").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Current and new passwords are required" });
  });

  it("checks the new password's strength before the current password", async () => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    const response = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "Wrong-Pass1", newPassword: "alllowercase1" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "New password does not meet requirements",
      details: ["Password must contain at least one uppercase letter"],
    });
  });

  it("refuses a wrong current password and keeps the old one", async () => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    const response = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "Wrong-Pass1", newPassword: NEW_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Current password is incorrect" });
    await expect(loginAs({ email: created.email })).resolves.toMatchObject({ user: { id: created.id } });
  });

  // Known bug SEC-11: a password change leaves every other session of the account signed in.
  it.fails("signs out the account's other sessions (SEC-11)", async () => {
    const created = await createUser();
    const { agent: here } = await loginAs({ email: created.email });
    const { agent: elsewhere } = await loginAs({ email: created.email });

    await here.post("/api/auth/change-password").send({ currentPassword: FACTORY_PASSWORD, newPassword: NEW_PASSWORD });

    expect((await here.get("/api/auth/me")).status).toBe(200);
    expect((await elsewhere.get("/api/auth/me")).status).toBe(401);
  });
});
