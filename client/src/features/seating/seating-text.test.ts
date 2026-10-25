import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/http";
import type { ErrorCode } from "@shared/api/errors";
import { seatingDto, seatingMutation, seatMove, seatRef } from "@test/helpers/seating-dto";
import { changeOutcome, failedTitle, moveText, seatingRefusal, seatingSummary, tablesText } from "./seating-text";

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
      undo: null,
    });
    const drawn = changeOutcome({ kind: "draw", input: { scope: "all", includeUnconfirmed: false } }, seatingMutation(seating, [alice], { excludedUnconfirmed: 2 }));
    expect(drawn.announce).toMatchObject({ title: "Seats redrawn", excludedUnconfirmed: 2 });
  });

  it("toasts a move the TD made by hand, and a swap, each with the change that puts it back (TDN4-UNSEAT-NO-UNDO)", () => {
    const moved = seatMove("r1", "Alice", seatRef("tB", 4, 2), seatRef("tA", 1, 3), "move");
    expect(changeOutcome({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: false } }, seatingMutation(seating, [moved]))).toEqual({
      announce: null,
      toast: { title: "Player moved", description: "Alice → Table 1, Seat 3 (from Table 4, Seat 2)" },
      undo: { kind: "assign", input: { registrationId: "r1", tableId: "tB", seatNumber: 2, swap: false, expectedVersion: seating.version }, undoing: true },
    });
    const bob = seatMove("r2", "Bob", seatRef("tA", 1, 3), seatRef("tB", 4, 2), "swap");
    const swapped = changeOutcome({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: true } }, seatingMutation(seating, [{ ...moved, reason: "swap" }, bob]));
    expect(swapped.toast).toEqual({ title: "Seats swapped", description: "Alice and Bob swapped seats." });
    expect(swapped.undo).toEqual({ kind: "assign", input: { registrationId: "r1", tableId: "tB", seatNumber: 2, swap: true, expectedVersion: seating.version }, undoing: true });
  });

  it("puts an unseated player back in the seat they left, and a player seated from the wait back to waiting", () => {
    const unseated = changeOutcome({ kind: "unseat", input: { registrationId: "r1" } }, seatingMutation(seating, [seatMove("r1", "Alice", seatRef("tA", 1, 3), null, "unseat")]));
    expect(unseated.toast).toEqual({ title: "Player unseated", description: "Alice left Table 1, Seat 3 and is waiting for a seat." });
    expect(unseated.undo).toEqual({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: false, expectedVersion: seating.version }, undoing: true });
    const seated = changeOutcome({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: false } }, seatingMutation(seating, [seatMove("r1", "Alice", null, seatRef("tA", 1, 3), "move")]));
    expect(seated.undo).toEqual({ kind: "unseat", input: { registrationId: "r1" }, undoing: true });
  });

  it("says what an Undo did, and offers no Undo of it", () => {
    const back = changeOutcome(
      { kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: false }, undoing: true },
      seatingMutation(seating, [seatMove("r1", "Alice", null, seatRef("tA", 1, 3), "move")]),
    );
    expect(back).toEqual({ announce: null, toast: { title: "Move undone", description: "Alice is back at Table 1, Seat 3." }, undo: null });
    expect(failedTitle({ kind: "unseat", input: { registrationId: "r1" }, undoing: true })).toBe("Could not undo");
    expect(failedTitle({ kind: "unseat", input: { registrationId: "r1" } })).toBe("Could not unseat the player");
  });

  it("lists who is still waiting after a break, a balance or the final table, never after a draw", () => {
    const waiting = seatingDto({ tables: [{ id: "tA", number: 1, seats: 9, seated: { 3: { id: "r1", name: "Alice" } } }], unseated: [{ id: "r9", name: "Zed", paid: false }] });
    const drawn = changeOutcome({ kind: "finalTable", input: {} }, seatingMutation(waiting, [alice]));
    expect(drawn.announce?.waiting).toEqual({ text: "1 player is waiting for a seat (1 unpaid)", names: ["Zed"], openSeats: 8 });
    expect(changeOutcome({ kind: "draw", input: { scope: "unseated", includeUnconfirmed: false } }, seatingMutation(waiting, [alice])).announce?.waiting).toBeUndefined();
  });

  it("says when nothing needed doing", () => {
    expect(changeOutcome({ kind: "balance", input: {} }, seatingMutation(seating)).toast).toEqual({ title: "Tables are already balanced" });
    expect(changeOutcome({ kind: "draw", input: { scope: "unseated", includeUnconfirmed: true } }, seatingMutation(seating)).toast).toEqual({ title: "Everyone is seated" });
    expect(changeOutcome({ kind: "assign", input: { registrationId: "r1", tableId: "tA", seatNumber: 3, swap: false } }, seatingMutation(seating))).toEqual({ announce: null, toast: null, undo: null });
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

  it("names tables together as one says them", () => {
    const table = (tableNumber: number, name: string | null = null) => ({ tableNumber, name, displayName: name ?? `Table ${tableNumber}` });
    expect(tablesText([table(3)])).toBe("Table 3");
    expect(tablesText([table(1), table(2)])).toBe("Tables 1 and 2");
    expect(tablesText([table(1), table(2), table(4)])).toBe("Tables 1, 2 and 4");
    expect(tablesText([table(1, "Feature table"), table(2)])).toBe("Feature table and Table 2");
  });

  it("names a move by the table's own name", () => {
    expect(moveText(seatMove("r1", "Alice", null, seatRef("tA", 1, 3, "Feature table"), "draw"))).toBe("Alice → Feature table, Seat 3");
    expect(moveText(seatMove("r1", "Alice", seatRef("tA", 1, 3), null, "unseat"))).toBe("Alice unseated");
  });
});
