/**
 * The account endpoints under /api/auth: register, login, logout, me, profile and change-password.
 * Sessions are regenerated on every sign-in (SEC-12), the signed-in user is re-read from the database
 * on every request (SEC-11), failed sign-ins are throttled (SEC-10) and sign-in takes JSON only (CC-13).
 */
import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";
import session from "express-session";
import { MemoryStore } from "express-rate-limit";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog, clubManagers, users } from "@shared/schema";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import type { RateLimiterName, RateLimiterOptions } from "../../server/http/rate-limits";
import { createClub, createUser, FACTORY_PASSWORD } from "../factories";
import { getApp, loginAs, resetDb, testDb } from "../helpers";

beforeEach(resetDb);

const NEW_PASSWORD = "Sturdy-Pass2";

/** Every column of `users` except the password hash, which no auth response includes. */
const USER_KEYS = ["createdAt", "email", "id", "imageUrl", "isActive", "lastLoginAt", "name", "phone", "role", "updatedAt"];

const UNAUTHENTICATED = { error: "Authentication required", code: "UNAUTHENTICATED" };
const NOT_AUTHENTICATED = { error: "Not authenticated", code: "UNAUTHENTICATED" };

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

/** The session cookie of a fresh sign-in as `email`. */
async function loginCookie(email: string, password = FACTORY_PASSWORD): Promise<string> {
  const response = await request(await getApp()).post("/api/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return sessionCookie(response)!;
}

async function storedUser(email: string) {
  const [row] = await testDb().select().from(users).where(eq(users.email, email));
  return row;
}

async function userCount(): Promise<number> {
  const [{ total }] = await testDb().select({ total: count() }).from(users);
  return total;
}

/** A separate app with the rate limiters on, so its counters start at zero and no other test shares them. */
function limitedApp(limits: Partial<Record<RateLimiterName, number>> = {}, storeFor?: RateLimiterOptions["storeFor"]) {
  return createApp({
    env: loadEnv(process.env),
    sessionStore: new session.MemoryStore(),
    rateLimits: { enabled: true, limits, storeFor },
  });
}

/** Each limiter's in-memory store, remembering every key it counted. */
function recordingStores() {
  const keys = new Map<RateLimiterName, Set<string>>();
  const storeFor = (name: RateLimiterName) => {
    const seen = new Set<string>();
    keys.set(name, seen);
    return new (class extends MemoryStore {
      override async increment(key: string) {
        seen.add(key);
        return super.increment(key);
      }
    })();
  };
  return { storeFor, keysOf: (name: RateLimiterName) => Array.from(keys.get(name) ?? []) };
}

/** The zod issue paths of a 400 VALIDATION body. */
const issuePaths = (body: { details?: { path: unknown[] }[] }) => (body.details ?? []).map((issue) => issue.path.join("."));

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

    const cookie = (response.get("Set-Cookie") ?? []).find((value) => value.startsWith("pokerpal.sid="));
    const attributes = (cookie ?? "").split("; ");
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
    ["email", "email", { password: NEW_PASSWORD, name: "No Email" }],
    ["password", "password", { email: "nopass@example.test", name: "No Password" }],
    ["name", "name", { email: "noname@example.test", password: NEW_PASSWORD }],
    ["email (empty)", "email", { email: "", password: NEW_PASSWORD, name: "Empty Email" }],
    ["a real email (SEC-27)", "email", { email: "not-an-email", password: NEW_PASSWORD, name: "Bad Email" }],
    ["a string email (SEC-27)", "email", { email: 42, password: NEW_PASSWORD, name: "Number Email" }],
  ])("refuses a registration without %s, saying which field, and signs no one in", async (_missing, field, body) => {
    const response = await request(await getApp()).post("/api/auth/register").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Please enter your name, a valid email and a password", code: "VALIDATION" });
    expect(issuePaths(response.body)).toContain(field);
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
    expect(response.body).toEqual({ error: "Password does not meet requirements", code: "WEAK_PASSWORD", details });
    expect(await userCount()).toBe(0);
  });

  it("refuses an email that is already registered, ignoring case and surrounding spaces", async () => {
    await createUser({ email: "taken@example.test" });

    const response = await request(await getApp())
      .post("/api/auth/register")
      .send({ email: " Taken@Example.TEST ", password: NEW_PASSWORD, name: "Second" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "An account with that email already exists", code: "EMAIL_TAKEN" });
    expect(sessionCookie(response)).toBeUndefined();
    expect(await userCount()).toBe(1);
  });

  it("creates one account when the same email registers twice at once; the other gets 409, not 500 (SEC-27)", async () => {
    const app = await getApp();
    const body = { email: "race@example.test", password: NEW_PASSWORD, name: "Racer" };

    const responses = await Promise.all([1, 2].map(() => request(app).post("/api/auth/register").send(body)));

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)!.body).toMatchObject({ code: "EMAIL_TAKEN" });
    expect(await userCount()).toBe(1);
  });

  it("issues a new session id when registering on a browser that already has a session (SEC-12)", async () => {
    const existing = await createUser();
    const before = await loginCookie(existing.email);

    const registered = await request(await getApp())
      .post("/api/auth/register")
      .set("Cookie", before)
      .send({ email: "second@example.test", password: NEW_PASSWORD, name: "Second" });

    expect(registered.status).toBe(201);
    expect(sessionId(sessionCookie(registered))).not.toBe(sessionId(before));
    expect((await me(before)).status).toBe(401);
    expect((await me(sessionCookie(registered))).body.user.email).toBe("second@example.test");
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

  it("still signs in accounts whose email was stored before addresses were checked, in any case", async () => {
    const legacy = await createUser({ email: "Old.Timer@LocalHost" });

    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: "old.timer@localhost", password: FACTORY_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(legacy.id);
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
    ["email", "email", { password: FACTORY_PASSWORD }],
    ["password", "password", { email: "someone@example.test" }],
    ["a string email (SEC-27)", "email", { email: ["someone@example.test"], password: FACTORY_PASSWORD }],
    ["a string password (SEC-27)", "password", { email: "someone@example.test", password: { $ne: "" } }],
  ])("refuses a login without %s with 400", async (_missing, field, body) => {
    const response = await request(await getApp()).post("/api/auth/login").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Email and password are required", code: "VALIDATION" });
    expect(issuePaths(response.body)).toContain(field);
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
      expect(response.body).toEqual({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  it("spends a full password check on an unknown email, so timing does not reveal who has an account (CC-10)", async () => {
    const app = await getApp();
    const costTwelve = await bcrypt.hash("Anything-1", 12);
    const compareStarted = performance.now();
    await bcrypt.compare("Wrong-Pass1", costTwelve);
    const oneCompare = performance.now() - compareStarted;

    const loginStarted = performance.now();
    const response = await request(app).post("/api/auth/login").send({ email: "nobody@example.test", password: "Wrong-Pass1" });
    const unknownEmailLogin = performance.now() - loginStarted;

    expect(response.status).toBe(401);
    expect(unknownEmailLogin).toBeGreaterThan(oneCompare * 0.6);
  });

  it("refuses a disabled account with the right password", async () => {
    const created = await createUser({ isActive: false });

    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: created.email, password: FACTORY_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Account is disabled", code: "ACCOUNT_DISABLED" });
    expect(sessionCookie(response)).toBeUndefined();
  });

  it("answers a wrong password on a disabled account like any other wrong password (CC-10)", async () => {
    const created = await createUser({ isActive: false });

    const response = await request(await getApp())
      .post("/api/auth/login")
      .send({ email: created.email, password: "Wrong-Pass1" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
  });

  it("switches the browser to the account that signed in last", async () => {
    const first = await createUser();
    const second = await createUser();
    const { agent } = await loginAs({ email: first.email });

    await agent.post("/api/auth/login").send({ email: second.email, password: FACTORY_PASSWORD });

    expect((await agent.get("/api/auth/me")).body.user.id).toBe(second.id);
  });

  it("issues a new session id when signing in on a browser that already has a session (SEC-12)", async () => {
    const first = await createUser();
    const second = await createUser();
    const before = await loginCookie(first.email);

    const after = await request(await getApp())
      .post("/api/auth/login")
      .set("Cookie", before)
      .send({ email: second.email, password: FACTORY_PASSWORD });

    expect(after.status).toBe(200);
    expect(sessionId(sessionCookie(after))).not.toBe(sessionId(before));
    expect((await me(before)).status).toBe(401);
  });

  it("never signs anyone in from a form-encoded or text/plain login, which any site's HTML form can send (CC-13)", async () => {
    const created = await createUser();
    const app = await getApp();

    const form = await request(app).post("/api/auth/login").type("form").send({ email: created.email, password: FACTORY_PASSWORD });
    const text = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "text/plain")
      .send(JSON.stringify({ email: created.email, password: FACTORY_PASSWORD }));

    for (const response of [form, text]) {
      expect(response.status).toBe(415);
      expect(response.body).toEqual({ error: "Send the request as JSON", code: "UNSUPPORTED_MEDIA_TYPE" });
      expect(sessionCookie(response)).toBeUndefined();
    }
  });
});

describe("sign-in throttling (SEC-10)", () => {
  it("answers 429 after 10 failed logins for one email from one address", async () => {
    const created = await createUser();
    const app = await limitedApp();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await request(app).post("/api/auth/login").send({ email: created.email, password: "Wrong-Pass1" });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);
    const limited = await request(app).post("/api/auth/login").send({ email: created.email, password: FACTORY_PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: "Too many failed attempts. Please wait 15 minutes and try again.",
      code: "RATE_LIMITED",
    });
    expect(sessionCookie(limited)).toBeUndefined();
  });

  it("counts only failures, and each email separately (the email as typed, in any case)", async () => {
    const target = await createUser();
    const bystander = await createUser();
    const app = await limitedApp({ auth: 2 });
    const login = (email: string, password: string) => request(app).post("/api/auth/login").send({ email, password });

    for (let attempt = 0; attempt < 3; attempt++) expect((await login(target.email, FACTORY_PASSWORD)).status).toBe(200);
    expect((await login(target.email, "Wrong-Pass1")).status).toBe(401);
    expect((await login(` ${target.email.toUpperCase()} `, "Wrong-Pass1")).status).toBe(401);

    expect((await login(target.email, FACTORY_PASSWORD)).status).toBe(429);
    expect((await login(bystander.email, FACTORY_PASSWORD)).status).toBe(200);
  });

  it("stops one address trying many accounts: failures count per visitor whatever the email (SEC-P2-03)", async () => {
    const target = await createUser();
    const app = await limitedApp({ authVisitor: 3 });
    const login = (email: string, password: string) => request(app).post("/api/auth/login").send({ email, password });

    for (let n = 0; n < 3; n++) expect((await login(`guess${n}@example.test`, "Wrong-Pass1")).status).toBe(401);

    expect((await login(target.email, FACTORY_PASSWORD)).status).toBe(429);
  });

  it("stops many addresses trying one account: failures count per email from everywhere (SEC-P2-03)", async () => {
    const target = await createUser();
    const app = await limitedApp({ authAccount: 2 });
    const from = (address: string, password: string) =>
      request(app).post("/api/auth/login").set("X-Forwarded-For", address).send({ email: target.email, password });

    expect((await from("203.0.113.1", "Wrong-Pass1")).status).toBe(401);
    expect((await from("203.0.113.2", "Wrong-Pass1")).status).toBe(401);
    const blocked = await from("203.0.113.3", FACTORY_PASSWORD);

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/this account/);
  });

  it("never locks the account's own browser out: one that signed in before is not held to the per-account limit (TN2-06)", async () => {
    const target = await createUser();
    const app = await limitedApp({ authAccount: 2 });
    const owner = request.agent(app);
    const signIn = (agent: request.Agent | ReturnType<typeof request>, address: string, password: string) =>
      agent.post("/api/auth/login").set("X-Forwarded-For", address).send({ email: target.email, password });

    const first = await signIn(owner, "198.51.100.10", FACTORY_PASSWORD);
    expect(first.status).toBe(200);
    const mark = (first.get("Set-Cookie") ?? []).find((cookie) => cookie.startsWith("pp_known_device="));
    expect(mark?.split("; ")).toEqual(expect.arrayContaining(["Path=/api/auth", "HttpOnly", "SameSite=Lax"]));

    // Someone who knows the address fails on purpose from two more addresses: the account limit is reached.
    expect((await signIn(request(app), "203.0.113.1", "Wrong-Pass1")).status).toBe(401);
    expect((await signIn(request(app), "203.0.113.2", "Wrong-Pass1")).status).toBe(401);
    expect((await signIn(request(app), "203.0.113.3", FACTORY_PASSWORD)).status).toBe(429);

    // The owner's own browser still signs in, from any address; a forged mark does not.
    expect((await signIn(owner, "198.51.100.11", FACTORY_PASSWORD)).status).toBe(200);
    const forged = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.4")
      .set("Cookie", "pp_known_device=bm90LWEtcmVhbC1tYXJr")
      .send({ email: target.email, password: FACTORY_PASSWORD });
    expect(forged.status).toBe(429);
  });

  it("counts the visitor before the email, so a visitor already turned away adds no counter, and keys emails by digest (P2REV0-SEC-01)", async () => {
    const { storeFor, keysOf } = recordingStores();
    const app = await limitedApp({ authVisitor: 3 }, storeFor);
    const login = (email: string) => request(app).post("/api/auth/login").send({ email, password: "Wrong-Pass1" });

    const statuses: number[] = [];
    for (let n = 0; n < 8; n++) statuses.push((await login(`guess${n}@example.test`)).status);
    // Oversized emails never reach the database, and never become a key either.
    statuses.push((await login(`${"x".repeat(90_000)}@example.test`)).status);

    expect(statuses).toEqual([401, 401, 401, 429, 429, 429, 429, 429, 429]);
    expect(keysOf("auth")).toHaveLength(3);
    expect(keysOf("authAccount")).toHaveLength(3);
    for (const key of [...keysOf("auth"), ...keysOf("authAccount")]) {
      expect(key).not.toContain("guess");
      expect(key.length).toBeLessThan(80);
    }
  });

  it("caps sign-ups per address, successful ones included, so accounts cannot be made in bulk (SEC-P2-03)", async () => {
    const app = await limitedApp({ signUp: 2 });
    const register = (n: number) =>
      request(app).post("/api/auth/register").send({ email: `bulk${n}@example.test`, password: NEW_PASSWORD, name: `Bulk ${n}` });

    expect([(await register(1)).status, (await register(2)).status, (await register(3)).status]).toEqual([201, 201, 429]);
    expect(await testDb().select().from(users).where(eq(users.email, "bulk3@example.test"))).toEqual([]);
  });

  it("throttles failed registrations too", async () => {
    await createUser({ email: "taken@example.test" });
    const app = await limitedApp({ auth: 2 });
    const register = () =>
      request(app).post("/api/auth/register").send({ email: "taken@example.test", password: NEW_PASSWORD, name: "Again" });

    expect([(await register()).status, (await register()).status, (await register()).status]).toEqual([409, 409, 429]);
  });

  it("counts successful sign-ins per address too: each one is a bcrypt run (SEC-P2REV-01)", async () => {
    const own = await createUser();
    const app = await limitedApp({ passwordVisitor: 3 });
    const login = () => request(app).post("/api/auth/login").send({ email: own.email, password: FACTORY_PASSWORD });

    expect([(await login()).status, (await login()).status, (await login()).status]).toEqual([200, 200, 200]);
    const refused = await login();
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/from this network/);
    // The same budget covers sign-ups from that address.
    const signUp = await request(app).post("/api/auth/register").send({ email: "late@example.test", password: NEW_PASSWORD, name: "Late" });
    expect(signUp.status).toBe(429);
  });

  it("counts successful sign-ins per account from every address, even on a known device (SEC-P2REV-01)", async () => {
    const own = await createUser();
    const other = await createUser();
    const app = await limitedApp({ signInAccount: 2 });
    const browser = request.agent(app);
    const login = (email: string, address: string) =>
      browser.post("/api/auth/login").set("X-Forwarded-For", address).send({ email, password: FACTORY_PASSWORD });

    expect((await login(own.email, "203.0.113.1")).status).toBe(200);
    expect((await login(own.email, "203.0.113.2")).status).toBe(200);
    const refused = await login(own.email, "203.0.113.3");
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/signed in many times/);
    expect((await login(other.email, "203.0.113.3")).status).toBe(200);
  });

  it("does not count failed sign-ins against the account's success budget, so nobody can use it up for the owner", async () => {
    const own = await createUser();
    const app = await limitedApp({ signInAccount: 1 });
    for (let n = 0; n < 3; n++) {
      const failed = await request(app).post("/api/auth/login").set("X-Forwarded-For", `203.0.113.${n}`).send({ email: own.email, password: "Wrong-Pass1" });
      expect(failed.status).toBe(401);
    }
    expect((await request(app).post("/api/auth/login").send({ email: own.email, password: FACTORY_PASSWORD })).status).toBe(200);
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session on the server and clears the cookie", async () => {
    const created = await createUser();
    const cookie = await loginCookie(created.email);

    const response = await request(await getApp()).post("/api/auth/logout").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Logout successful" });
    expect(response.get("Set-Cookie")).toEqual(["pokerpal.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
    // The old cookie is dead even if a browser keeps sending it.
    expect((await me(cookie)).body).toEqual(NOT_AUTHENTICATED);
  });

  it("succeeds when no one is signed in", async () => {
    const response = await request(await getApp()).post("/api/auth/logout");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Logout successful" });
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user without the password hash, no impersonator and no clubs", async () => {
    const created = await createUser({ name: "Meredith" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.get("/api/auth/me");

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["impersonator", "managedClubIds", "user"]);
    expect(Object.keys(response.body.user).sort()).toEqual(USER_KEYS);
    expect(response.body.user).toMatchObject({ id: created.id, email: created.email, name: "Meredith", role: "full_member" });
    expect(response.body.impersonator).toBeNull();
    expect(response.body.managedClubIds).toEqual([]);
  });

  it("lists the clubs the user owns or manages, and no others", async () => {
    const created = await createUser();
    const owned = await createClub({ ownerId: created.id });
    const managed = await createClub();
    await createClub();
    await testDb().insert(clubManagers).values({ clubId: managed.id, userId: created.id });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.get("/api/auth/me");

    expect(response.body.managedClubIds).toEqual([owned.id, managed.id].sort());
  });

  it.each([
    ["no cookie", undefined],
    ["a forged cookie", "pokerpal.sid=s%3Aforged.c2lnbmF0dXJl"],
  ])("answers 401 with %s", async (_case, cookie) => {
    const response = await me(cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(NOT_AUTHENTICATED);
  });

  it("answers 401 once the signed-in user has been deleted, and clears the cookie", async () => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    await testDb().delete(users).where(eq(users.id, created.id));
    const response = await agent.get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual(NOT_AUTHENTICATED);
    expect(sessionCookie(response)).toBe("pokerpal.sid=");
  });

  it("answers 401 once the signed-in user has been deactivated, and the session stays ended (SEC-11)", async () => {
    const created = await createUser();
    const cookie = await loginCookie(created.email);

    await testDb().update(users).set({ isActive: false }).where(eq(users.id, created.id));
    expect((await me(cookie)).status).toBe(401);

    await testDb().update(users).set({ isActive: true }).where(eq(users.id, created.id));
    expect((await me(cookie)).status).toBe(401);
  });
});

describe("PUT /api/auth/profile", () => {
  it("audits a change as user.update, crediting the admin when they made it while impersonating the user (P2REV0-06)", async () => {
    const owner = await createUser({ name: "Club Owner", email: "owner@example.test", phone: "021 111" });
    const { agent: admin, user: adminUser } = await loginAs({ email: (await createUser({ role: "admin" })).email });
    expect((await admin.post(`/api/admin/users/${owner.id}/impersonate`)).status).toBe(200);

    const edit = await admin.put("/api/auth/profile").send({ name: "Club Owner", email: "elsewhere@example.test", phone: "021 111" });

    expect(edit.status).toBe(200);
    const rows = await testDb().select().from(auditLog).where(eq(auditLog.action, "user.update"));
    expect(rows).toEqual([
      expect.objectContaining({
        actorUserId: adminUser.id,
        targetType: "user",
        targetId: owner.id,
        data: { before: { email: "owner@example.test" }, after: { email: "elsewhere@example.test" }, via: "profile", asUserId: owner.id },
      }),
    ]);
  });

  it("audits a user's own change too, and writes nothing when nothing changed", async () => {
    const created = await createUser({ name: "Same", phone: "021 222" });
    const { agent, user } = await loginAs({ email: created.email });

    await agent.put("/api/auth/profile").send({ name: "Same", email: created.email, phone: "021 222" });
    await agent.put("/api/auth/profile").send({ name: "Renamed", email: created.email });

    expect(await testDb().select().from(auditLog).where(eq(auditLog.action, "user.update"))).toEqual([
      expect.objectContaining({ actorUserId: user.id, targetId: created.id, data: { before: { name: "Same" }, after: { name: "Renamed" }, via: "profile" } }),
    ]);
  });

  it("requires a signed-in user", async () => {
    const response = await request(await getApp()).put("/api/auth/profile").send({ name: "X", email: "x@example.test" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it("refuses a deactivated user's open session at once (SEC-11)", async () => {
    const created = await createUser({ name: "Before" });
    const { agent } = await loginAs({ email: created.email });
    await testDb().update(users).set({ isActive: false }).where(eq(users.id, created.id));

    const response = await agent.put("/api/auth/profile").send({ name: "After", email: created.email });

    expect(response.status).toBe(401);
    expect((await storedUser(created.email)).name).toBe("Before");
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

  it("keeps the phone number when it is not sent", async () => {
    const created = await createUser({ phone: "021 555" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: "Renamed", email: created.email });

    expect(response.status).toBe(200);
    expect(response.body.user.phone).toBe("021 555");
    expect((await storedUser(created.email)).phone).toBe("021 555");
  });

  it.each([
    ["blank", ""],
    ["null", null],
  ])("clears the phone number when it is %s", async (_case, phone) => {
    const created = await createUser({ phone: "021 555" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: created.name, email: created.email, phone });

    expect(response.status).toBe(200);
    expect(response.body.user.phone).toBeNull();
    expect((await storedUser(created.email)).phone).toBeNull();
  });

  it.each([
    ["name", "name", { email: "keep@example.test" }],
    ["email", "email", { name: "Keep" }],
    ["a string name (SEC-27)", "name", { name: { first: "Ann" }, email: "keep@example.test" }],
    ["a well-formed new email", "email", { name: "Keep", email: "not-an-email" }],
  ])("refuses an update without %s", async (_missing, field, body) => {
    const created = await createUser({ email: "keep@example.test", name: "Keep" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Name and a valid email are required", code: "VALIDATION" });
    expect(issuePaths(response.body)).toContain(field);
    expect(await storedUser("keep@example.test")).toMatchObject({ name: "Keep" });
  });

  it("accepts an unchanged email that predates the address check", async () => {
    const legacy = await createUser({ email: "old.timer@localhost" });
    const { agent } = await loginAs({ email: legacy.email });

    const response = await agent.put("/api/auth/profile").send({ name: "Still Me", email: "Old.Timer@localhost" });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ name: "Still Me", email: "old.timer@localhost" });
  });

  it("refuses another user's email, ignoring case, and changes nothing", async () => {
    await createUser({ email: "someone.else@example.test" });
    const created = await createUser({ name: "Mine" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: "Changed", email: "Someone.Else@Example.test" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "An account with that email already exists", code: "EMAIL_TAKEN" });
    expect(await storedUser(created.email)).toMatchObject({ name: "Mine" });
  });

  it("accepts the user's own email in different case and stores it lowercased", async () => {
    const created = await createUser({ email: "own.address@example.test" });
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.put("/api/auth/profile").send({ name: "Same Me", email: "OWN.Address@example.test" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("own.address@example.test");
  });
});

describe("POST /api/auth/change-password", () => {
  it("requires a signed-in user", async () => {
    const response = await request(await getApp())
      .post("/api/auth/change-password")
      .send({ currentPassword: FACTORY_PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
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
  ])("refuses a change without %s", async (missing, body) => {
    const created = await createUser();
    const { agent } = await loginAs({ email: created.email });

    const response = await agent.post("/api/auth/change-password").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Current and new passwords are required", code: "VALIDATION" });
    expect(issuePaths(response.body)).toEqual([missing]);
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
      code: "WEAK_PASSWORD",
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
    expect(response.body).toEqual({ error: "Current password is incorrect", code: "WRONG_PASSWORD" });
    await expect(loginAs({ email: created.email })).resolves.toMatchObject({ user: { id: created.id } });
  });

  it("counts every attempt per account, wrong passwords included, since each runs bcrypt (SEC-P2REV-01)", async () => {
    const created = await createUser();
    const bystander = await createUser();
    const app = await limitedApp({ passwordChange: 2 });
    const signIn = async (email: string) => {
      const agent = request.agent(app);
      expect((await agent.post("/api/auth/login").send({ email, password: FACTORY_PASSWORD })).status).toBe(200);
      return agent;
    };
    const mine = await signIn(created.email);
    const theirs = await signIn(bystander.email);
    const change = (agent: request.Agent, currentPassword: string) =>
      agent.post("/api/auth/change-password").send({ currentPassword, newPassword: NEW_PASSWORD });

    expect([(await change(mine, "Wrong-Pass1")).status, (await change(mine, "Wrong-Pass2")).status]).toEqual([401, 401]);
    const refused = await change(mine, FACTORY_PASSWORD);
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: "Too many password changes. Please wait 15 minutes and try again.", code: "RATE_LIMITED" });
    expect((await change(theirs, FACTORY_PASSWORD)).status).toBe(200);
  });

  it("counts password changes against the address's password budget too (SEC-P2REV-01)", async () => {
    const created = await createUser();
    const app = await limitedApp({ passwordVisitor: 2 });
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: created.email, password: FACTORY_PASSWORD })).status).toBe(200);

    expect((await agent.post("/api/auth/change-password").send({ currentPassword: "Wrong-Pass1", newPassword: NEW_PASSWORD })).status).toBe(401);
    const refused = await agent.post("/api/auth/change-password").send({ currentPassword: FACTORY_PASSWORD, newPassword: NEW_PASSWORD });
    expect(refused.status).toBe(429);
  });

  it("signs out the account's other sessions, and only that account's (SEC-11)", async () => {
    const created = await createUser();
    const bystander = await createUser();
    const { agent: here } = await loginAs({ email: created.email });
    const { agent: elsewhere } = await loginAs({ email: created.email });
    const { agent: someoneElse } = await loginAs({ email: bystander.email });

    await here.post("/api/auth/change-password").send({ currentPassword: FACTORY_PASSWORD, newPassword: NEW_PASSWORD });

    expect((await here.get("/api/auth/me")).status).toBe(200);
    expect((await elsewhere.get("/api/auth/me")).status).toBe(401);
    expect((await someoneElse.get("/api/auth/me")).status).toBe(200);
  });
});
