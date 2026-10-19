import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PrizePoolSnapshot } from "@shared/api/finalize";
import { computePrizePool, payoutsForDisplay, type EntryInput } from "@shared/domain/prize-pool";
import { PrizePoolCalculator } from "./prize-pool-calculator";

type CalculatorTournament = Parameters<typeof PrizePoolCalculator>[0]["tournament"] & { status?: string };

/** The calculator as tournament-details renders it: the live breakdown and what to show as paid. */
function renderCalculator(
  t: CalculatorTournament,
  rows: ReadonlyArray<EntryInput & { id?: string; finalPosition?: number | null; prizeAmount?: string | null }>,
  rakeLabel?: string,
  highHandAwardsCents?: number[],
) {
  const breakdown = computePrizePool(t, rows);
  const registrations = rows.map((row, i) => ({ id: row.id ?? `r${i}`, ...row }));
  const display = payoutsForDisplay(t, breakdown, registrations);
  return render(
    <PrizePoolCalculator tournament={t} breakdown={breakdown} display={display} rakeLabel={rakeLabel} highHandAwardsCents={highHandAwardsCents} />,
  );
}

const tournament = {
  id: "t1",
  name: "Friday Freezeout",
  buyInAmount: "50.00",
  rebuyAmount: "50.00",
  addonAmount: "25.00",
  rakeType: "percentage",
  rakeAmount: "10.00",
  rebuyRakeType: "percentage",
  rebuyRakeAmount: "10.00",
  addonRakeType: "percentage",
  addonRakeAmount: "10.00",
  payoutStructure: "standard",
};

/** 24 players: 24 buy-ins, 6 re-buys and 2 add-ons between them. */
const entries: EntryInput[] = Array.from({ length: 24 }, (_, i) => ({ buyIns: 1, rebuys: i < 6 ? 1 : 0, addons: i < 2 ? 1 : 0 }));

describe("PrizePoolCalculator", () => {
  it("shows the entry totals, the rake and the net prize pool computePrizePool works out", () => {
    renderCalculator(tournament, entries);

    expect(screen.getByTestId("buyins-total")).toHaveTextContent("$1,200");
    expect(screen.getByTestId("rebuys-total")).toHaveTextContent("$300");
    expect(screen.getByTestId("addons-total")).toHaveTextContent("$50");
    expect(screen.getByTestId("gross-total")).toHaveTextContent("$1,550");
    expect(screen.getByText("Rake (buy-ins 10% + re-buys 10% + add-ons 10%)")).toBeInTheDocument();
    expect(screen.getByTestId("rake-amount")).toHaveTextContent("-$155");
    expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$1,395");
  });

  it("uses the club's label and shows a manual AP total as such", () => {
    const withOverride = { ...tournament, rakeOverride: "100.00" };

    renderCalculator(withOverride, entries, "AP");

    expect(screen.getByText("AP (manual total)")).toBeInTheDocument();
    expect(screen.getByTestId("rake-amount")).toHaveTextContent("-$100");
    expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$1,450");
  });

  it("shows a manual prize pool, with what the rates would give beside it", () => {
    const manual = { ...tournament, manualPrizePool: "1500.00" };

    renderCalculator(manual, entries);

    expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$1,500");
    expect(screen.getByTestId("manual-pool-note")).toHaveTextContent("calculated: $1,395");
  });

  it("splits the high-hand pot to the cent, as the award suggestion does", () => {
    const highHand = {
      ...tournament,
      enableHighHand: true,
      highHandAmount: "10.00",
      highHandRakeType: "fixed",
      highHandRakeAmount: "5.00",
      highHandPayouts: 3,
    };
    const players = entries.map((entry, i) => ({ ...entry, enteringHighHands: i < 10 }));

    renderCalculator(highHand, players);

    expect(screen.getByTestId("high-hand-net")).toHaveTextContent("$95");
    expect(screen.getByTestId("high-hand-next-award")).toHaveTextContent("$31.66");
  });

  it("shows what the next high-hand winner really gets once prizes are awarded and the pot has grown (P2REV1-07)", () => {
    const highHand = { ...tournament, enableHighHand: true, highHandAmount: "10.00", highHandRakeType: "none", highHandPayouts: 2 };
    // 14 entries: a $140 pot, after the first winner was paid $50 out of $100.
    const players = Array.from({ length: 14 }, () => ({ buyIns: 1, enteringHighHands: true }));

    renderCalculator(highHand, players, undefined, [5_000]);

    expect(screen.getByTestId("high-hand-net")).toHaveTextContent("$140");
    expect(screen.getByTestId("high-hand-awarded")).toHaveTextContent("$50");
    expect(screen.getByTestId("high-hand-next-award")).toHaveTextContent("$90");
  });

  it("gives the last winner the odd cents, and says when every prize is awarded", () => {
    // One $100.01 entry over two prizes: $50.00, then the $50.01 left.
    const highHand = { ...tournament, enableHighHand: true, highHandAmount: "100.01", highHandRakeType: "none", highHandPayouts: 2 };
    const players = [{ buyIns: 1, enteringHighHands: true }];

    const { unmount } = renderCalculator(highHand, players, undefined, []);
    expect(screen.getByTestId("high-hand-next-award")).toHaveTextContent("$50");
    unmount();
    const second = renderCalculator(highHand, players, undefined, [5_000]);
    expect(screen.getByTestId("high-hand-next-award")).toHaveTextContent("$50.01");
    second.unmount();

    renderCalculator(highHand, players, undefined, [5_000, 5_001]);
    expect(screen.getByTestId("high-hand-next-award")).toHaveTextContent("All prizes awarded");
  });

  it("names every rate the AP comes from, not just the buy-in's (MONEY-REV-04)", () => {
    const mixed = { ...tournament, rebuyRakeType: "fixed", rebuyRakeAmount: "5.00", addonRakeType: "none", addonRakeAmount: "0.00" };

    renderCalculator(mixed, entries, "AP");

    expect(screen.getByText("AP (buy-ins 10% + re-buys $5 per entry)")).toBeInTheDocument();
  });

  it("shows a finalized tournament's pool as finalize froze it, never a recalculation (MONEY-REV-04, D20)", () => {
    const snapshot = {
      pool: {
        grossCents: 80_000,
        rakeCalculatedCents: 0,
        rakeOverrideCents: null,
        manualPrizePoolCents: null,
        netCents: 80_000,
        netSource: "calculated",
        impliedRakeCents: 0,
        structure: { requested: "top9", used: "top9", basisPoints: [] },
      },
      paid: [{ position: 1, registrationId: "r0", playerId: "p0", playerName: "Ann", basisPoints: 9800, amountCents: 78_400 }],
    } as unknown as PrizePoolSnapshot;
    // Settings changed since: the live maths would now say $1,550 less AP.
    renderCalculator({ ...tournament, status: "completed", prizePoolSnapshot: snapshot }, entries);

    expect(screen.getByTestId("gross-total")).toHaveTextContent("$800");
    expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$800");
    expect(screen.getByTestId("paid-out")).toHaveTextContent("$784");
    expect(screen.getByTestId("undistributed")).toHaveTextContent("$16 of the pool was not paid out");
    expect(screen.queryByText(/Real-time/)).not.toBeInTheDocument();
  });

  it("marks a tournament finalized before snapshots as recalculated, beside what was really paid", () => {
    const legacy = Array.from({ length: 19 }, (_, i) => ({ buyIns: 1, finalPosition: i + 1, prizeAmount: ["238.00", "143.00", "95.00"][i] ?? null }));

    renderCalculator({ ...tournament, buyInAmount: "25.00", rakeType: "none", rakeAmount: "0.00", status: "completed" }, legacy);

    expect(screen.getByText("Net Prize Pool (recalculated)")).toBeInTheDocument();
    expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$475");
    expect(screen.getByTestId("paid-out")).toHaveTextContent("$476");
  });

  it("shows a placeholder until anyone has paid in", () => {
    renderCalculator(tournament, []);

    expect(screen.getByText("Prize pool will be calculated")).toBeInTheDocument();
    expect(screen.queryByTestId("net-prize-pool")).not.toBeInTheDocument();
  });

  describe("a manual prize pool (P2REV1-MONEY-03)", () => {
    it("shows a freeroll's or guaranteed pool's breakdown although nothing was taken in, as the Prize Structure pays it", () => {
      const freeroll = { ...tournament, buyInAmount: "0.00", rebuyAmount: null, addonAmount: null, manualPrizePool: "500.00" };

      renderCalculator(freeroll, [{ buyIns: 1 }, { buyIns: 1 }, { buyIns: 1 }]);

      expect(screen.queryByText("Prize pool will be calculated")).not.toBeInTheDocument();
      expect(screen.getByTestId("gross-total")).toHaveTextContent("$0");
      expect(screen.getByTestId("manual-adjustment")).toHaveTextContent("Added by the club+$500");
      expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$500");
    });

    it("adds up line by line while the game runs: gross, AP, the manual difference, net", () => {
      const manual = { ...tournament, manualPrizePool: "1300.00" };
      renderCalculator(manual, entries);

      expect(screen.getByTestId("gross-total")).toHaveTextContent("$1,550");
      expect(screen.getByTestId("rake-amount")).toHaveTextContent("-$155");
      expect(screen.getByTestId("manual-adjustment")).toHaveTextContent("Manual adjustment-$95");
      expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$1,300");
    });

    it("adds up line by line once finalized, from the frozen pool: the rates' AP and the manual difference", () => {
      const snapshot = {
        pool: {
          grossCents: 40_000,
          rakeCalculatedCents: 4_000,
          rakeOverrideCents: null,
          manualPrizePoolCents: 30_000,
          netCents: 30_000,
          netSource: "manual_pool",
          impliedRakeCents: 10_000,
          structure: { requested: "standard", used: "standard", basisPoints: [10_000] },
        },
        paid: [{ position: 1, registrationId: "r0", playerId: "p0", playerName: "Ann", basisPoints: 10_000, amountCents: 30_000 }],
      } as unknown as PrizePoolSnapshot;

      renderCalculator({ ...tournament, status: "completed", prizePoolSnapshot: snapshot }, entries);

      expect(screen.getByTestId("gross-total")).toHaveTextContent("$400");
      expect(screen.getByTestId("rake-amount")).toHaveTextContent("-$40");
      expect(screen.getByTestId("manual-adjustment")).toHaveTextContent("Manual adjustment-$60");
      expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$300");
      expect(screen.getByTestId("manual-pool-note")).toHaveTextContent("Set manually (calculated: $360)");
    });
  });

  it("says a cancelled tournament pays nothing, as finalize and the dashboard treat it (P2REV1-MONEY-04)", () => {
    renderCalculator({ ...tournament, status: "cancelled", prizePoolLocked: true } as CalculatorTournament, entries);

    expect(screen.getByTestId("pool-cancelled")).toHaveTextContent("Cancelled: no prizes are paid");
    expect(screen.queryByTestId("net-prize-pool")).not.toBeInTheDocument();
  });
});
