import { describe, expect, it } from "vitest";
import { foldName, matchingNames, nameMatches } from "./name-search";

describe("finding a player by name", () => {
  it("matches the start of any word of the name, in any case", () => {
    expect(nameMatches("Aroha Ngata", "ar")).toBe(true);
    expect(nameMatches("Mark Arnold", "AR")).toBe(true);
    expect(nameMatches("Aroha Ngata", "ngata")).toBe(true);
    expect(nameMatches("Aroha Ngata", "oha")).toBe(false);
  });

  it("needs every word typed to match", () => {
    expect(nameMatches("Aroha Ngata", "aroha ng")).toBe(true);
    expect(nameMatches("Aroha Ngata", "aroha smith")).toBe(false);
  });

  it("ignores accents either way, and extra spaces", () => {
    expect(nameMatches("Zoë Māori", "zoe maori")).toBe(true);
    expect(nameMatches("Zoe Maori", "zoë")).toBe(true);
    expect(foldName("  Zoë   Ngā  ")).toBe("zoe nga");
  });

  it("matches nobody for nothing typed", () => {
    expect(nameMatches("Aroha Ngata", "   ")).toBe(false);
  });
});

describe("matchingNames", () => {
  const people = [{ name: "Zoë Clarke" }, { name: "Mark Arnold" }];
  it("keeps every item while nothing is typed, and the matching ones once something is", () => {
    expect(matchingNames(people, (person) => person.name, "  ")).toBe(people);
    expect(matchingNames(people, (person) => person.name, "zo")).toEqual([{ name: "Zoë Clarke" }]);
  });
});
