import { describe, expect, it } from "vitest";
import { clubDto } from "@test/helpers/f3-clubs";
import {
  clubProfileFormSchema,
  clubSocialFormSchema,
  createClubFormSchema,
  profileValues,
  slugFromName,
  type ClubProfileValues,
} from "./club-form";

const values = (overrides: Partial<ClubProfileValues> = {}): ClubProfileValues => ({ ...profileValues(clubDto()), ...overrides });

describe("the club forms' schemas", () => {
  it("send a new club's blank fields as no value, and its slug as typed rules allow", () => {
    expect(createClubFormSchema.parse(values({ description: "", address: " ", imageUrl: null, slug: " Central-Stars " }))).toEqual({
      name: "Central Stars",
      slug: "central-stars",
      description: null,
      imageUrl: null,
      address: null,
      timezone: "Pacific/Auckland",
      rakeLabel: null,
    });
  });

  it("refuse a new club without a name, or with a reserved slug", () => {
    const result = createClubFormSchema.safeParse(values({ name: " ", slug: "admin" }));

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["name", "Required"],
      ["slug", "That URL is reserved; choose another"],
    ]);
  });

  it("let a club keep an older slug unchanged, but check one that changes (contract §2.4)", () => {
    const schema = clubProfileFormSchema("Old_Slug");

    expect(schema.safeParse(values({ slug: "Old_Slug" })).success).toBe(true);
    const changed = schema.safeParse(values({ slug: "New_Slug" }));
    expect(changed.success).toBe(false);
    expect(changed.error?.issues[0]).toMatchObject({ path: ["slug"], message: "Slug must be lowercase letters, numbers, and hyphens only" });
  });

  it("accept only http(s) social links, blank meaning none", () => {
    expect(clubSocialFormSchema.parse({ discordUrl: "", websiteUrl: "https://centralstars.example" })).toEqual({
      discordUrl: null,
      websiteUrl: "https://centralstars.example",
    });
    expect(clubSocialFormSchema.safeParse({ facebookUrl: "javascript:alert(1)" }).error?.issues[0].message).toBe(
      "Only http and https links are allowed",
    );
  });
});

describe("profileValues", () => {
  it("fills the form from the club, a missing time zone as the one it has always been shown in", () => {
    expect(profileValues(clubDto({ timezone: null, description: "<p>Hi</p>", imageUrl: "/uploads/x.webp" }))).toEqual({
      name: "Central Stars",
      slug: "central-stars",
      description: "<p>Hi</p>",
      imageUrl: "/uploads/x.webp",
      address: "",
      timezone: "Pacific/Auckland",
      rakeLabel: "",
    });
  });
});

describe("slugFromName", () => {
  it.each([
    ["Central Stars", "central-stars"],
    ["  Club 2020 — Onehunga! ", "club-2020-onehunga"],
    ["", ""],
  ])("%j → %j", (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });
});
