import { describe, expect, it } from "vitest";
import { adminUpdateUserSchema } from "./admin";
import { emailSchema, loginSchema, passwordProblems, registerSchema, updateProfileSchema } from "./auth";

describe("auth", () => {
  it("passwordProblems lists every rule broken, in the API's wording", () => {
    expect(passwordProblems("Abcdefg1")).toEqual([]);
    expect(passwordProblems("abc")).toEqual([
      "Password must be at least 8 characters long",
      "Password must contain at least one uppercase letter",
      "Password must contain at least one number",
    ]);
  });

  it("emails are trimmed and lower-cased; non-strings are refused, not a 500 (SEC-27)", () => {
    expect(emailSchema.parse("  Alice@Example.TEST ")).toBe("alice@example.test");
    expect(loginSchema.safeParse({ email: ["a@b.c"], password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.c", password: { $ne: "" } }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "not-an-email", password: "Abcdefg1", name: "A" }).success).toBe(false);
  });

  it("sign-in and profile edits accept the addresses of accounts made before the format check", () => {
    expect(loginSchema.parse({ email: " Old.Timer@LocalHost ", password: "x" })).toEqual({ email: "old.timer@localhost", password: "x" });
    expect(updateProfileSchema.safeParse({ name: "A", email: "old.timer@localhost" }).success).toBe(true);
    expect(adminUpdateUserSchema.safeParse({ email: "old.timer@localhost" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "   ", password: "x" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "old.timer@localhost", password: "Abcdefg1", name: "A" }).success).toBe(false);
  });

  it("registration keeps the password exactly as typed", () => {
    expect(registerSchema.parse({ email: "a@b.co", password: " Pass word1 ", name: " Al " })).toEqual({
      email: "a@b.co",
      password: " Pass word1 ",
      name: "Al",
    });
  });
});

describe("admin user update", () => {
  it("keeps the phone when it is not sent, and clears it when sent blank (SEC-14)", () => {
    expect(adminUpdateUserSchema.parse({ role: "admin" })).toEqual({ role: "admin" });
    expect(adminUpdateUserSchema.parse({ phone: "" })).toEqual({ phone: null });
  });

  it("refuses an empty name, an unknown role and an empty update", () => {
    expect(adminUpdateUserSchema.safeParse({ name: "" }).success).toBe(false);
    expect(adminUpdateUserSchema.safeParse({ role: "owner" }).success).toBe(false);
    expect(adminUpdateUserSchema.safeParse({}).success).toBe(false);
  });
});
