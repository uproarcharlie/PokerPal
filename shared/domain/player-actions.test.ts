import { describe, expect, it } from "vitest";
import {
  knockoutTargetsFor,
  lateTopUpText,
  maxAddonsMessage,
  maxRebuysMessage,
  offersAddons,
  offersHighHand,
  offersRebuys,
  requestersFor,
  requestRefusal,
  topUpRefusal,
} from "./player-actions";

const ann = { playerId: "ann", isEliminated: false };
const bob = { playerId: "bob", isEliminated: true, eliminatedBy: "ann" };
const cat = { playerId: "cat", isEliminated: true, eliminatedBy: null };
const field = [ann, bob, cat];
const withRebuys = { rebuyAmount: "20.00" };

describe("offersRebuys / offersAddons", () => {
  it("count a price of $0.00 (as Postgres returns it) as none, like the server", () => {
    expect(offersRebuys({ rebuyAmount: "0.00" })).toBe(false);
    expect(offersRebuys({ rebuyAmount: null })).toBe(false);
    expect(offersRebuys(withRebuys)).toBe(true);
    expect(offersAddons({ addonAmount: "0.00" })).toBe(false);
    expect(offersAddons({ addonAmount: "10" })).toBe(true);
  });
});

describe("requestersFor", () => {
  it("offers a re-buy to players who are out, to buy back in (TN-04), and everything else only to players still in", () => {
    expect(requestersFor("rebuy", field, withRebuys)).toEqual(field);
    expect(requestersFor("addon", field, withRebuys)).toEqual([ann]);
    expect(requestersFor("knockout", field, withRebuys)).toEqual([ann]);
  });

  it("offers nobody who is out when the re-buy price is $0.00, which the server refuses (P2REV4-CQ-04)", () => {
    expect(requestersFor("rebuy", field, { rebuyAmount: "0.00" })).toEqual([ann]);
  });
});

describe("knockoutTargetsFor", () => {
  it("offers players still in and players marked out with no eliminator, never the claimer or someone another player got (TN-06)", () => {
    expect(knockoutTargetsFor(field, "ann")).toEqual([cat]);
    expect(knockoutTargetsFor([...field, { playerId: "dee", isEliminated: false }], "ann")).toEqual([cat, { playerId: "dee", isEliminated: false }]);
  });
});

describe("requestRefusal", () => {
  const open = { rebuyAmount: "20.00", addonAmount: "10.00", maxRebuys: 2, prizePoolLocked: false };

  it("lets a player still in ask for anything, and a player who is out only buy back in", () => {
    expect(requestRefusal(open, { isEliminated: false, rebuys: 0 }, "addon")).toBeNull();
    expect(requestRefusal(open, { isEliminated: true, rebuys: 0 }, "rebuy")).toBeNull();
    expect(requestRefusal(open, { isEliminated: true, rebuys: 0 }, "addon")?.code).toBe("PLAYER_ELIMINATED");
    expect(requestRefusal({ ...open, rebuyAmount: "0.00" }, { isEliminated: true }, "rebuy")?.code).toBe("PLAYER_ELIMINATED");
  });

  it("refuses a re-buy or add-on at a tournament that does not sell one, as the page never offers it (CQ-P2-05)", () => {
    const freezeout = { ...open, rebuyAmount: null, addonAmount: "0.00" };

    expect(requestRefusal(freezeout, { isEliminated: false }, "rebuy")).toEqual({ code: "NOT_OFFERED", message: "This tournament has no re-buys" });
    expect(requestRefusal(freezeout, { isEliminated: false }, "addon")).toEqual({ code: "NOT_OFFERED", message: "This tournament has no add-ons" });
    expect(requestRefusal(freezeout, { isEliminated: false }, "knockout")).toBeNull();
    expect(requestRefusal({ ...freezeout, prizePoolLocked: true }, { isEliminated: false }, "addon")?.code).toBe("NOT_OFFERED");
  });

  it("refuses re-buys and add-ons while the pool is locked, but not knockout claims", () => {
    const locked = { ...open, prizePoolLocked: true };
    expect(requestRefusal(locked, { isEliminated: false }, "rebuy")?.code).toBe("PRIZE_POOL_LOCKED");
    expect(requestRefusal(locked, { isEliminated: false }, "addon")?.code).toBe("PRIZE_POOL_LOCKED");
    expect(requestRefusal(locked, { isEliminated: false }, "knockout")).toBeNull();
  });

  it("refuses a re-buy past the limit with the same sentence the count change uses", () => {
    expect(requestRefusal(open, { isEliminated: false, rebuys: 1 }, "rebuy")).toBeNull();
    expect(requestRefusal(open, { isEliminated: false, rebuys: 2 }, "rebuy")).toEqual({
      code: "MAX_REBUYS_REACHED",
      message: maxRebuysMessage(2),
    });
    expect(requestRefusal({ ...open, maxRebuys: null }, { isEliminated: false, rebuys: 50 }, "rebuy")).toBeNull();
    expect(maxRebuysMessage(1)).toBe("This tournament allows at most 1 re-buy per player");
  });

  it("refuses a second add-on, and a re-buy after an add-on, at a one-re-buy-or-one-add-on tournament (TDN3-HOUSE-RULES)", () => {
    const oneLifeLine = { ...open, maxRebuys: 1, maxAddons: 1, rebuyOrAddon: true };
    expect(requestRefusal(oneLifeLine, { isEliminated: false, rebuys: 0, addons: 0 }, "addon")).toBeNull();
    expect(requestRefusal(oneLifeLine, { isEliminated: false, rebuys: 0, addons: 1 }, "addon")).toEqual({
      code: "MAX_ADDONS_REACHED",
      message: "This tournament allows at most 1 add-on per player",
    });
    expect(requestRefusal(oneLifeLine, { isEliminated: true, rebuys: 0, addons: 1 }, "rebuy")).toEqual({
      code: "REBUY_OR_ADDON",
      message: "Already took an add-on: this tournament allows one re-buy OR one add-on per player",
    });
    expect(requestRefusal(oneLifeLine, { isEliminated: false, rebuys: 1, addons: 0 }, "addon")?.code).toBe("REBUY_OR_ADDON");
  });
});

describe("topUpRefusal (TDN3-HOUSE-RULES)", () => {
  const oneLifeLine = { maxRebuys: 1, maxAddons: 1, rebuyOrAddon: true };
  const none = { rebuys: 0, addons: 0 };

  it("allows either top-up once, and says which one the player already took", () => {
    expect(topUpRefusal(oneLifeLine, none, { rebuys: 1, addons: 0 })).toBeNull();
    expect(topUpRefusal(oneLifeLine, none, { rebuys: 0, addons: 1 })).toBeNull();
    expect(topUpRefusal(oneLifeLine, { rebuys: 1, addons: 0 }, { rebuys: 1, addons: 1 })).toEqual({
      code: "REBUY_OR_ADDON",
      message: "Already took a re-buy: this tournament allows one re-buy OR one add-on per player",
    });
    expect(topUpRefusal(oneLifeLine, none, { rebuys: 1, addons: 1 })).toEqual({
      code: "REBUY_OR_ADDON",
      message: "This tournament allows one re-buy OR one add-on per player",
    });
    expect(topUpRefusal({ ...oneLifeLine, maxRebuys: 2 }, { rebuys: 0, addons: 1 }, { rebuys: 1, addons: 1 })?.message).toBe(
      "Already took an add-on: this tournament allows re-buys or add-ons per player, not both",
    );
  });

  it("counts against each limit, and never refuses a correction down", () => {
    expect(topUpRefusal(oneLifeLine, none, { rebuys: 2, addons: 0 })).toMatchObject({ code: "MAX_REBUYS_REACHED" });
    expect(topUpRefusal(oneLifeLine, { rebuys: 0, addons: 1 }, { rebuys: 0, addons: 2 })).toEqual({ code: "MAX_ADDONS_REACHED", message: maxAddonsMessage(1) });
    expect(topUpRefusal(oneLifeLine, { rebuys: 1, addons: 1 }, { rebuys: 0, addons: 1 })).toBeNull();
    expect(topUpRefusal(oneLifeLine, { rebuys: 3, addons: 2 }, { rebuys: 3, addons: 2 })).toBeNull();
    expect(maxAddonsMessage(2)).toBe("This tournament allows at most 2 add-ons per player");
  });

  it("changes nothing for a tournament without the rules", () => {
    expect(topUpRefusal({}, { rebuys: 4, addons: 3 }, { rebuys: 5, addons: 4 })).toBeNull();
    expect(topUpRefusal({ maxRebuys: null, maxAddons: null, rebuyOrAddon: null }, none, { rebuys: 9, addons: 9 })).toBeNull();
    expect(topUpRefusal({ rebuyOrAddon: false }, none, { rebuys: 1, addons: 1 })).toBeNull();
  });
});

describe("lateTopUpText (TDN3-HOUSE-RULES)", () => {
  it("names the end of the re-buy period once the clock has passed it", () => {
    expect(lateTopUpText(135, 135 * 60_000)).toBe("after the re-buy period, which ended at 2:15 on the clock");
    expect(lateTopUpText(45, 46 * 60_000)).toBe("after the re-buy period, which ended at 0:45 on the clock");
    expect(lateTopUpText(135, 135 * 60_000 - 1)).toBeNull();
    expect(lateTopUpText(null, 999 * 60_000)).toBeNull();
    expect(lateTopUpText(135, null)).toBeNull();
  });
});

describe("offersHighHand (P3REV5-CQ-02)", () => {
  it("is a high hand switched on with an entry fee: a stored $0 fee is none", () => {
    expect(offersHighHand({ enableHighHand: true, highHandAmount: "5.00" })).toBe(true);
    expect(offersHighHand({ enableHighHand: true, highHandAmount: "0.00" })).toBe(false);
    expect(offersHighHand({ enableHighHand: false, highHandAmount: "5.00" })).toBe(false);
    expect(offersHighHand({ enableHighHand: null, highHandAmount: null })).toBe(false);
  });
});
