import { describe, expect, it } from "vitest";
import type { PublicRegistration } from "@shared/api/public";
import { standingsFor } from "@shared/domain/standings";
import { prizeTable, showsPoints } from "./standings";

const entry = (id: string, extra: Partial<PublicRegistration> = {}): PublicRegistration => ({
  id,
  tournamentId: "t1",
  playerId: `p-${id}`,
  registrationTime: null,
  buyIns: 1,
  rebuys: 0,
  addons: 0,
  finalPosition: null,
  prizeAmount: null,
  pointsAwarded: null,
  isEliminated: false,
  eliminationTime: null,
  eliminatedBy: null,
  knockouts: 0,
  enteringHighHands: false,
  highHandWinner: false,
  highHandAmount: null,
  earlyBird: false,
  player: { id: `p-${id}`, name: id, imageUrl: null },
  ...extra,
});

describe("standingsFor (PUB-25)", () => {
  it("gives players still in no place, and each busted player the place they finished in", () => {
    const standings = standingsFor(
      [
        entry("early", { isEliminated: true, eliminationTime: "2026-10-23T08:00:00.000Z" }),
        entry("in-1"),
        entry("late", { isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" }),
        entry("in-2"),
      ],
      false,
    );

    expect(standings.map((s) => [s.registration.id, s.place])).toEqual([
      ["in-1", null],
      ["in-2", null],
      ["late", 3],
      ["early", 4],
    ]);
  });

  it("orders a completed tournament by finishing position and shows those positions", () => {
    const standings = standingsFor(
      [entry("b", { finalPosition: 2, isEliminated: true }), entry("c", { finalPosition: 3, isEliminated: true }), entry("a", { finalPosition: 1 })],
      true,
    );

    expect(standings.map((s) => [s.registration.id, s.place])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });
});

describe("prizeTable", () => {
  const payouts = [
    { position: 1, amountCents: 10_000, percentage: 50 },
    { position: 2, amountCents: 6_000, percentage: 30 },
  ];

  it("lists the paid places, then one row for every other finisher who still scores", () => {
    const table = prizeTable(payouts, {
      trackPoints: true,
      pointsSystem: { participationPoints: 5, knockoutPoints: 0 },
      allocations: [{ position: 1, points: 50 }, { position: 2, points: 30 }, { position: 3, positionEnd: 4, points: 20 }],
    });

    expect(table.rows.map((row) => [row.position, row.payout?.amountCents ?? null, row.points])).toEqual([
      [1, 10_000, 50],
      [2, 6_000, 30],
      [3, null, 20],
      [4, null, 20],
    ]);
    expect(table.others).toEqual({ from: 5, points: 5 });
  });

  it("has no 'everyone else' row when they score nothing", () => {
    const table = prizeTable(payouts, { trackPoints: false, pointsSystem: null, allocations: [] });

    expect(table.rows.map((row) => row.position)).toEqual([1, 2]);
    expect(table.others).toBeNull();
  });
});

describe("showsPoints (round 7)", () => {
  const scored = [entry("r1", { pointsAwarded: 0 }), entry("r2", { pointsAwarded: 40 })];
  const unscored = [entry("r1", { pointsAwarded: 0 }), entry("r2")];

  it("shows points for a game that tracks them with a points system", () => {
    expect(showsPoints({ trackPoints: true, pointsSystemId: "ps1" }, [])).toBe(true);
  });

  it("shows none for a game that does not track them, whatever was scored", () => {
    expect(showsPoints({ trackPoints: false, pointsSystemId: "ps1" }, scored)).toBe(false);
    expect(showsPoints({ trackPoints: false, pointsSystemId: null }, scored)).toBe(false);
  });

  it("shows none for a game with no points system (a one-off, or one made before round 7), where nothing scores", () => {
    expect(showsPoints({ trackPoints: true, pointsSystemId: null }, unscored)).toBe(false);
  });

  it("still shows the points a game scored before its points system was deleted", () => {
    expect(showsPoints({ trackPoints: true, pointsSystemId: null }, scored)).toBe(true);
  });
});
