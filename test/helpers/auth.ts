import { eq } from "drizzle-orm";
import request from "supertest";
import { users } from "@shared/schema";
import { createUser, FACTORY_PASSWORD, type NewUser } from "../factories/users";
import { uniqueSuffix } from "../factories/sequence";
import { getApp } from "./app";
import { testDb } from "./db";

export type Role = "admin" | "full_member";

/** The user as the auth endpoints return it (never the password hash). */
export interface SignedInUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface SignedIn {
  /** Carries the session cookie on every request it makes. */
  agent: request.Agent;
  user: SignedInUser;
}

function signedInUser(response: request.Response, action: string, expectedStatus: number): SignedInUser {
  if (response.status !== expectedStatus) {
    throw new Error(`${action} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(response.body)}`);
  }
  const { id, email, name, role } = response.body.user as SignedInUser;
  return { id, email, name, role };
}

async function login(agent: request.Agent, email: string, password: string): Promise<SignedInUser> {
  return signedInUser(await agent.post("/api/auth/login").send({ email, password }), "POST /api/auth/login", 200);
}

/**
 * A supertest agent signed in through the real auth endpoints.
 *
 * - `loginAs("full_member")` registers a new user via POST /api/auth/register.
 * - `loginAs("admin")` does the same, promotes the user in the DB, then logs in
 *   again, because the session records the role at login.
 * - `loginAs({ email, password })` logs in an existing user, e.g. one from
 *   `createUser()` (whose password defaults to FACTORY_PASSWORD).
 */
export async function loginAs(who: Role | { email: string; password?: string }): Promise<SignedIn> {
  const agent = request.agent(await getApp());

  if (typeof who !== "string") {
    return { agent, user: await login(agent, who.email, who.password ?? FACTORY_PASSWORD) };
  }

  const email = `${who.replace("_", "-")}-${uniqueSuffix()}@example.test`;
  const registered = await agent
    .post("/api/auth/register")
    .send({ email, password: FACTORY_PASSWORD, name: `Test ${who}` });
  const user = signedInUser(registered, "POST /api/auth/register", 201);
  if (who === "full_member") return { agent, user };

  await testDb().update(users).set({ role: who }).where(eq(users.id, user.id));
  return { agent, user: await login(agent, email, FACTORY_PASSWORD) };
}

/**
 * Creates a factory user (role, name, etc. from `overrides`) and signs them in.
 * Much faster than `loginAs(role)`, because factory users share a cheap
 * password hash and nothing goes through registration.
 */
export async function signIn(overrides: Partial<NewUser> = {}): Promise<SignedIn> {
  return loginAs({ email: (await createUser(overrides)).email });
}
