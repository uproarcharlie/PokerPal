import { describe, expect, it } from "vitest";
import { transferDeskOf, transferSplit } from "./transfer-split";

const desk = { buyInCents: 5000 };

describe("transferDeskOf", () => {
  it("is the buy-in for a tournament that shows bank transfer details, and nothing for one that does not", () => {
    expect(transferDeskOf({ showBankTransfer: true, buyInAmount: "50.00" })).toEqual({ buyInCents: 5000 });
    expect(transferDeskOf({ showBankTransfer: false, buyInAmount: "50.00" })).toBeNull();
    expect(transferDeskOf({ showBankTransfer: undefined, buyInAmount: "50.00" })).toBeNull();
  });
});

describe("transferSplit (R8REV1-PHONE-01)", () => {
  it("leaves the high hand for the door: the transfer is the buy-in only, as the sign-up was told", () => {
    expect(transferSplit({ buyIns: 1, enteringHighHands: true }, 55, desk)).toEqual({ transferCents: 5000, doorCents: 500, doorFor: "high hand" });
  });

  it("has nothing for the door when the transfer pays everything owed", () => {
    expect(transferSplit({ buyIns: 1, enteringHighHands: false }, 50, desk)).toEqual({ transferCents: 5000, doorCents: 0, doorFor: "" });
  });

  it("puts re-buys and add-ons recorded before the payment at the door too", () => {
    expect(transferSplit({ buyIns: 1, rebuys: 1, addons: 1, enteringHighHands: true }, 105, desk)).toEqual({
      transferCents: 5000,
      doorCents: 5500,
      doorFor: "high hand, re-buys, add-ons",
    });
  });

  it("asks a free entry for no transfer, and never more than the amount", () => {
    expect(transferSplit({ buyIns: 1, freeEntry: true, enteringHighHands: true }, 5, desk)).toEqual({ transferCents: 0, doorCents: 500, doorFor: "high hand" });
    expect(transferSplit({ buyIns: 2 }, 50, desk)).toEqual({ transferCents: 5000, doorCents: 0, doorFor: "" });
  });
});
