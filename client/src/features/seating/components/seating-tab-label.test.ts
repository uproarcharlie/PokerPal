import { describe, expect, it } from "vitest";
import { seatingDto } from "@test/helpers/seating-dto";
import { SEATING_BADGE_REFRESH_MS, SEATING_REFRESH_MS, seatingInterval } from "../staff-hooks";
import { seatingAlert } from "./seating-tab-label";

const table = { id: "tb1", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Ann" } } };
const balance = [{ registrationId: "r1", playerName: "Ann", from: null, to: null, reason: "balance" as const }];

describe("seatingAlert", () => {
  it("counts the players waiting for a seat while tables are in play, before an uneven table (TDN2-WAITING-NOT-FLAGGED)", () => {
    expect(seatingAlert(seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob" }, { id: "r3", name: "Cat" }], suggestions: { balance } }))).toBe("2 waiting");
    expect(seatingAlert(seatingDto({ tables: [table], suggestions: { balance } }))).toBe("Uneven");
    expect(seatingAlert(seatingDto({ tables: [table] }))).toBeNull();
  });

  it("says nothing of players without a seat before any table is in play, nor once the game is over", () => {
    expect(seatingAlert(seatingDto({ unseated: [{ id: "r2", name: "Bob" }] }))).toBeNull();
    expect(seatingAlert(seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob" }], readOnly: true }))).toBeNull();
  });

  it("leaves out the unpaid players the TD holds back with Paid players only (TDN3-PAIDONLY-RESET)", () => {
    const waiting = seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob", paid: false }, { id: "r3", name: "Cat" }] });
    expect(seatingAlert(waiting)).toBe("2 waiting");
    expect(seatingAlert(waiting, { paidOnly: true })).toBe("1 waiting");
    expect(seatingAlert(seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob", paid: false }] }), { paidOnly: true })).toBeNull();
  });

  it("puts a final table and a table to break first", () => {
    const waiting = { tables: [table], unseated: [{ id: "r2", name: "Bob" }] };
    expect(seatingAlert(seatingDto({ ...waiting, suggestions: { finalTable: { tableId: "tb1", tableNumber: 1 } } }))).toBe("Final table");
    expect(seatingAlert(seatingDto({ ...waiting, suggestions: { breakTable: { tableId: "tb1", tableNumber: 1, playersToMove: 1 } } }))).toBe("Break a table");
  });
});

describe("seatingInterval", () => {
  it("follows the seating every 10 s on its tab, and every 30 s on the badge only while tables are in play (TDN3-BADGE-STALE-OTHER-DEVICE)", () => {
    expect(seatingInterval(seatingDto({}))).toBe(SEATING_REFRESH_MS);
    expect(seatingInterval(seatingDto({ tables: [table] }), "badge")).toBe(SEATING_BADGE_REFRESH_MS);
    expect(seatingInterval(seatingDto({}), "badge")).toBe(false);
    expect(seatingInterval(seatingDto({ tables: [table], readOnly: true }), "badge")).toBe(false);
    expect(seatingInterval(undefined)).toBe(false);
  });
});
