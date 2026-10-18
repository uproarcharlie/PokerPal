import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrizePoolCalculator } from "./prize-pool-calculator";

const tournament = {
  id: "t1",
  name: "Friday Freezeout",
  buyInAmount: "50.00",
  rebuyAmount: "50.00",
  addonAmount: "25.00",
  rakeType: "percentage",
  rakeAmount: "10.00",
};

describe("PrizePoolCalculator", () => {
  it("shows the entry totals, the rake and the net prize pool it is given", () => {
    render(
      <PrizePoolCalculator
        tournament={tournament}
        grossTotal={1550}
        rake={155}
        netPrizePool={1395}
        totalBuyIns={24}
        totalRebuys={6}
        totalAddons={2}
      />,
    );

    expect(screen.getByTestId("buyins-total")).toHaveTextContent("$1,200");
    expect(screen.getByTestId("rebuys-total")).toHaveTextContent("$300");
    expect(screen.getByTestId("addons-total")).toHaveTextContent("$50");
    expect(screen.getByTestId("gross-total")).toHaveTextContent("$1,550");
    expect(screen.getByText("Rake (10.00%)")).toBeInTheDocument();
    expect(screen.getByTestId("rake-amount")).toHaveTextContent("-$155");
    expect(screen.getByTestId("net-prize-pool")).toHaveTextContent("$1,395");
  });

  it("shows a placeholder until anyone has paid in", () => {
    render(
      <PrizePoolCalculator
        tournament={tournament}
        grossTotal={0}
        rake={0}
        netPrizePool={0}
        totalBuyIns={0}
        totalRebuys={0}
        totalAddons={0}
      />,
    );

    expect(screen.getByText("Prize pool will be calculated")).toBeInTheDocument();
    expect(screen.queryByTestId("net-prize-pool")).not.toBeInTheDocument();
  });
});
