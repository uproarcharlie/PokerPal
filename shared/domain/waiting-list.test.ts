import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { acceptRefusal, bySignUp, fieldEntries, hasPlayed, inFieldByRight, waitingListCount, waitingListPositions, type WaitingListEntry } from "./waiting-list";

/** Sign-ups r1, r2, … a minute apart; `paid` lists the ones whose payment is confirmed. */
function signUps(count: number, paid: readonly number[] = [], extra: Record<number, Partial<WaitingListEntry>> = {}): WaitingListEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${String(i + 1).padStart(2, "0")}`,
    registrationTime: new Date(Date.UTC(2026, 9, 25, 7, i)),
    paymentConfirmed: paid.includes(i + 1),
    ...extra[i + 1],
  }));
}

describe("waitingListPositions (round 5, item 15)", () => {
  it("is empty while the sign-ups fit, or without a Max players", () => {
    expect(waitingListPositions(signUps(18), 18).size).toBe(0);
    expect(waitingListPositions(signUps(30), null).size).toBe(0);
  });

  it("numbers the sign-ups beyond Max players from 1, in sign-up order", () => {
    expect(Array.from(waitingListPositions(signUps(20), 18))).toEqual([
      ["r19", 1],
      ["r20", 2],
    ]);
  });

  it("keeps the places of the players accepted, whenever they signed up: a late payer beats an early no-show", () => {
    // 19 sign-ups for 18 places; the 19th has paid at the desk, so the last unpaid sign-up waits.
    const field = signUps(19, [19, 1, 2, 3]);
    expect(Array.from(waitingListPositions(field, 18))).toEqual([["r18", 1]]);
  });

  it("never puts anyone who has played on the list, paid or not", () => {
    const played = signUps(3, [], { 2: { isEliminated: true }, 3: { rebuys: 1 } });
    expect(Array.from(waitingListPositions(played, 1))).toEqual([["r01", 1]]);
    expect(hasPlayed({ finalPosition: 4 })).toBe(true);
    expect(hasPlayed({ knockouts: 1 })).toBe(true);
    expect(hasPlayed({ addons: 1 })).toBe(true);
    expect(hasPlayed({ rebuys: 0, addons: 0, knockouts: 0, isEliminated: false, finalPosition: null })).toBe(false);
  });

  it("reads the positions the server gave, when the entries carry them (public registrations carry no payment)", () => {
    const listed = [
      { id: "a", waitingListPosition: null },
      { id: "b", waitingListPosition: 2 },
      { id: "c", waitingListPosition: 1 },
    ];
    expect(Array.from(waitingListPositions(listed, 1))).toEqual([
      ["b", 2],
      ["c", 1],
    ]);
  });

  it("orders sign-ups by time, then id; an entry with no time last", () => {
    const entries: WaitingListEntry[] = [
      { id: "b", registrationTime: "2026-10-25T07:00:00.000Z" },
      { id: "c", registrationTime: null },
      { id: "a", registrationTime: "2026-10-25T07:00:00.000Z" },
      { id: "d", registrationTime: "2026-10-25T06:00:00.000Z" },
    ];
    expect([...entries].sort(bySignUp).map((entry) => entry.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("keeps the field at Max players or fewer, unless more than that are in it by right", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ paid: fc.boolean(), played: fc.boolean() }), { maxLength: 40 }), fc.integer({ min: 1, max: 30 }), (rows, max) => {
        const entries = rows.map((row, i) => ({ id: `r${i}`, registrationTime: new Date(i * 1000), paymentConfirmed: row.paid, isEliminated: row.played }));
        const field = fieldEntries(entries, max);
        const byRight = entries.filter(inFieldByRight).length;
        expect(field.length).toBe(Math.max(Math.min(entries.length, max), byRight));
        expect(field.length + waitingListPositions(entries, max).size).toBe(entries.length);
        // Everyone in by right is in the field.
        expect(entries.filter(inFieldByRight).every((entry) => field.includes(entry))).toBe(true);
      }),
    );
  });
});

describe("waitingListCount", () => {
  it("counts the sign-ups beyond Max players that are not in by right, from the counts alone", () => {
    expect(waitingListCount(20, 0, 18)).toBe(2);
    expect(waitingListCount(20, 19, 18)).toBe(1);
    expect(waitingListCount(18, 3, 18)).toBe(0);
    expect(waitingListCount(30, 5, null)).toBe(0);
  });

  it("is the length of the numbered list for the same entries", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ paid: fc.boolean(), played: fc.boolean() }), { maxLength: 40 }), fc.option(fc.integer({ min: 0, max: 30 })), (rows, max) => {
        const entries = rows.map((row, i) => ({ id: `r${i}`, registrationTime: new Date(i * 1000), paymentConfirmed: row.paid, isEliminated: row.played }));
        expect(waitingListCount(entries.length, entries.filter(inFieldByRight).length, max)).toBe(waitingListPositions(entries, max).size);
      }),
    );
  });
});

describe("acceptRefusal", () => {
  it("refuses one more acceptance once Max players are in by right, with no override", () => {
    const accepted = signUps(18, Array.from({ length: 18 }, (_, i) => i + 1));
    expect(acceptRefusal(accepted, 18, { paymentConfirmed: false })).toBe("18 of 18 players accepted: raise Max players to accept more");
    expect(acceptRefusal(accepted.slice(1), 18, { paymentConfirmed: false })).toBeNull();
    expect(acceptRefusal(accepted, 19, { paymentConfirmed: false })).toBeNull();
  });

  it("counts players who played unpaid as accepted, and never refuses an entry already in by right", () => {
    const field = signUps(2, [1], { 2: { isEliminated: true } });
    expect(acceptRefusal(field, 2)).toBe("2 of 2 players accepted: raise Max players to accept more");
    expect(acceptRefusal(field, 2, { isEliminated: true })).toBeNull();
    expect(acceptRefusal(field, 2, { paymentConfirmed: true })).toBeNull();
  });
});
