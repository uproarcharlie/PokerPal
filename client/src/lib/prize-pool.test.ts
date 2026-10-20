import { describe, expect, it } from "vitest";
import type { PrizePoolSnapshot } from "@shared/domain/finalize";
import { tournamentMoney } from "./prize-pool";

const tournament = {
  status: "in_progress",
  buyInAmount: "100.00",
  rakeType: "fixed",
  rakeAmount: "5.00",
  payoutStructure: "standard",
  prizePoolSnapshot: null,
};
/** Five buy-ins at $100 with $5 AP each: a $475 pool. */
const registrations = [
  { id: "r1", buyIns: 2 },
  { id: "r2", buyIns: 2 },
  { id: "r3", buyIns: 1 },
];

const amounts = (rows: { position: number; amountCents: number }[]) => rows.map((row) => [row.position, row.amountCents]);

describe("tournamentMoney", () => {
  it("splits a live pool with the v2 rule: whole dollars per place, the remainder to 1st, summing exactly", () => {
    const { breakdown, display, poolCents } = tournamentMoney(tournament, registrations);

    expect(poolCents).toBe(47_500);
    expect(breakdown.rake.applied).toBe(2_500);
    expect(display.source).toBe("live");
    // Legacy Math.round per place paid $238 + $143 + $95 = $476 from a $475 pool.
    expect(amounts(display.rows)).toEqual([[1, 23_800], [2, 14_200], [3, 9_500]]);
    expect(display.totalCents).toBe(47_500);
  });

  it("headlines nothing for a cancelled tournament, which pays nothing (P2REV1-MONEY-04)", () => {
    const { display, poolCents } = tournamentMoney({ ...tournament, status: "cancelled" }, registrations);

    expect(display).toEqual({ source: "cancelled", rows: [], totalCents: 0, undistributedCents: 0 });
    expect(poolCents).toBe(0);
  });

  it("pays a manual prize pool ahead of a manual AP total, and the AP total ahead of the rates", () => {
    expect(tournamentMoney({ ...tournament, rakeOverride: "75.00" }, registrations).poolCents).toBe(42_500);
    expect(
      tournamentMoney({ ...tournament, rakeOverride: "75.00", manualPrizePool: "600.00" }, registrations).poolCents,
    ).toBe(60_000);
  });

  it("shows what was paid for a completed tournament: the snapshot, never a recalculation", () => {
    const snapshot = {
      pool: { netCents: 48_000 },
      paid: [
        { position: 1, registrationId: "r2", playerId: "p2", playerName: "Bob", basisPoints: 5000, amountCents: 30_000 },
        { position: 2, registrationId: "r1", playerId: "p1", playerName: "Ann", basisPoints: 3000, amountCents: 18_000 },
      ],
    } as unknown as PrizePoolSnapshot;

    const { display, poolCents } = tournamentMoney({ ...tournament, status: "completed", prizePoolSnapshot: snapshot }, registrations);

    expect(display.source).toBe("snapshot");
    expect(amounts(display.rows)).toEqual([[1, 30_000], [2, 18_000]]);
    expect(poolCents).toBe(48_000);
  });

  it("shows the stored prizes of a tournament finalized before snapshots", () => {
    const paid = [
      { id: "r1", buyIns: 2, finalPosition: 2, prizeAmount: "143.00" },
      { id: "r2", buyIns: 2, finalPosition: 1, prizeAmount: "238.00" },
      { id: "r3", buyIns: 1, finalPosition: 3, prizeAmount: "95.00" },
    ];

    const { display, poolCents } = tournamentMoney({ ...tournament, status: "completed" }, paid);

    expect(display.source).toBe("stored");
    expect(amounts(display.rows)).toEqual([[1, 23_800], [2, 14_300], [3, 9_500]]);
    expect(poolCents).toBe(47_600);
  });
});
