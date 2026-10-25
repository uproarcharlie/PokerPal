import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./hash";
import {
  activeTables,
  applyMoves,
  openSeats,
  planAssign,
  planBalance,
  planBreak,
  planDraw,
  planFinalTable,
  planRedrawAll,
  planRestore,
  planUnseat,
  RELEASE_REASON,
  RELEASE_REASONS,
  seatingProblems,
  seatingVersion,
  shuffle,
  suggestTables,
  tableStats,
  waitingPlayers,
  waitingText,
  type SeatingPlan,
  type SeatingSnapshot,
  type SeatMove,
  type SeatPos,
  type SeatTable,
} from "./seating";

const table = (n: number, seatCount = 9, status: SeatTable["status"] = "active"): SeatTable => ({ id: `t${n}`, tableNumber: n, seatCount, status });
const players = (count: number, from = 1) => Array.from({ length: count }, (_, i) => ({ registrationId: `r${from + i}`, paymentConfirmed: (from + i) % 3 !== 0 }));
const ids = (count: number, from = 1) => players(count, from).map((player) => player.registrationId);
const seat = (registrationId: string, tableNumber: number, seatNumber: number): SeatPos => ({ registrationId, tableId: `t${tableNumber}`, seatNumber });

function snapshot(tables: SeatTable[], seats: SeatPos[], eligibleCount: number): SeatingSnapshot {
  return { tables, seats, eligible: players(eligibleCount) };
}

/** The moves of a plan that must succeed. */
function movesOf(plan: SeatingPlan): SeatMove[] {
  if (!plan.ok) throw new Error(`expected a plan, got ${plan.problem}: ${plan.message}`);
  return plan.moves;
}

/** The tables after a plan's archives. */
const afterArchive = (tables: SeatTable[], plan: SeatingPlan) =>
  tables.map((candidate) => (plan.ok && plan.archiveTableIds.includes(candidate.id) ? { ...candidate, status: "broken" as const } : candidate));

/** Seats `count` players r1..rN into `tables` with a seeded draw. */
function drawn(tables: SeatTable[], count: number, seed = 1): SeatingSnapshot {
  const empty = snapshot(tables, [], count);
  const plan = planDraw(empty, ids(count), mulberry32(seed));
  return { ...empty, seats: applyMoves([], movesOf(plan), tables) };
}

const spread = (s: SeatingSnapshot) => tableStats(s).maxDiff;

describe("release reasons", () => {
  it("cover every reason a seat is left for, and match the database's list", () => {
    expect(new Set(Object.values(RELEASE_REASON))).toEqual(new Set(RELEASE_REASONS));
  });
});

describe("shuffle", () => {
  it("keeps every item and does not change the original", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const shuffled = shuffle(items, mulberry32(7));
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shuffle(items, mulberry32(7))).toEqual(shuffled);
  });
});

describe("suggestTables", () => {
  it("spreads players as evenly as tables allow", () => {
    expect(suggestTables(22, 9)).toEqual({ tableCount: 3, perTable: [8, 7, 7] });
    expect(suggestTables(18, 9)).toEqual({ tableCount: 2, perTable: [9, 9] });
    expect(suggestTables(19, 9)).toEqual({ tableCount: 3, perTable: [7, 6, 6] });
    expect(suggestTables(0, 9)).toEqual({ tableCount: 1, perTable: [0] });
    expect(suggestTables(5, 0)).toEqual({ tableCount: 5, perTable: [1, 1, 1, 1, 1] });
  });
});

describe("seatingVersion", () => {
  it("is the same whatever order tables and seats come in, and changes with any seat", () => {
    const s = drawn([table(1), table(2)], 12);
    const version = seatingVersion(s);
    expect(version).toMatch(/^[0-9a-f]{8}$/);
    expect(seatingVersion({ ...s, tables: [...s.tables].reverse(), seats: [...s.seats].reverse(), eligible: [...s.eligible].reverse() })).toBe(version);
    expect(seatingVersion({ ...s, seats: s.seats.slice(1) })).not.toBe(version);
    expect(seatingVersion({ ...s, tables: [table(1), table(2, 8)] })).not.toBe(version);
    expect(seatingVersion({ ...s, tables: [...s.tables, table(3, 9, "broken")] })).toBe(version);
  });

  it("changes when a player joins or leaves the players waiting, or pays, so Open Table applies only the plan shown (R5REV-HOST-07)", () => {
    const s = drawn([table(1, 2)], 2);
    const waiting = { ...s, eligible: [...s.eligible, { registrationId: "late", paymentConfirmed: false }] };
    expect(seatingVersion(waiting)).not.toBe(seatingVersion(s));
    expect(seatingVersion({ ...waiting, eligible: [...s.eligible, { registrationId: "late", paymentConfirmed: true }] })).not.toBe(seatingVersion(waiting));
    expect(seatingVersion({ ...waiting, eligible: [...s.eligible, { registrationId: "other", paymentConfirmed: false }] })).not.toBe(seatingVersion(waiting));
    // A seated player's payment is not part of it: only who waits, and whether they have paid.
    expect(seatingVersion({ ...s, eligible: s.eligible.map((entry) => ({ ...entry, paymentConfirmed: !entry.paymentConfirmed })) })).toBe(seatingVersion(s));
  });
});

describe("openSeats and tableStats", () => {
  it("list each active table's empty seats and count the room", () => {
    const tables = [table(2, 4), table(1, 3), table(3, 6, "broken")];
    const seats = [seat("r1", 1, 2), seat("r2", 2, 1), seat("r3", 2, 4)];
    expect(activeTables(tables).map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(openSeats(tables, seats)).toEqual(new Map([["t1", [1, 3]], ["t2", [2, 3]]]));
    expect(tableStats({ tables, seats, eligible: players(5) })).toEqual({
      perTable: [
        { tableId: "t1", tableNumber: 1, occupied: 1, capacity: 3 },
        { tableId: "t2", tableNumber: 2, occupied: 2, capacity: 4 },
      ],
      activePlayers: 5,
      seated: 3,
      unseated: 2,
      openSeats: 4,
      capacity: 7,
      activeTables: 2,
      maxDiff: 1,
    });
    expect(tableStats({ tables: [table(1)], seats: [], eligible: [] }).maxDiff).toBe(0);
  });
});

describe("planDraw", () => {
  it("seats everyone, as evenly as the tables allow, in seats that exist", () => {
    for (let count = 2; count <= 60; count += 3) {
      for (const seats of [2, 6, 9, 10]) {
        const tables = Array.from({ length: suggestTables(count, seats).tableCount }, (_, i) => table(i + 1, seats));
        const s = drawn(tables, count, count * seats);
        expect(seatingProblems(tables, s.seats)).toEqual([]);
        expect(s.seats).toHaveLength(count);
        expect(spread(s)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("skips players already seated, so a repeated tap changes nothing", () => {
    const s = drawn([table(1), table(2)], 10);
    expect(movesOf(planDraw(s, ids(10), mulberry32(2)))).toEqual([]);
    const withNew = { ...s, eligible: players(11) };
    expect(movesOf(planDraw(withNew, ids(11), mulberry32(2)))).toEqual([expect.objectContaining({ registrationId: "r11", from: null, reason: "draw" })]);
  });

  it("is all or nothing when there are not enough seats", () => {
    expect(planDraw(snapshot([table(1, 6)], [], 8), ids(8), mulberry32(1))).toEqual({
      ok: false,
      problem: "INSUFFICIENT_SEATS",
      message: "Need 2 more seats: add a table",
      details: { needed: 8, available: 6 },
    });
  });

  it("needs a table, and players who are still in", () => {
    expect(planDraw(snapshot([table(1, 9, "broken")], [], 3), ids(3), mulberry32(1))).toMatchObject({ ok: false, problem: "NO_TABLES" });
    expect(planDraw(snapshot([table(1)], [], 3), ["r9"], mulberry32(1))).toMatchObject({ ok: false, problem: "PLAYER_NOT_ACTIVE", details: { registrationId: "r9" } });
    expect(movesOf(planDraw(snapshot([], [], 3), [], mulberry32(1)))).toEqual([]);
  });

  it("fills the emptiest table first", () => {
    const s = snapshot([table(1, 9), table(2, 9)], [seat("r1", 1, 1), seat("r2", 1, 2), seat("r3", 1, 3)], 5);
    const moves = movesOf(planDraw(s, ["r4", "r5"], mulberry32(3)));
    expect(moves.map((move) => move.to?.tableId)).toEqual(["t2", "t2"]);
  });

  it("is the same draw for the same random numbers", () => {
    const s = snapshot([table(1), table(2)], [], 14);
    expect(planDraw(s, ids(14), mulberry32(9))).toEqual(planDraw(s, ids(14), mulberry32(9)));
  });
});

describe("planRedrawAll", () => {
  it("moves each player once, from their old seat to their new one", () => {
    const tables = [table(1), table(2)];
    const s = drawn(tables, 12);
    const moves = movesOf(planRedrawAll(s, ids(12), mulberry32(5)));
    for (const move of moves) {
      expect(move.reason).toBe("redraw");
      expect(move.from).toEqual(expect.objectContaining({ tableId: expect.any(String) }));
    }
    const after = applyMoves(s.seats, moves, tables);
    expect(after).toHaveLength(12);
    expect(spread({ ...s, seats: after })).toBeLessThanOrEqual(1);
  });

  it("seats unseated players too, and refuses when they cannot all fit", () => {
    const s = snapshot([table(1, 4)], [seat("r1", 1, 1)], 3);
    const moves = movesOf(planRedrawAll(s, ids(3), mulberry32(1)));
    expect(moves.filter((move) => move.from === null).map((move) => move.registrationId).sort()).toEqual(["r2", "r3"]);
    expect(planRedrawAll(snapshot([table(1, 2)], [], 3), ids(3), mulberry32(1))).toMatchObject({ ok: false, problem: "INSUFFICIENT_SEATS", details: { needed: 3, available: 2 } });
    expect(planRedrawAll(snapshot([], [], 3), ids(3), mulberry32(1))).toMatchObject({ ok: false, problem: "NO_TABLES" });
    expect(planRedrawAll(s, ["r7"], mulberry32(1))).toMatchObject({ ok: false, problem: "PLAYER_NOT_ACTIVE" });
    expect(movesOf(planRedrawAll(s, [], mulberry32(1)))).toEqual([]);
  });
});

describe("planBalance", () => {
  it("evens the tables out to one apart, deterministically", () => {
    // Table 1: 9 players, table 2: 5.
    const seats = [...ids(9).map((id, i) => seat(id, 1, i + 1)), ...ids(5, 10).map((id, i) => seat(id, 2, i + 1))];
    const s: SeatingSnapshot = { tables: [table(1), table(2)], seats, eligible: players(14) };
    const moves = planBalance(s);
    expect(moves).toEqual([
      { registrationId: "r9", from: { tableId: "t1", seatNumber: 9 }, to: { tableId: "t2", seatNumber: 6 }, reason: "balance" },
      { registrationId: "r8", from: { tableId: "t1", seatNumber: 8 }, to: { tableId: "t2", seatNumber: 7 }, reason: "balance" },
    ]);
    expect(planBalance(s)).toEqual(moves);
    expect(spread({ ...s, seats: applyMoves(seats, moves, s.tables) })).toBe(0);
  });

  it("moves nothing when the tables are already within one", () => {
    expect(planBalance(drawn([table(1), table(2), table(3)], 20))).toEqual([]);
    expect(planBalance(drawn([table(1)], 5))).toEqual([]);
  });

  it("takes from the highest-numbered of equally full tables and gives to the lowest-numbered of equally empty ones", () => {
    const seats = [seat("a", 1, 1), seat("b", 1, 2), seat("c", 1, 3), seat("d", 3, 1), seat("e", 3, 2), seat("f", 3, 3)];
    const s: SeatingSnapshot = { tables: [table(1), table(2), table(3), table(4)], seats, eligible: ["a", "b", "c", "d", "e", "f"].map((registrationId) => ({ registrationId, paymentConfirmed: true })) };
    expect(planBalance(s)).toEqual([
      { registrationId: "f", from: { tableId: "t3", seatNumber: 3 }, to: { tableId: "t2", seatNumber: 1 }, reason: "balance" },
      { registrationId: "c", from: { tableId: "t1", seatNumber: 3 }, to: { tableId: "t4", seatNumber: 1 }, reason: "balance" },
    ]);
  });

  it("stops when the emptier tables have no room", () => {
    const s: SeatingSnapshot = {
      tables: [table(1, 2), table(2, 6)],
      seats: [seat("a", 1, 1), seat("b", 1, 2), ...["c", "d", "e", "f", "g", "h"].map((id, i) => seat(id, 2, i + 1))],
      eligible: [],
    };
    expect(planBalance(s)).toEqual([]);
  });
});

describe("breaking a table", () => {
  it("moves its players to the other tables and archives it", () => {
    const tables = [table(1), table(2), table(3)];
    const s = drawn(tables, 16);
    const plan = planBreak(s, "t2", mulberry32(4));
    const moves = movesOf(plan);
    expect(plan).toMatchObject({ archiveTableIds: ["t2"] });
    expect(moves.every((move) => move.from?.tableId === "t2" && move.to?.tableId !== "t2" && move.reason === "table_broken")).toBe(true);
    const after = applyMoves(s.seats, moves, afterArchive(tables, plan));
    expect(after).toHaveLength(16);
  });

  it("refuses the last table, a table not in play, and a break the others cannot hold", () => {
    expect(planBreak(drawn([table(1)], 4), "t1", mulberry32(1))).toMatchObject({ ok: false, problem: "LAST_TABLE" });
    expect(planBreak(drawn([table(1), table(2, 9, "broken")], 4), "t2", mulberry32(1))).toMatchObject({ ok: false, problem: "TABLE_NOT_ACTIVE" });
    expect(planBreak(drawn([table(1), table(2)], 14), "t1", mulberry32(1))).toMatchObject({ ok: false, problem: "INSUFFICIENT_SEATS", details: { needed: 7, available: 2 } });
  });
});

describe("the final table", () => {
  it("redraws everyone at one table and archives the rest", () => {
    const tables = [table(1), table(2), table(3)];
    const s = drawn(tables, 9);
    const plan = planFinalTable(s, null, mulberry32(8));
    expect(plan).toMatchObject({ ok: true, archiveTableIds: ["t2", "t3"] });
    const after = applyMoves(s.seats, movesOf(plan), afterArchive(tables, plan));
    expect(after.every((seatPos) => seatPos.tableId === "t1")).toBe(true);
    expect(after).toHaveLength(9);
    expect(movesOf(plan).every((move) => move.reason === "final_table")).toBe(true);
  });

  it("seats anyone waiting only when asked, redraws at the only table, and refuses what cannot fit", () => {
    const one = snapshot([table(1, 6)], [seat("r1", 1, 1)], 3);
    const seatedOnly = applyMoves(one.seats, movesOf(planFinalTable(one, null, mulberry32(2))), one.tables);
    expect(seatedOnly.map((seatPos) => seatPos.registrationId)).toEqual(["r1"]);
    const everyone = applyMoves(one.seats, movesOf(planFinalTable(one, null, mulberry32(2), true)), one.tables);
    expect(everyone.map((seatPos) => seatPos.registrationId).sort()).toEqual(["r1", "r2", "r3"]);
    expect(planFinalTable(drawn([table(1, 6), table(2, 6)], 8), "t1", mulberry32(1))).toMatchObject({ ok: false, problem: "INSUFFICIENT_SEATS", details: { needed: 8, available: 6 } });
    expect(planFinalTable(drawn([table(1), table(2)], 12), null, mulberry32(1))).toMatchObject({ ok: false, problem: "INSUFFICIENT_SEATS" });
    expect(planFinalTable(drawn([table(1), table(2)], 4), "t9", mulberry32(1))).toMatchObject({ ok: false, problem: "TABLE_NOT_ACTIVE" });
    expect(planFinalTable(snapshot([], [], 2), null, mulberry32(1))).toMatchObject({ ok: false, problem: "NO_TABLES" });
  });
});

describe("players waiting for a seat (TDN3-FINAL-TABLE-WAITING)", () => {
  // 8 players at two 9-seat tables (4 and 4), and two sign-ups still in with no seat (r9 unpaid, r10 paid).
  const tables = [table(1), table(2)];
  const seated = drawn(tables, 8);
  const waiting: SeatingSnapshot = { ...seated, eligible: [...seated.eligible, { registrationId: "r9", paymentConfirmed: false }, { registrationId: "r10", paymentConfirmed: true }] };

  it("are what tableStats counts, by the same rule (R4-CQ-06)", () => {
    expect(tableStats(waiting).unseated).toBe(2);
    // A seat whose player is no longer in (as a plan stages it) seats nobody else: r3 and r4 still wait.
    const staged: SeatingSnapshot = { tables: [table(1, 4)], seats: [seat("r1", 1, 1), seat("r2", 1, 2), seat("gone", 1, 3)], eligible: players(4) };
    expect(waitingPlayers(staged).map((player) => player.registrationId)).toEqual(["r3", "r4"]);
    expect(tableStats(staged)).toMatchObject({ seated: 3, unseated: 2 });
  });

  it("are the players still in with no seat", () => {
    expect(waitingPlayers(waiting).map((player) => player.registrationId)).toEqual(["r9", "r10"]);
  });

  it("stay waiting when the final table is drawn, unless the TD includes them", () => {
    const plan = planFinalTable(waiting, null, mulberry32(3));
    const after = applyMoves(waiting.seats, movesOf(plan), afterArchive(tables, plan));
    expect(after.map((seatPos) => seatPos.registrationId).sort()).toEqual(ids(8).sort());
    expect(movesOf(plan).every((move) => move.from !== null)).toBe(true);

    // 7 seated and the same two waiting fit at one table together.
    const fewer: SeatingSnapshot = { ...drawn(tables, 7), eligible: [...players(7), ...waiting.eligible.slice(8)] };
    const included = planFinalTable(fewer, null, mulberry32(3), true);
    const all = applyMoves(fewer.seats, movesOf(included), afterArchive(tables, included));
    expect(all.map((seatPos) => seatPos.registrationId).sort()).toEqual([...ids(7), "r9", "r10"].sort());
    expect(all.every((seatPos) => seatPos.tableId === "t1")).toBe(true);
  });

  it("count in the size check only when included", () => {
    const full = { ...drawn(tables, 9), eligible: [...players(9), { registrationId: "r10", paymentConfirmed: false }] };
    expect(planFinalTable(full, null, mulberry32(1))).toMatchObject({ ok: true });
    expect(planFinalTable(full, null, mulberry32(1), true)).toMatchObject({
      ok: false,
      problem: "INSUFFICIENT_SEATS",
      message: "Everyone still in does not fit at one table yet",
      details: { needed: 10, available: 9 },
    });
    expect(planFinalTable(full, "t1", mulberry32(1), true)).toMatchObject({ ok: false, message: "Table 1 has 9 seats for 10 players" });
  });

  it("are said in a sentence", () => {
    expect(waitingText(2, 1)).toBe("2 players are waiting for a seat (1 unpaid)");
    expect(waitingText(1, 0)).toBe("1 player is waiting for a seat");
    expect(waitingText(0, 0)).toBeNull();
  });
});

describe("planAssign", () => {
  const s = snapshot([table(1, 6), table(2, 6), table(3, 6, "broken")], [seat("r1", 1, 1), seat("r2", 1, 2)], 3);

  it("moves a player to an empty seat, or seats a player who has none", () => {
    expect(movesOf(planAssign(s, "r1", "t2", 4, false))).toEqual([{ registrationId: "r1", from: { tableId: "t1", seatNumber: 1 }, to: { tableId: "t2", seatNumber: 4 }, reason: "move" }]);
    expect(movesOf(planAssign(s, "r3", "t2", 4, false))).toEqual([{ registrationId: "r3", from: null, to: { tableId: "t2", seatNumber: 4 }, reason: "move" }]);
  });

  it("swaps two seated players only when asked", () => {
    expect(planAssign(s, "r1", "t1", 2, false)).toMatchObject({ ok: false, problem: "SEAT_TAKEN", details: { occupantRegistrationId: "r2" } });
    const moves = movesOf(planAssign(s, "r1", "t1", 2, true));
    expect(moves).toEqual([
      { registrationId: "r1", from: { tableId: "t1", seatNumber: 1 }, to: { tableId: "t1", seatNumber: 2 }, reason: "swap" },
      { registrationId: "r2", from: { tableId: "t1", seatNumber: 2 }, to: { tableId: "t1", seatNumber: 1 }, reason: "swap" },
    ]);
    expect(applyMoves(s.seats, moves, s.tables)).toEqual([seat("r1", 1, 2), seat("r2", 1, 1)]);
    expect(planAssign(s, "r3", "t1", 1, true)).toMatchObject({ ok: false, problem: "NOT_SEATED" });
  });

  it("does nothing for the player's own seat, and refuses bad targets", () => {
    expect(movesOf(planAssign(s, "r1", "t1", 1, true))).toEqual([]);
    expect(planAssign(s, "r9", "t1", 3, false)).toMatchObject({ ok: false, problem: "PLAYER_NOT_ACTIVE" });
    expect(planAssign(s, "r1", "t3", 3, false)).toMatchObject({ ok: false, problem: "TABLE_NOT_ACTIVE" });
    expect(planAssign(s, "r1", "t1", 7, false)).toMatchObject({ ok: false, problem: "SEAT_OUT_OF_RANGE", message: "Table 1 has seats 1 to 6" });
    expect(planAssign(s, "r1", "t1", 0, false)).toMatchObject({ ok: false, problem: "SEAT_OUT_OF_RANGE" });
  });
});

describe("planUnseat and planRestore", () => {
  const s = snapshot([table(1, 6), table(2, 6, "broken")], [seat("r1", 1, 1), seat("r2", 1, 2)], 3);

  it("unseat a seated player, idempotently", () => {
    expect(movesOf(planUnseat(s, "r1"))).toEqual([{ registrationId: "r1", from: { tableId: "t1", seatNumber: 1 }, to: null, reason: "unseat" }]);
    expect(movesOf(planUnseat(s, "r3"))).toEqual([]);
  });

  it("put a player back in their old seat only while it is free and in play", () => {
    expect(planRestore(s, "r3", { tableId: "t1", seatNumber: 5 })).toEqual({ registrationId: "r3", from: null, to: { tableId: "t1", seatNumber: 5 }, reason: "restored" });
    expect(planRestore(s, "r3", { tableId: "t1", seatNumber: 2 })).toBeNull(); // taken
    expect(planRestore(s, "r3", { tableId: "t2", seatNumber: 1 })).toBeNull(); // table broken
    expect(planRestore(s, "r3", { tableId: "t1", seatNumber: 7 })).toBeNull(); // table shrunk
    expect(planRestore(s, "r1", { tableId: "t1", seatNumber: 5 })).toBeNull(); // already seated
    expect(planRestore(s, "r9", { tableId: "t1", seatNumber: 5 })).toBeNull(); // not in
    expect(planRestore(s, "r3", null)).toBeNull(); // never seated
  });
});

describe("applyMoves and seatingProblems", () => {
  const tables = [table(1, 4), table(2, 4, "broken")];

  it("refuse a move from a seat the player is not in", () => {
    expect(() => applyMoves([seat("r1", 1, 1)], [{ registrationId: "r1", from: { tableId: "t1", seatNumber: 2 }, to: null, reason: "move" }], tables)).toThrow(/^INVARIANT/);
  });

  it("refuse a doubled seat or player, a seat past the table, and a table not in play", () => {
    expect(() => applyMoves([seat("r1", 1, 1)], [{ registrationId: "r2", from: null, to: { tableId: "t1", seatNumber: 1 }, reason: "draw" }], tables)).toThrow(/taken twice/);
    expect(seatingProblems(tables, [seat("r1", 1, 1), seat("r1", 1, 2)])).toEqual(["registration r1 has two seats"]);
    expect(seatingProblems(tables, [seat("r1", 1, 5)])).toEqual(["seat t1:5 is past the table's 4 seats"]);
    expect(seatingProblems(tables, [seat("r1", 2, 1)])).toEqual(["seat t2:1 is on a table not in play"]);
  });
});

describe("any sequence of seating changes", () => {
  type Step =
    | { kind: "join" }
    | { kind: "draw" }
    | { kind: "bust"; pick: number }
    | { kind: "restore"; pick: number }
    | { kind: "move"; pick: number; table: number; seat: number; swap: boolean }
    | { kind: "balance" }
    | { kind: "break"; table: number }
    | { kind: "final" }
    | { kind: "add" };

  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.constant<Step>({ kind: "join" }),
    fc.constant<Step>({ kind: "draw" }),
    fc.record({ kind: fc.constant("bust" as const), pick: fc.nat() }),
    fc.record({ kind: fc.constant("restore" as const), pick: fc.nat() }),
    fc.record({ kind: fc.constant("move" as const), pick: fc.nat(), table: fc.nat(), seat: fc.integer({ min: 1, max: 10 }), swap: fc.boolean() }),
    fc.constant<Step>({ kind: "balance" }),
    fc.record({ kind: fc.constant("break" as const), table: fc.nat() }),
    fc.constant<Step>({ kind: "final" }),
    fc.constant<Step>({ kind: "add" }),
  );

  it("keeps every seat unique, inside its table, on a table in play, and each player in at most one seat", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), fc.integer(), fc.integer({ min: 2, max: 10 }), (steps, seed, seatCount) => {
        const rng = mulberry32(seed);
        let tables: SeatTable[] = [table(1, seatCount), table(2, seatCount)];
        let seats: SeatPos[] = [];
        let joined = 6;
        const out = new Set<string>();
        const lastSeat = new Map<string, { tableId: string; seatNumber: number }>();
        const eligible = () => players(joined).filter((player) => !out.has(player.registrationId));
        const state = (): SeatingSnapshot => ({ tables, seats, eligible: eligible() });
        const apply = (plan: SeatingPlan) => {
          if (!plan.ok) return;
          tables = afterArchive(tables, plan);
          seats = applyMoves(seats, plan.moves, tables);
        };

        for (const action of steps) {
          const inPlay = eligible().map((player) => player.registrationId);
          switch (action.kind) {
            case "join":
              joined += 1;
              break;
            case "draw":
              apply(planDraw(state(), inPlay, rng));
              break;
            case "bust": {
              const id = inPlay[action.pick % Math.max(inPlay.length, 1)];
              if (!id) break;
              const current = seats.find((seatPos) => seatPos.registrationId === id);
              if (current) lastSeat.set(id, { tableId: current.tableId, seatNumber: current.seatNumber });
              out.add(id);
              seats = seats.filter((seatPos) => seatPos.registrationId !== id);
              break;
            }
            case "restore": {
              const busted = Array.from(out);
              const id = busted[action.pick % Math.max(busted.length, 1)];
              if (!id) break;
              out.delete(id);
              const move = planRestore(state(), id, lastSeat.get(id) ?? null);
              if (move) seats = applyMoves(seats, [move], tables);
              break;
            }
            case "move": {
              const id = inPlay[action.pick % Math.max(inPlay.length, 1)];
              const target = activeTables(tables)[action.table % Math.max(activeTables(tables).length, 1)];
              if (id && target) apply(planAssign(state(), id, target.id, action.seat, action.swap));
              break;
            }
            case "balance":
              seats = applyMoves(seats, planBalance(state()), tables);
              expect(tableStats(state()).maxDiff <= 1 || activeTables(tables).some((t) => seats.filter((s) => s.tableId === t.id).length === t.seatCount)).toBe(true);
              break;
            case "break": {
              const target = activeTables(tables)[action.table % Math.max(activeTables(tables).length, 1)];
              if (target) apply(planBreak(state(), target.id, rng));
              break;
            }
            case "final":
              apply(planFinalTable(state(), null, rng));
              break;
            case "add": {
              const next = Math.max(...tables.map((t) => t.tableNumber)) + 1;
              tables = [...tables, table(next, seatCount)];
              break;
            }
          }
          expect(seatingProblems(tables, seats)).toEqual([]);
          const inIds = new Set(eligible().map((player) => player.registrationId));
          expect(seats.every((seatPos) => inIds.has(seatPos.registrationId))).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
