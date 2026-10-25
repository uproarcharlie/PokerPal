import { describe, expect, it } from "vitest";
import type { TableAdviceDto } from "@shared/api/seating";
import { seatingDto, tableAdvice } from "@test/helpers/seating-dto";
import { SEATING_BADGE_REFRESH_MS, SEATING_REFRESH_MS, seatingInterval } from "../staff-hooks";
import { seatingAlert } from "./seating-tab-label";

const table = { id: "tb1", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Ann" } } };
const balance = [{ registrationId: "r1", playerName: "Ann", from: null, to: null, reason: "balance" as const }];

describe("seatingAlert", () => {
  it("says the table advisor's first piece of advice in a word or two (round 5)", () => {
    const advised = (kind: TableAdviceDto["kind"]) => seatingAlert(seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob" }], advisor: { advice: [tableAdvice(kind, "…")] } }));
    expect(advised("open_table")).toBe("Open a table");
    expect(advised("final_table")).toBe("Final table");
    expect(advised("break_table")).toBe("Break a table");
    expect(advised("seat_waiting")).toBe("1 waiting");
    expect(advised("balance")).toBe("Uneven");
  });

  it("counts the players waiting for a seat while tables are in play, even with no advice (TDN2-WAITING-NOT-FLAGGED)", () => {
    expect(seatingAlert(seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob" }, { id: "r3", name: "Cat" }] }))).toBe("2 waiting");
    expect(seatingAlert(seatingDto({ tables: [table], advisor: { advice: [tableAdvice("balance", "…", { moves: balance })] } }))).toBe("Uneven");
    expect(seatingAlert(seatingDto({ tables: [table] }))).toBeNull();
  });

  it("says nothing of players without a seat before any table is in play, nor once the game is over", () => {
    expect(seatingAlert(seatingDto({ unseated: [{ id: "r2", name: "Bob" }] }))).toBeNull();
    expect(seatingAlert(seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob" }], readOnly: true, advisor: { advice: [tableAdvice("seat_waiting", "…")] } }))).toBeNull();
  });

  it("leaves out the unpaid players the TD holds back with Paid players only (TDN3-PAIDONLY-RESET)", () => {
    const seatWaiting = { advisor: { advice: [tableAdvice("seat_waiting", "…")] } };
    const waiting = seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob", paid: false }, { id: "r3", name: "Cat" }], ...seatWaiting });
    expect(seatingAlert(waiting)).toBe("2 waiting");
    expect(seatingAlert(waiting, { paidOnly: true })).toBe("1 waiting");
    expect(seatingAlert(seatingDto({ tables: [table], unseated: [{ id: "r2", name: "Bob", paid: false }], ...seatWaiting }), { paidOnly: true })).toBeNull();
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
