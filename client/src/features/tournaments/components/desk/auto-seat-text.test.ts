import { describe, expect, it } from "vitest";
import { seatRef } from "@test/helpers/seating-dto";
import { autoSeatText, needsTable } from "./auto-seat-text";

describe("autoSeatText (round5-contracts §3.2 rule 3)", () => {
  it("says where automatic seating put the player, or why they wait", () => {
    expect(autoSeatText({ status: "seated", seat: seatRef("tb2", 2, 7) })).toBe("Seated at Table 2, Seat 7.");
    expect(autoSeatText({ status: "seated", seat: seatRef("tb9", 9, 1, "Feature table") })).toBe("Seated at Feature table, Seat 1.");
    expect(autoSeatText({ status: "waiting", reason: "tables_full" })).toBe("Waiting: every table is full — open a table.");
    expect(autoSeatText({ status: "waiting", reason: "awaiting_payment" })).toBe("Seated once their payment is confirmed.");
  });

  it("has nothing to say before the tables are drawn, with seating off, or when nothing happened", () => {
    for (const reason of ["no_tables", "off", "not_eligible", "already_seated"] as const) expect(autoSeatText({ status: "waiting", reason })).toBeNull();
    expect(autoSeatText(null)).toBeNull();
  });

  it("sends the TD to the seating only when every table is full", () => {
    expect(needsTable({ status: "waiting", reason: "tables_full" })).toBe(true);
    expect(needsTable({ status: "waiting", reason: "off" })).toBe(false);
    expect(needsTable({ status: "seated", seat: seatRef("tb1", 1, 1) })).toBe(false);
    expect(needsTable(null)).toBe(false);
  });
});
