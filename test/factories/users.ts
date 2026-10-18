import bcrypt from "bcryptjs";
import { users, type User } from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { uniqueSuffix } from "./sequence";

export type NewUser = typeof users.$inferInsert;

/** Meets the registration password policy (8+ characters with upper, lower and a digit). */
export const FACTORY_PASSWORD = "Factory-Pass1";

// The app hashes at cost 12 (about 250 ms each). Login compares at whatever cost
// the stored hash records, so one cost-4 hash shared by every factory user keeps
// both factories and logins fast.
const FACTORY_BCRYPT_COST = 4;
let factoryHash: string | undefined;

export function factoryPasswordHash(): string {
  factoryHash ??= bcrypt.hashSync(FACTORY_PASSWORD, FACTORY_BCRYPT_COST);
  return factoryHash;
}

export function buildUser(overrides: Partial<NewUser> = {}): NewUser {
  const id = uniqueSuffix();
  return {
    email: `user-${id}@example.test`,
    passwordHash: factoryPasswordHash(),
    name: `Test User ${id}`,
    role: "full_member",
    isActive: true,
    ...overrides,
  };
}

export async function createUser(overrides: Partial<NewUser> = {}, db: Database = getDb()): Promise<User> {
  const [user] = await db.insert(users).values(buildUser(overrides)).returning();
  return user;
}
