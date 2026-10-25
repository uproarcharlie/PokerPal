import { describe, expect, it } from "vitest";
import { deskTabOf } from "../desk/desk-tabs";
import { phoneTabOf } from "./phone-tabs";

describe("one ?tab= for the phone and the wide screen (round5-contracts §8.1)", () => {
  it("opens a wide screen's tab in the phone tab that holds it, and Players for none", () => {
    expect([null, "players", "standings", "seating", "clock", "overview", "money", "activity", "actions", "more", "constructor", "nope"].map(phoneTabOf)).toEqual([
      "players",
      "players",
      "players",
      "seating",
      "clock",
      "money",
      "money",
      "more",
      "more",
      "more",
      "players",
      "players",
    ]);
  });

  it("opens a phone's tab in the wide tab that holds it, and the Overview for none", () => {
    expect([null, "players", "money", "more", "seating", "clock", "activity", "toString"].map(deskTabOf)).toEqual([
      "overview",
      "standings",
      "overview",
      "actions",
      "seating",
      "clock",
      "activity",
      "overview",
    ]);
  });
});
