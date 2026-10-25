import { describe, expect, it } from "vitest";
import { seatingDto } from "@test/helpers/seating-dto";
import { PICK_A_PLAYER_FIRST, seatingEntries, seatPress, type PressedSeat } from "./seat-selection";

const seating = seatingDto({
  tables: [
    { id: "tA", number: 1, seated: { 1: { id: "r1", name: "Alice Smith" }, 2: { id: "r2", name: "Bob Jones", paid: false } } },
    { id: "tB", number: 2, name: "Feature table", seats: 6 },
    { id: "tOld", number: 3, status: "broken" },
  ],
  unseated: [{ id: "r3", name: "Cara Lee" }],
});
const entries = seatingEntries(seating);
const at = (tableId: string, tableName: string, seatNumber: number, occupantId: string | null): PressedSeat => ({
  tableId,
  tableName,
  seatNumber,
  occupant: occupantId === null ? null : (entries.get(occupantId) ?? null),
});

describe("seatingEntries", () => {
  it("names everyone still in with their seat, or none while they wait", () => {
    expect(entries.get("r1")).toMatchObject({ name: "Alice Smith", paymentConfirmed: true, seat: { tableId: "tA", tableName: "Table 1", seatNumber: 1 } });
    expect(entries.get("r2")).toMatchObject({ paymentConfirmed: false });
    expect(entries.get("r3")).toMatchObject({ name: "Cara Lee", seat: null });
    expect(entries.size).toBe(3);
  });
});

describe("seatPress", () => {
  it("picks up the player in a seat tapped with nobody picked up", () => {
    expect(seatPress(null, at("tA", "Table 1", 1, "r1"))).toEqual({ kind: "select", registrationId: "r1" });
  });

  it("puts the player down when their own seat is tapped again", () => {
    expect(seatPress(entries.get("r1") ?? null, at("tA", "Table 1", 1, "r1"))).toEqual({ kind: "deselect" });
  });

  it("moves the player picked up (seated or waiting) to an empty seat", () => {
    expect(seatPress(entries.get("r1") ?? null, at("tB", "Feature table", 4, null))).toMatchObject({
      kind: "move",
      mover: { registrationId: "r1" },
      to: { tableId: "tB", tableName: "Feature table", seatNumber: 4 },
    });
    expect(seatPress(entries.get("r3") ?? null, at("tA", "Table 1", 5, null))).toMatchObject({ kind: "move", mover: { registrationId: "r3" } });
  });

  it("asks to swap two seated players", () => {
    expect(seatPress(entries.get("r1") ?? null, at("tA", "Table 1", 2, "r2"))).toMatchObject({
      kind: "swap",
      mover: { registrationId: "r1", seat: { seatNumber: 1 } },
      occupant: { registrationId: "r2", seat: { seatNumber: 2 } },
    });
  });

  it("says what to do instead when a waiting player is put on a taken seat, or an empty seat is tapped first", () => {
    expect(seatPress(entries.get("r3") ?? null, at("tA", "Table 1", 2, "r2"))).toEqual({
      kind: "hint",
      text: "That seat is taken. Pick an empty seat for Cara Lee, or move Bob Jones first.",
    });
    expect(seatPress(null, at("tA", "Table 1", 5, null))).toEqual({ kind: "hint", text: PICK_A_PLAYER_FIRST });
  });
});
