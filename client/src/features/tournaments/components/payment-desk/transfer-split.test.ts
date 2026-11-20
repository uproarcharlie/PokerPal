import { describe, expect, it } from "vitest";
import { TWO_HALVES } from "@test/helpers/r10-high-hands";
import { doorSentence, transferDeskOf, transferSplit } from "./transfer-split";

const desk = { buyInCents: 5000, bountyCents: 0 };
/** Round 11: $50 buy-in + $100 bounty. */
const bountyDesk = { buyInCents: 5000, bountyCents: 10000 };

describe("transferDeskOf", () => {
  it("is the buy-in for a tournament that shows bank transfer details, and nothing for one that does not", () => {
    expect(transferDeskOf({ showBankTransfer: true, buyInAmount: "50.00", bountyAmount: null })).toEqual({ buyInCents: 5000, bountyCents: 0 });
    expect(transferDeskOf({ showBankTransfer: true, buyInAmount: "50.00", bountyAmount: "100.00" })).toEqual({ buyInCents: 5000, bountyCents: 10000 });
    expect(transferDeskOf({ showBankTransfer: false, buyInAmount: "50.00", bountyAmount: null })).toBeNull();
    expect(transferDeskOf({ showBankTransfer: undefined, buyInAmount: "50.00", bountyAmount: null })).toBeNull();
  });
});

describe("transferSplit (R8REV1-PHONE-01)", () => {
  it("leaves the high hand for the door: the transfer is the buy-in only, as the sign-up was told", () => {
    expect(transferSplit({ buyIns: 1, enteringHighHands: true }, 55, desk)).toEqual({ transferCents: 5000, transferFor: "buy-in", doorCents: 500, doorFor: "high hand", doorParts: ["high hand"] });
  });

  it("has nothing for the door when the transfer pays everything owed", () => {
    expect(transferSplit({ buyIns: 1, enteringHighHands: false }, 50, desk)).toEqual({ transferCents: 5000, transferFor: "buy-in", doorCents: 0, doorFor: "", doorParts: [] });
  });

  it("puts re-buys and add-ons recorded before the payment at the door too", () => {
    expect(transferSplit({ buyIns: 1, rebuys: 1, addons: 1, enteringHighHands: true }, 105, desk)).toEqual({
      transferCents: 5000,
      transferFor: "buy-in",
      doorCents: 5500,
      doorFor: "high hand, re-buys, add-ons",
      doorParts: ["high hand", "re-buys", "add-ons"],
    });
  });

  it("asks a free entry for no transfer, and never more than the amount", () => {
    expect(transferSplit({ buyIns: 1, freeEntry: true, enteringHighHands: true }, 5, desk)).toEqual({ transferCents: 0, transferFor: "buy-in", doorCents: 500, doorFor: "high hand", doorParts: ["high hand"] });
    expect(transferSplit({ buyIns: 2 }, 50, desk)).toEqual({ transferCents: 5000, transferFor: "buy-in", doorCents: 0, doorFor: "", doorParts: [] });
  });

  it("counts the bounty with the buy-in in the transfer, a free entry's too (round 11)", () => {
    expect(transferSplit({ buyIns: 1, enteringHighHands: true }, 155, bountyDesk)).toEqual({ transferCents: 15000, transferFor: "buy-in + bounty", doorCents: 500, doorFor: "high hand", doorParts: ["high hand"] });
    expect(transferSplit({ buyIns: 1, freeEntry: true }, 100, bountyDesk)).toEqual({ transferCents: 10000, transferFor: "bounty", doorCents: 0, doorFor: "", doorParts: [] });
  });

  it("names each high hand the entry chose in a game with several (round 10)", () => {
    const halves = { enableHighHand: true, highHandAmount: "10.00", highHands: TWO_HALVES };
    expect(transferSplit({ buyIns: 1, enteringHighHands: true, highHandIds: ["hh1", "hh2"] }, 60, desk, halves)).toEqual({
      transferCents: 5000,
      transferFor: "buy-in",
      doorCents: 1000,
      doorFor: "First half high hand, Second half high hand",
      doorParts: ["First half high hand", "Second half high hand"],
    });
    expect(transferSplit({ buyIns: 1, enteringHighHands: true, highHandIds: ["hh2"] }, 55, desk, halves).doorParts).toEqual(["Second half high hand"]);
  });
});

describe("doorSentence", () => {
  it("says what the door still takes, one thing or several", () => {
    expect(doorSentence({ doorParts: ["high hand"] })).toBe("The high hand is paid at the door: confirm once you have it.");
    expect(doorSentence({ doorParts: ["First half high hand", "Second half high hand"] })).toBe(
      "The First half high hand and Second half high hand are paid at the door: confirm once you have it.",
    );
    expect(doorSentence({ doorParts: ["high hand", "re-buys", "add-ons"] })).toBe("The high hand, re-buys and add-ons are paid at the door: confirm once you have it.");
    expect(doorSentence({ doorParts: [] })).toBe("The rest is paid at the door: confirm once you have it.");
  });
});
