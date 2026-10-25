import { describe, expect, it } from "vitest";
import { registrationDto } from "@test/helpers/f1-tournaments";
import { playerName, UNKNOWN_PLAYER } from "../../player-name";
import { correctionOrderOf, finishersOf } from "./standings-order";

describe("a sign-up whose player is missing (P3REV6-CQ-04)", () => {
  it("is named the same way in Correct Results as in the standings and the desks", () => {
    const missing = registrationDto("r2", "", 1, { player: null, finalPosition: 1 });
    const ann = registrationDto("r1", "Ann", 1, { finalPosition: 2 });

    expect(finishersOf([ann, missing])).toEqual([
      { registrationId: "r2", playerName: UNKNOWN_PLAYER },
      { registrationId: "r1", playerName: "Ann" },
    ]);
    expect(playerName(missing)).toBe("Unknown player");
    expect(playerName(ann)).toBe("Ann");
  });
});

describe("correctionOrderOf (R6REV1-PHONE-01)", () => {
  /** A row as the club's staff get it, with its payment. */
  const staffRow = (paymentConfirmed: boolean, ...args: Parameters<typeof registrationDto>) => ({ ...registrationDto(...args), paymentConfirmed });

  it("lists the stored order, then the players finalize left out, so the whole field is in the order Correct Results sends", () => {
    const ann = staffRow(true, "r1", "Ann", 1, { finalPosition: 2 });
    const bob = staffRow(true, "r2", "Bob", 1, { finalPosition: 1 });
    // Left out at End Tournament for not paying: no place.
    const hana = staffRow(false, "r3", "Hana", 1, { finalPosition: null });

    expect(correctionOrderOf([ann, hana, bob], null)).toEqual([
      { registrationId: "r2", playerName: "Bob", placed: true, paid: true },
      { registrationId: "r1", playerName: "Ann", placed: true, paid: true },
      { registrationId: "r3", playerName: "Hana", placed: false, paid: false },
    ]);
  });

  it("leaves out the waiting list behind a full field, which was never in the game", () => {
    const ann = staffRow(true, "r1", "Ann", 1, { finalPosition: 1, registrationTime: "2026-10-01T18:00:00.000Z" });
    const late = staffRow(false, "r2", "Late", 1, { finalPosition: null, registrationTime: "2026-10-01T19:00:00.000Z" });

    expect(correctionOrderOf([ann, late], 1).map((entry) => entry.registrationId)).toEqual(["r1"]);
  });
});
