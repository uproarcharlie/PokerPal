import { describe, expect, it } from "vitest";
import {
  acceptStaffInviteSchema,
  clubSlugSchema,
  createClubSchema,
  createStaffInviteSchema,
  setClubOwnerSchema,
  updateClubSchema,
} from "./clubs";
import { allocationSchema, createPointsSystemSchema, overlappingAllocations } from "./points";
import { createSeasonSchema, updateSeasonSchema } from "./seasons";

describe("clubs", () => {
  it("slugs are lowercase words joined by hyphens, and not reserved (SEC-07, CC-17)", () => {
    expect(clubSlugSchema.parse(" Central-Stars ")).toBe("central-stars");
    for (const bad of ["a", "two words", "trailing-", "admin", "API", "x".repeat(61), "émile"]) {
      expect(clubSlugSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("never accepts an owner through the club form (SEC-07)", () => {
    const parsed = createClubSchema.parse({ name: "Club", slug: "club-x", ownerId: "someone-else", id: "x" });

    expect(parsed).not.toHaveProperty("ownerId");
    expect(parsed).not.toHaveProperty("id");
  });

  it("an edit may resend a legacy slug; the service only applies the slug rules to a changed one", () => {
    expect(updateClubSchema.parse({ slug: "Legacy_Slug" })).toEqual({ slug: "Legacy_Slug" });
  });

  it("rakeLabel is at most 16 characters, blank meaning the default", () => {
    expect(updateClubSchema.parse({ rakeLabel: " AP " })).toEqual({ rakeLabel: "AP" });
    expect(updateClubSchema.parse({ rakeLabel: "" })).toEqual({ rakeLabel: null });
    expect(updateClubSchema.safeParse({ rakeLabel: "x".repeat(17) }).success).toBe(false);
  });

  it("an owner is set by user id or removed with userId null; never by email", () => {
    expect(setClubOwnerSchema.parse({ userId: null })).toEqual({ userId: null });
    expect(setClubOwnerSchema.parse({ userId: "u1" })).toEqual({ userId: "u1" });
    // An owner by email is an invitation now: nothing proves an account owns its address (SEC-P2REV-03).
    expect(setClubOwnerSchema.safeParse({ email: "owner@club.test" }).success).toBe(false);
    expect(setClubOwnerSchema.safeParse({ email: "a@b.co", userId: "u1" }).success).toBe(false);
    expect(setClubOwnerSchema.safeParse({}).success).toBe(false);
  });
});

describe("seasons", () => {
  it("a blank end date is open-ended, never 1970, and may not precede the start", () => {
    expect(createSeasonSchema.parse({ clubId: "c1", name: "2026", startDate: "2026-01-01", endDate: null }).endDate).toBeNull();
    expect(createSeasonSchema.safeParse({ clubId: "c1", name: "2026", startDate: "2026-06-01", endDate: "2026-01-01" }).success).toBe(
      false,
    );
    expect(updateSeasonSchema.parse({ endDate: "" })).toEqual({ endDate: null });
  });
});

describe("points", () => {
  it("overlappingAllocations finds ranges sharing a position (bug-37)", () => {
    expect(
      overlappingAllocations([
        { position: 1, positionEnd: null },
        { position: 2 },
        { position: 4, positionEnd: 10 },
        { position: 10, positionEnd: 12 },
        { position: 13 },
      ]),
    ).toEqual([[2, 3]]);
  });

  it("refuses a points system whose allocations overlap or run backwards", () => {
    const base = { name: "League", participationPoints: 2 };
    const overlapping = createPointsSystemSchema.safeParse({
      ...base,
      allocations: [{ position: 1, points: 10 }, { position: 1, positionEnd: 3, points: 5 }],
    });
    const backwards = createPointsSystemSchema.safeParse({ ...base, allocations: [{ position: 5, positionEnd: 2, points: 1 }] });

    expect(overlapping.success).toBe(false);
    expect(overlapping.error?.issues[0].path).toEqual(["allocations", 1, "position"]);
    expect(backwards.success).toBe(false);
    expect(createPointsSystemSchema.parse(base)).toEqual({ name: "League", participationPoints: 2 });
  });

  it("points and positions are JSON whole numbers: no string, null or boolean is read as a number", () => {
    for (const participationPoints of ["2", null, true, 1.5, -1]) {
      expect(createPointsSystemSchema.safeParse({ name: "League", participationPoints }).success).toBe(false);
    }
    expect(allocationSchema.safeParse({ position: "1", points: 10 }).success).toBe(false);
    expect(allocationSchema.parse({ position: 4, positionEnd: "", points: 3 })).toEqual({ position: 4, positionEnd: null, points: 3 });
  });
});

describe("staff invitations (SEC-P2REV-03)", () => {
  it("invite by email, matched ignoring case, as a manager unless an owner is asked for", () => {
    expect(createStaffInviteSchema.parse({ email: " Sam@Club.test " })).toEqual({ email: "sam@club.test", role: "manager" });
    expect(createStaffInviteSchema.parse({ email: "sam@club.test", role: "owner" })).toEqual({ email: "sam@club.test", role: "owner" });
    expect(createStaffInviteSchema.safeParse({ email: "sam@club.test", role: "admin" }).success).toBe(false);
  });

  it("are accepted only with a well-formed secret", () => {
    expect(acceptStaffInviteSchema.safeParse({ token: "a".repeat(43) }).success).toBe(true);
    expect(acceptStaffInviteSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(acceptStaffInviteSchema.safeParse({ token: `${"a".repeat(40)}%00` }).success).toBe(false);
  });
});
