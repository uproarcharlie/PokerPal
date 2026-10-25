import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./hash";
import { applyMoves, planBalance, type EligiblePlayer, type SeatingSnapshot, type SeatPos, type SeatTable } from "./seating";
import {
  adviseTables,
  AUTO_SEAT_LABELS,
  AUTO_SEAT_MODES,
  autoSeatDecision,
  DEFAULT_STARTING_TABLES,
  isAutoSeatMode,
  lateRegistrationOpen,
  NEW_TABLE_ID,
  nextTableNumber,
  openTableRng,
  planAutoSeat,
  planOpenTable,
  resolveSeatingSettings,
  seatingSettingsProblem,
  setupTableCount,
  type AdvisorContext,
  type SeatingSettings,
  type SeatingSettingsInput,
} from "./table-advisor";

const settings = (tournament: Partial<SeatingSettingsInput["tournament"]> = {}, club: SeatingSettingsInput["club"] = null): SeatingSettings =>
  resolveSeatingSettings({ tournament: { maxPlayers: 40, ...tournament }, club });

const tableOf = (number: number, seatCount = 9, status: SeatTable["status"] = "active"): SeatTable => ({ id: `t${number}`, tableNumber: number, seatCount, status });

interface Room {
  /** Players at each active table, seated from seat 1 up. */
  tables: number[];
  seats?: number | number[];
  waiting?: number;
  /** Of the waiting, how many have not paid. */
  unpaid?: number;
  /** Archived tables (numbers after the active ones). */
  broken?: number;
}

/** A room: tables T1..Tn holding the given numbers of players (in their lowest seats), and players waiting w1..wN (the unpaid last). */
function room({ tables, seats = 9, waiting = 0, unpaid = 0, broken = 0 }: Room): SeatingSnapshot {
  const sizes = Array.isArray(seats) ? seats : tables.map(() => seats);
  const active = tables.map((_, i) => tableOf(i + 1, sizes[i]));
  const archived = Array.from({ length: broken }, (_, i) => tableOf(tables.length + i + 1, 9, "broken"));
  const seated: SeatPos[] = tables.flatMap((count, i) => Array.from({ length: count }, (_, k) => ({ registrationId: `t${i + 1}p${k + 1}`, tableId: `t${i + 1}`, seatNumber: k + 1 })));
  const eligible: EligiblePlayer[] = [
    ...seated.map((seat) => ({ registrationId: seat.registrationId, paymentConfirmed: true })),
    ...Array.from({ length: waiting }, (_, i) => ({ registrationId: `w${i + 1}`, paymentConfirmed: i < waiting - unpaid })),
  ];
  return { tables: [...active, ...archived], seats: seated, eligible };
}

const sizesAfter = (snapshot: SeatingSnapshot, plan: { moves: Parameters<typeof applyMoves>[1] }, extra: SeatTable[] = []) => {
  const tables = [...snapshot.tables, ...extra];
  const seats = applyMoves(snapshot.seats, plan.moves, tables);
  return tables.filter((table) => table.status === "active").sort((a, b) => a.tableNumber - b.tableNumber).map((table) => seats.filter((seat) => seat.tableId === table.id).length);
};

describe("seating settings", () => {
  it("default to 9 seats, 2 starting tables, the next table when every table is full, seating on sign-up, ovals", () => {
    expect(settings()).toEqual({
      seatsPerTable: 9,
      startingTables: 2,
      openTableAt: 9,
      autoSeat: "on_register",
      tableShape: "oval",
      maxPlayers: 40,
      maxTables: 5,
    });
    expect(DEFAULT_STARTING_TABLES).toBe(2);
    expect(AUTO_SEAT_MODES).toEqual(["on_register", "once_paid", "off"]);
    expect(Object.keys(AUTO_SEAT_LABELS)).toEqual([...AUTO_SEAT_MODES]);
    expect(isAutoSeatMode("once_paid")).toBe(true);
    expect(isAutoSeatMode("later")).toBe(false);
  });

  it("take the club's defaults (Central Stars: 9-seat rectangles) under the tournament's own", () => {
    const club = { defaultSeatsPerTable: 9, defaultTableShape: "rectangle" as const };
    expect(settings({}, club)).toMatchObject({ seatsPerTable: 9, tableShape: "rectangle" });
    expect(settings({ seatsPerTable: 6, tableShape: "round", openTableAt: 5, startingTables: 3, autoSeat: "once_paid" }, club)).toEqual({
      seatsPerTable: 6,
      startingTables: 3,
      openTableAt: 5,
      autoSeat: "once_paid",
      tableShape: "round",
      maxPlayers: 40,
      maxTables: 7,
    });
  });

  it("read a stored value out of range as unset", () => {
    expect(settings({ seatsPerTable: 11, startingTables: 0, openTableAt: 12, autoSeat: "later", tableShape: "hexagon" }, { defaultSeatsPerTable: 1, defaultTableShape: null })).toEqual(settings());
    expect(settings({ seatsPerTable: 8.5 }, { defaultSeatsPerTable: 10 }).seatsPerTable).toBe(10);
  });

  it("start with one table when the whole tournament fits at one", () => {
    expect(settings({ maxPlayers: 9 })).toMatchObject({ startingTables: 1, maxTables: 1 });
    expect(settings({ maxPlayers: 10 })).toMatchObject({ startingTables: 2, maxTables: 2 });
    expect(settings({ maxPlayers: 0 })).toMatchObject({ maxPlayers: 1, maxTables: 1 });
    expect(settings({ maxPlayers: 1000, seatsPerTable: 2 }).maxTables).toBe(50);
  });

  it("refuse a threshold above the seats per table", () => {
    expect(seatingSettingsProblem({ tournament: { maxPlayers: 40, openTableAt: 10 } })).toEqual({
      field: "openTableAt",
      message: "Open the next table at 9 players or fewer (the seats per table)",
    });
    expect(seatingSettingsProblem({ tournament: { maxPlayers: 40, seatsPerTable: 10, openTableAt: 10 } })).toBeNull();
    expect(seatingSettingsProblem({ tournament: { maxPlayers: 40, openTableAt: 8 }, club: { defaultSeatsPerTable: 6 } })?.message).toBe(
      "Open the next table at 6 players or fewer (the seats per table)",
    );
    expect(seatingSettingsProblem({ tournament: { maxPlayers: 40 } })).toBeNull();
  });
});

describe("setupTableCount", () => {
  it.each([
    [0, 2],
    [5, 2],
    [16, 2],
    [18, 2],
    [19, 3],
    [30, 4],
  ])("opens 2 tables to start, or more for those already registered: %d players → %d tables", (players, tables) => {
    expect(setupTableCount(settings(), players)).toBe(tables);
  });

  it("follows the threshold, the starting tables chosen, and the tournament's size", () => {
    expect(setupTableCount(settings({ openTableAt: 8 }), 17)).toBe(3);
    expect(setupTableCount(settings({ startingTables: 1 }), 5)).toBe(1);
    expect(setupTableCount(settings({ startingTables: 4 }), 5)).toBe(4);
    // Never more than ceil(18 / 9) = 2 tables for an 18-player tournament...
    expect(setupTableCount(settings({ maxPlayers: 18, openTableAt: 8 }), 18)).toBe(2);
    // ...unless staff registered more players than those tables seat.
    expect(setupTableCount(settings({ maxPlayers: 18 }), 25)).toBe(3);
    expect(setupTableCount(settings({ maxPlayers: 1000, seatsPerTable: 2 }), 1000)).toBe(50);
    expect(setupTableCount(settings({ maxPlayers: 9 }), 0)).toBe(1);
  });
});

describe("nextTableNumber", () => {
  it("is one past the highest number ever used", () => {
    expect(nextTableNumber([])).toBe(1);
    expect(nextTableNumber([tableOf(1), tableOf(2), tableOf(5, 9, "broken")])).toBe(6);
  });
});

describe("auto-seat (item 9)", () => {
  it("seats as they register, once they've paid, or not at all", () => {
    expect(autoSeatDecision("on_register", false)).toBe("seat");
    expect(autoSeatDecision("once_paid", false)).toBe("awaiting_payment");
    expect(autoSeatDecision("once_paid", true)).toBe("seat");
    expect(autoSeatDecision("off", true)).toBe("off");
  });

  it("puts a new arrival at the table with the fewest players, in an empty seat", () => {
    const snapshot = room({ tables: [5, 4], waiting: 1 });
    const plan = planAutoSeat(snapshot, "w1", mulberry32(1));
    expect(plan).toEqual({ ok: true, move: { registrationId: "w1", from: null, to: { tableId: "t2", seatNumber: expect.any(Number) }, reason: "auto_seat" } });
    if (!plan.ok) return;
    expect(plan.move.to?.seatNumber).toBeGreaterThan(4);
    expect(() => applyMoves(snapshot.seats, [plan.move], snapshot.tables)).not.toThrow();
  });

  it("breaks a tie by the table with more empty seats, then at random", () => {
    const uneven = room({ tables: [4, 4], seats: [6, 9], waiting: 1 });
    expect(planAutoSeat(uneven, "w1", mulberry32(7))).toMatchObject({ ok: true, move: { to: { tableId: "t2" } } });
    const even = room({ tables: [4, 4], waiting: 1 });
    const chosen = new Set(Array.from({ length: 40 }, (_, seed) => {
      const plan = planAutoSeat(even, "w1", mulberry32(seed));
      return plan.ok ? plan.move.to?.tableId : null;
    }));
    expect(chosen).toEqual(new Set(["t1", "t2"]));
  });

  it("never opens a table: with every seat taken the player waits", () => {
    expect(planAutoSeat(room({ tables: [9, 9], waiting: 1 }), "w1", mulberry32(1))).toEqual({ ok: false, skip: "tables_full" });
    expect(planAutoSeat(room({ tables: [], waiting: 1 }), "w1", mulberry32(1))).toEqual({ ok: false, skip: "no_tables" });
    expect(planAutoSeat(room({ tables: [3] }), "t1p1", mulberry32(1))).toEqual({ ok: false, skip: "already_seated" });
    expect(planAutoSeat(room({ tables: [3] }), "nobody", mulberry32(1))).toEqual({ ok: false, skip: "not_eligible" });
  });

  it("keeps the tables within one player as they fill, never seating two players in one seat", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 2 ** 31 }), (tables, arrivals, seed) => {
        let snapshot = room({ tables: Array<number>(tables).fill(0), waiting: arrivals });
        const rng = mulberry32(seed);
        let waiting = 0;
        for (let i = 1; i <= arrivals; i++) {
          const plan = planAutoSeat(snapshot, `w${i}`, rng);
          if (!plan.ok) {
            expect(plan.skip).toBe("tables_full");
            waiting++;
            continue;
          }
          snapshot = { ...snapshot, seats: applyMoves(snapshot.seats, [plan.move], snapshot.tables) };
        }
        const counts = snapshot.tables.map((table) => snapshot.seats.filter((seat) => seat.tableId === table.id).length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        expect(waiting).toBe(Math.max(0, arrivals - tables * 9));
      }),
      { numRuns: 300 },
    );
  });
});

describe("planOpenTable (item 11)", () => {
  const newTable = (number: number, seatCount = 9): SeatTable => ({ id: NEW_TABLE_ID, tableNumber: number, seatCount, status: "active" });

  it("turns 10 / 10 and one arrival into 7 / 7 / 7, moving the players in the highest seats", () => {
    const snapshot = room({ tables: [10, 10], seats: 10, waiting: 1 });
    const plan = planOpenTable(snapshot, settings({ seatsPerTable: 10 }), newTable(3, 10), mulberry32(1));
    expect(plan.sizes).toEqual([7, 7, 7]);
    expect(plan.stillWaiting).toEqual([]);
    expect(plan.moves.filter((move) => move.from !== null).map((move) => `${move.from?.tableId}:${move.from?.seatNumber}`).sort()).toEqual(
      ["t1:10", "t1:8", "t1:9", "t2:10", "t2:8", "t2:9"].sort(),
    );
    expect(plan.moves.every((move) => move.reason === "open_table" && move.to?.tableId === NEW_TABLE_ID)).toBe(true);
    expect(plan.moves.find((move) => move.registrationId === "w1")).toMatchObject({ from: null, to: { tableId: NEW_TABLE_ID } });
    expect(sizesAfter(snapshot, plan, [newTable(3, 10)])).toEqual([7, 7, 7]);
  });

  it("seats everyone waiting and evens out, the extra player staying where most sat (fewest moves)", () => {
    const snapshot = room({ tables: [9, 9], waiting: 4 });
    const plan = planOpenTable(snapshot, settings(), newTable(3), mulberry32(2));
    expect(plan.sizes).toEqual([8, 7, 7]);
    expect(plan.moves).toHaveLength(7);
    expect(plan.moves.filter((move) => move.from === null).map((move) => move.registrationId).sort()).toEqual(["w1", "w2", "w3", "w4"]);
  });

  it("moves players to a short table too, when the room was uneven", () => {
    const snapshot = room({ tables: [9, 3] });
    const plan = planOpenTable(snapshot, settings(), newTable(3), mulberry32(3));
    expect(plan.sizes).toEqual([4, 4, 4]);
    expect(sizesAfter(snapshot, plan, [newTable(3)])).toEqual([4, 4, 4]);
    expect(plan.moves.filter((move) => move.to?.tableId === "t2")).toHaveLength(1);
  });

  it("fills every seat and leaves the rest waiting when even the new table cannot take them all", () => {
    const plan = planOpenTable(room({ tables: [9, 9], waiting: 12 }), settings(), newTable(3), mulberry32(4));
    expect(plan.sizes).toEqual([9, 9, 9]);
    expect(plan.stillWaiting).toEqual(["w10", "w11", "w12"]);
  });

  it("leaves the unpaid out under \"once they've paid\"", () => {
    const plan = planOpenTable(room({ tables: [9, 9], waiting: 3, unpaid: 2 }), settings({ autoSeat: "once_paid" }), newTable(3), mulberry32(5));
    expect(plan.moves.filter((move) => move.from === null).map((move) => move.registrationId)).toEqual(["w1"]);
    expect(plan.sizes).toEqual([7, 6, 6]);
    expect(plan.stillWaiting).toEqual([]);
  });

  it("draws the same seats for the preview and for Apply while the seating is unchanged", () => {
    const snapshot = room({ tables: [9, 9], waiting: 1 });
    const first = planOpenTable(snapshot, settings(), newTable(3), openTableRng(snapshot));
    const again = planOpenTable(snapshot, settings(), newTable(3), openTableRng(snapshot));
    expect(again).toEqual(first);
  });

  it("always leaves the tables within one of each other, and everyone seated or still waiting", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 2 ** 31 }),
        (tables, waiting, newSeats, seed) => {
          const snapshot = room({ tables, waiting });
          const table = newTable(tables.length + 1, newSeats);
          const plan = planOpenTable(snapshot, settings(), table, mulberry32(seed));
          const sizes = sizesAfter(snapshot, plan, [table]);
          const capacity = tables.length * 9 + newSeats;
          const players = tables.reduce((sum, count) => sum + count, 0) + waiting;
          expect(sizes.reduce((sum, count) => sum + count, 0)).toBe(Math.min(players, capacity));
          expect(plan.stillWaiting).toHaveLength(Math.max(0, players - capacity));
          const notFull = sizes.filter((count, i) => count < (i === sizes.length - 1 ? newSeats : 9));
          if (notFull.length > 0) expect(Math.max(...sizes) - Math.min(...notFull)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("lateRegistrationOpen", () => {
  it("is open before the game, and during it until the clock passes the re-buy period", () => {
    expect(lateRegistrationOpen({ status: "registration", rebuyPeriodMinutes: 60 }, 90 * 60_000)).toBe(true);
    expect(lateRegistrationOpen({ status: "in_progress", rebuyPeriodMinutes: 135 }, 134 * 60_000)).toBe(true);
    expect(lateRegistrationOpen({ status: "in_progress", rebuyPeriodMinutes: 135 }, 135 * 60_000)).toBe(false);
  });

  it("stays open while it cannot tell (no re-buy period, or no clock), and closes with the tournament", () => {
    expect(lateRegistrationOpen({ status: "in_progress", rebuyPeriodMinutes: null }, 500 * 60_000)).toBe(true);
    expect(lateRegistrationOpen({ status: "in_progress", rebuyPeriodMinutes: 60 }, null)).toBe(true);
    expect(lateRegistrationOpen({ status: "completed" }, null)).toBe(false);
    expect(lateRegistrationOpen({ status: "cancelled" }, null)).toBe(false);
  });
});

describe("adviseTables (item 11)", () => {
  const advise = (spec: Room, tournament: Partial<SeatingSettingsInput["tournament"]> = {}, context?: AdvisorContext) =>
    adviseTables(room(spec), settings(tournament), context);
  const kinds = (result: ReturnType<typeof adviseTables>) => result.advice.map((advice) => advice.kind);

  it("has nothing to say before there are tables, or while the tables are filling", () => {
    expect(advise({ tables: [], waiting: 12 })).toEqual({ phase: "growing", players: 12, waiting: 12, notArrived: 0, overCapacity: 0, advice: [] });
    expect(advise({ tables: [8, 8] }).advice).toEqual([]);
    expect(advise({ tables: [9, 9] }).advice).toEqual([]);
  });

  it("opens the next table when every table is full and another player arrives, evening everyone out", () => {
    const result = advise({ tables: [9, 9], waiting: 1 });
    expect(result).toMatchObject({ phase: "growing", players: 19, waiting: 1 });
    expect(result.advice).toHaveLength(1);
    expect(result.advice[0]).toMatchObject({
      kind: "open_table",
      message: "Every table is full and 1 player is waiting: open Table 3 and even the tables out to 7 / 6 / 6",
      tableId: NEW_TABLE_ID,
      tableNumber: 3,
      players: 6,
    });
    expect(advise({ tables: [9, 9], waiting: 3 }).advice[0].message).toBe("Every table is full and 3 players are waiting: open Table 3 and even the tables out to 7 / 7 / 7");
  });

  it("numbers the new table after every table ever used", () => {
    expect(advise({ tables: [9, 9], waiting: 1, broken: 2 }).advice[0].tableNumber).toBe(5);
  });

  it("opens at the threshold the TD set", () => {
    expect(advise({ tables: [8, 8] }, { openTableAt: 8 }).advice).toEqual([]);
    expect(advise({ tables: [9, 8] }, { openTableAt: 8 }).advice[0]).toMatchObject({
      kind: "open_table",
      message: "Every table has 8 or more players (17 players in all): open Table 3 and even the tables out to 6 / 6 / 5",
    });
    expect(advise({ tables: [9, 9] }).advice).toEqual([]);
  });

  it("never plans more tables than the tournament's players need, unless players have no seat at all", () => {
    expect(advise({ tables: [9, 8] }, { maxPlayers: 18, openTableAt: 8 }).advice).toEqual([]);
    const extra = advise({ tables: [9, 9], waiting: 1 }, { maxPlayers: 18 }, { waitingList: 1 });
    expect(kinds(extra)).toEqual(["open_table"]);
    expect(extra.overCapacity).toBe(1);
  });

  it("does not open tables for players who have not paid yet under \"once they've paid\"", () => {
    const noShows = advise({ tables: [9, 9], waiting: 2, unpaid: 2 }, { autoSeat: "once_paid" });
    expect(noShows).toMatchObject({ players: 18, waiting: 0, notArrived: 2, advice: [] });
    expect(kinds(advise({ tables: [9, 9], waiting: 3, unpaid: 2 }, { autoSeat: "once_paid" }))).toEqual(["open_table"]);
    expect(advise({ tables: [9, 9], waiting: 2, unpaid: 2 }).waiting).toBe(2);
  });

  it("asks to seat players waiting while seats are open", () => {
    expect(advise({ tables: [5, 5], waiting: 3 }, { autoSeat: "off" }).advice).toEqual([
      { kind: "seat_waiting", message: "3 players are waiting and 8 seats are open: seat them", tableId: null, tableNumber: null, moves: [], players: 3 },
    ]);
    expect(advise({ tables: [9, 8], waiting: 1 }).advice[0].message).toBe("1 player is waiting and 1 seat is open: seat them");
  });

  it("never breaks the starting tables while the room is filling", () => {
    expect(advise({ tables: [3, 2] }).advice).toEqual([]);
    expect(advise({ tables: [8, 7] }, {}, { busted: 4 }).advice).toEqual([]);
    expect(advise({ tables: [1] }).advice).toEqual([]);
  });

  it("breaks a table opened later once everyone fits on one fewer, with a seat to spare under the threshold (while filling)", () => {
    expect(advise({ tables: [5, 5, 5] }).advice).toEqual([
      { kind: "break_table", message: "15 players fit on 2 tables of 9: break Table 3", tableId: "t3", tableNumber: 3, moves: [], players: 5 },
    ]);
    expect(advise({ tables: [6, 5, 5] }, { openTableAt: 8 }).advice).toEqual([]);
    expect(advise({ tables: [5, 5, 4] }, { openTableAt: 8 }).advice[0]).toMatchObject({ kind: "break_table", message: "14 players fit on 2 tables of 9: break Table 3" });
  });

  it("breaks by seats once a table has been broken: 17 players fit on 2 tables of 9", () => {
    expect(advise({ tables: [6, 6, 5], broken: 1 }).advice).toEqual([
      { kind: "break_table", message: "17 players fit on 2 tables of 9: break Table 3", tableId: "t3", tableNumber: 3, moves: [], players: 5 },
    ]);
    expect(advise({ tables: [6, 6, 5], broken: 1 }, { openTableAt: 8 }).advice[0].kind).toBe("break_table");
  });

  it("draws the final table once everyone fits at one", () => {
    expect(advise({ tables: [5, 4], broken: 1 }).advice).toEqual([
      { kind: "final_table", message: "9 players fit at one table: draw the final table at Table 1", tableId: "t1", tableNumber: 1, moves: [], players: 9 },
    ]);
    expect(advise({ tables: [3, 3, 3] }, {}, { busted: 3 }).advice[0].kind).toBe("final_table");
  });

  it("draws the final table on the starting tables too, once players have been knocked out (R5REV-HOST-01)", () => {
    // A 16-player night that never left its 2 starting tables, down to 9, then heads-up.
    expect(advise({ tables: [5, 4] }, {}, { busted: 7 }).advice).toEqual([
      { kind: "final_table", message: "9 players fit at one table: draw the final table at Table 1", tableId: "t1", tableNumber: 1, moves: [], players: 9 },
    ]);
    expect(advise({ tables: [1, 1] }, {}, { busted: 14 }).advice[0]).toMatchObject({ kind: "final_table", players: 2 });
    // The first arrivals at the starting tables are a room filling up, not a final table.
    expect(advise({ tables: [4, 4] }).advice).toEqual([]);
    // A later table, with nobody out yet: break it rather than call a final table.
    expect(kinds(advise({ tables: [3, 3, 3] }))).toEqual(["break_table"]);
  });

  it("stops growing once late registration is over: tables break by seats, the starting tables too", () => {
    expect(advise({ tables: [6, 6, 5] }, {}, { lateRegistrationOpen: false })).toMatchObject({
      phase: "shrinking",
      advice: [{ kind: "break_table", message: "17 players fit on 2 tables of 9: break Table 3" }],
    });
    expect(advise({ tables: [5, 4] }, {}, { lateRegistrationOpen: false }).advice[0].kind).toBe("final_table");
    expect(advise({ tables: [6, 5], waiting: 0 }, { startingTables: 2 }, { lateRegistrationOpen: false }).advice).toEqual([]);
    // And opens a table only for players with no seat at all.
    expect(advise({ tables: [9, 8] }, { openTableAt: 8 }, { lateRegistrationOpen: false }).advice).toEqual([]);
  });

  it("never asks to break the table it has just opened when one player busts (R5REV-HOST-02)", () => {
    // 19 players opened Table 3 (7 / 6 / 6); one bust leaves 18, which 2 full tables would hold.
    expect(kinds(advise({ tables: [7, 6, 6] }))).toEqual([]);
    expect(kinds(advise({ tables: [7, 6, 5] }, {}, { busted: 1 }))).toEqual(["balance"]);
    expect(kinds(advise({ tables: [6, 6, 5] }, {}, { busted: 2 }))).toEqual([]);
    // With a seat to spare at each table left (2 × 8), it is time.
    expect(advise({ tables: [6, 5, 5] }, {}, { busted: 3 }).advice[0]).toMatchObject({ kind: "break_table", message: "16 players fit on 2 tables of 9: break Table 3" });
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 2, max: 9 }), (opened, openTableAt) => {
        // The room had `opened` tables at the threshold and one more arrival: Table N+1 opened; then a bust.
        const players = opened * openTableAt;
        const sizes = Array.from({ length: opened + 1 }, (_, i) => Math.floor(players / (opened + 1)) + (i < players % (opened + 1) ? 1 : 0));
        const result = advise({ tables: sizes }, { openTableAt, startingTables: 2 }, { busted: 1 });
        expect(kinds(result)).not.toContain("break_table");
        expect(kinds(result)).not.toContain("open_table");
      }),
    );
  });

  it("flags the waiting list without counting it", () => {
    expect(advise({ tables: [9, 9] }, { maxPlayers: 18 }, { waitingList: 3 })).toMatchObject({ players: 18, overCapacity: 3, advice: [] });
  });

  it("balances tables two or more apart", () => {
    const snapshot = room({ tables: [9, 6], broken: 1 });
    const result = adviseTables(snapshot, settings());
    expect(result.advice).toEqual([
      { kind: "balance", message: "Tables are 9 and 6 players: balance them (1 move)", tableId: null, tableNumber: null, moves: planBalance(snapshot), players: 1 },
    ]);
    expect(advise({ tables: [8, 7], broken: 1 }).advice).toEqual([]);
  });

  it("opens no table for a shrinking room with seats left, only for players with no seat", () => {
    expect(advise({ tables: [9, 9], broken: 1 }, { openTableAt: 8 }).advice).toEqual([]);
    expect(kinds(advise({ tables: [9, 9], waiting: 1, broken: 1 }))).toEqual(["open_table"]);
  });

  it("puts the most urgent first: seating the waiting before balancing", () => {
    expect(kinds(advise({ tables: [9, 5], waiting: 2 }, { autoSeat: "off" }))).toEqual(["seat_waiting", "balance"]);
  });

  it("whatever the room, never advises both opening and breaking, and opens only within the tournament's tables unless it must", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 9, max: 60 }),
        (tables, waiting, broken, openTableAt, maxPlayers) => {
          const snapshot = room({ tables, waiting, broken });
          const tuned = settings({ openTableAt, maxPlayers });
          const result = adviseTables(snapshot, tuned);
          const found = kinds(result);
          expect(found.includes("open_table") && (found.includes("break_table") || found.includes("final_table"))).toBe(false);
          const openSeats = tables.reduce((sum, count) => sum + (9 - count), 0);
          if (found.includes("open_table") && waiting <= openSeats) expect(tables.length).toBeLessThan(tuned.maxTables);
          for (const advice of result.advice) {
            expect(advice.message).not.toMatch(/\n/);
            expect(advice.message.length).toBeGreaterThan(10);
          }
          const open = result.advice.find((advice) => advice.kind === "open_table");
          if (open) {
            const table = { id: NEW_TABLE_ID, tableNumber: open.tableNumber as number, seatCount: 9, status: "active" as const };
            expect(() => applyMoves(snapshot.seats, open.moves, [...snapshot.tables, table])).not.toThrow();
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
