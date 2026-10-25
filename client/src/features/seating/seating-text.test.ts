import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/http";
import type { ErrorCode } from "@shared/api/errors";
import { seatingDto, seatingMutation, seatMove, seatRef } from "@test/helpers/seating-dto";
import { changeOutcome, moveText, seatingRefusal, seatingSummary } from "./seating-text";

const refusal = (code: ErrorCode, error: string, details?: unknown) => new ApiError({ status: 409, code, error, details });

describe("seatingRefusal", () => {
  it("says how many seats are missing", () => {
    const error = refusal("INSUFFICIENT_SEATS", "Need 2 more seats: add a table", { needed: 20, available: 18 });
    expect(seatingRefusal(error, { kind: "draw", input: { scope: "unseated", includeUnconfirmed: true } })).toBe("Need 2 more seats — add a table?");
    expect(seatingRefusal(refusal("INSUFFICIENT_SEATS", "x", { needed: 10, available: 9 }))).toBe("Need 1 more seat — add a table?");
  });

  it("leaves the final table's own sentence (adding a table cannot help there)", () => {
    const error = refusal("INSUFFICIENT_SEATS", "Table 1 has 9 seats for 11 players", { needed: 11, available: 9 });
    expect(seatingRefusal(error, { kind: "finalTable", input: {} })).toBe("Table 1 has 9 seats for 11 players");
  });

  it("words a taken seat and a seating changed meanwhile as phase4-contracts §6 does", () => {
    expect(seatingRefusal(refusal("SEAT_TAKEN", "That seat is taken"))).toBe("Seat taken — tap Swap");
    expect(seatingRefusal(refusal("STALE_PLAN", "Seating changed"))).toBe("Seating changed — refreshed");
    expect(seatingRefusal(refusal("SEAT_CONFLICT", "Conflict"))).toBe("Seating changed — refreshed");
  });

  it("shows any other refusal in the server's words", () => {
    expect(seatingRefusal(refusal("TABLE_OCCUPIED", "Players sit at Table 2: break it or move them first"))).toBe("Players sit at Table 2: break it or move them first");
    expect(seatingRefusal(refusal("INSUFFICIENT_SEATS", "Need more seats", { needed: "a few" }))).toBe("Need more seats");
  });
});

describe("changeOutcome", () => {
  const seating = seatingDto({ tables: [{ id: "tA", number: 1 }, { id: "tB", number: 4, status: "broken" }] });
  const alice = seatMove("r1", "Alice", seatRef("tB", 4, 2), seatRef("tA", 1, 3), "table_broken");

  it("announces the moves the system chose, titled by what was done", () => {
    expect(changeOutcome({ kind: "breakTable", tableId: "tB", input: {} }, seatingMutation(seating, [alice]))).toEqual({
      announce: { title: "Table 4 broken", moves: [alice], excludedUnconfirmed: 0 },
      toast: null,
    });
    const drawn = changeOutcome({ kind: "draw", input: { scope: "all", includeUnconfirmed: false } }, seatingMutation(seating, [alice], { excludedUnconfirmed: 2 }));
    expect(drawn.announce).toMatchObject({ title: "Seats redrawn", excludedUnconfirmed: 2 });
  });

  it("toasts a move the TD made by hand, and a swap", () => {
    expect(changeOutcome({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: false } }, seatingMutation(seating, [alice]))).toEqual({
      announce: null,
      toast: { title: "Player moved", description: "Alice → Table 1, Seat 3" },
    });
    const bob = seatMove("r2", "Bob", seatRef("tA", 1, 3), seatRef("tB", 4, 2), "swap");
    expect(changeOutcome({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: true } }, seatingMutation(seating, [alice, bob])).toast).toEqual({
      title: "Seats swapped",
      description: "Alice and Bob swapped seats.",
    });
  });

  it("says when nothing needed doing", () => {
    expect(changeOutcome({ kind: "balance", input: {} }, seatingMutation(seating)).toast).toEqual({ title: "Tables are already balanced" });
    expect(changeOutcome({ kind: "draw", input: { scope: "unseated", includeUnconfirmed: true } }, seatingMutation(seating)).toast).toEqual({ title: "Everyone is seated" });
    expect(changeOutcome({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: false } }, seatingMutation(seating))).toEqual({ announce: null, toast: null });
  });

  it("tells a removed table from an archived one", () => {
    expect(changeOutcome({ kind: "removeTable", tableId: "tB" }, seatingMutation(seating, [], { removed: "deleted" })).toast).toEqual({ title: "Table removed" });
    expect(changeOutcome({ kind: "removeTable", tableId: "tB" }, seatingMutation(seating, [], { removed: "archived" })).toast?.title).toBe("Table archived");
  });
});

describe("words", () => {
  it("reads the seating at a glance", () => {
    const seating = seatingDto({ tables: [{ id: "tA", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Alice" } } }], unseated: [{ id: "r2", name: "Bob" }] });
    expect(seatingSummary(seating.stats)).toBe("1/9 seats · 8 open · 1 waiting");
    expect(seatingSummary({ ...seating.stats, unseated: 0 })).toBe("1/9 seats · 8 open");
  });

  it("names a move by the table's own name", () => {
    expect(moveText(seatMove("r1", "Alice", null, seatRef("tA", 1, 3, "Feature table"), "draw"))).toBe("Alice → Feature table, Seat 3");
    expect(moveText(seatMove("r1", "Alice", seatRef("tA", 1, 3), null, "unseat"))).toBe("Alice unseated");
  });
});
