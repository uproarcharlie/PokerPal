import { describe, expect, it } from "vitest";
import { bountyHelpText, buyInPriceText } from "./buy-in-price";

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

describe("bountyHelpText", () => {
  it("says what players pay and that the bounty is not in the pool", () => {
    expect(bountyHelpText({ buyInAmount: "50", bountyAmount: "100" })).toBe(
      "Players pay $150: $50 buy-in + $100 bounty. The bounty isn't in the prize pool — whoever knocks a player out collects it.",
    );
    expect(bountyHelpText({ buyInAmount: "50", bountyAmount: "" })).toBeNull();
  });
});
