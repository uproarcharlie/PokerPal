import { describe, expect, it } from "vitest";
import { bountyPriceLines, buyInPriceText } from "./buy-in-price";

describe("buyInPriceText (round 11)", () => {
  it("shows a bounty game's buy-in with its bounty beside it", () => {
    expect(buyInPriceText({ buyInAmount: "50.00", bountyAmount: "100.00" })).toBe("$50 + $100 bounty");
    expect(buyInPriceText({ buyInAmount: "52.50", bountyAmount: "25.00" })).toBe("$52.50 + $25 bounty");
  });

  it("shows any other game's buy-in as before", () => {
    expect(buyInPriceText({ buyInAmount: "50.00", bountyAmount: null })).toBe("$50.00");
    expect(buyInPriceText({ buyInAmount: "50.00", bountyAmount: "0.00" })).toBe("$50.00");
    expect(buyInPriceText({ buyInAmount: "50.00" })).toBe("$50.00");
  });
});

describe("bountyPriceLines", () => {
  it("lists the prize pool, the bounty and what each player pays as separate lines", () => {
    expect(bountyPriceLines({ buyInAmount: "50", bountyAmount: "100" })).toEqual([
      { label: "Prize pool (paid to the places)", amount: "$50" },
      { label: "Bounty (collected on knockouts, not in the prize pool)", amount: "$100" },
      { label: "Each player pays", amount: "$150" },
    ]);
    expect(bountyPriceLines({ buyInAmount: "50", bountyAmount: "" })).toBeNull();
  });
});
