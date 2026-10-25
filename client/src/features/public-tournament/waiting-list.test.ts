import { describe, expect, it } from "vitest";
import { registrationDto } from "@test/helpers/f2-public";
import { lineupOf, nextSignUpPlace, waitingListPlaceOf } from "./waiting-list";

/** Sign-ups as GET /api/tournaments/:id/registrations answers them: each numbered by the server, or null in the field. */
const signUps = (positions: Array<number | null>) => positions.map((waitingListPosition, i) => registrationDto(`r${i + 1}`, `P${i + 1}`, { waitingListPosition }));

describe("lineupOf (round 5, item 15)", () => {
  it("puts everyone the server numbered on the waiting list, next in first, and keeps the field in its order", () => {
    const { field, waiting } = lineupOf(signUps([null, 2, null, 1]), 2);

    expect(field.map((registration) => registration.id)).toEqual(["r1", "r3"]);
    expect(waiting.map(({ registration, position }) => [registration.id, position])).toEqual([
      ["r4", 1],
      ["r2", 2],
    ]);
  });

  it("works the list out by the shared rule when the entries carry no number (sign-up order past Max players)", () => {
    const entries = ["r1", "r2", "r3"].map((id, i) => ({ id, registrationTime: `2026-10-23T06:0${i}:00.000Z`, paymentConfirmed: false }));

    expect(lineupOf(entries, 2).waiting.map(({ registration }) => registration.id)).toEqual(["r3"]);
    expect(lineupOf(entries, null).waiting).toEqual([]);
  });
});

describe("nextSignUpPlace", () => {
  it("says where a sign-up made now goes: nowhere special while there is room, else the end of the list", () => {
    expect(nextSignUpPlace(lineupOf(signUps([null, null]), 3), 3)).toBeNull();
    expect(nextSignUpPlace(lineupOf(signUps([null, null, null]), 3), 3)).toBe(1);
    expect(nextSignUpPlace(lineupOf(signUps([null, null, null, 1, 2]), 3), 3)).toBe(3);
  });
});

describe("waitingListPlaceOf", () => {
  it("reads a registration's number, and nothing for one in the field or not worked out", () => {
    expect(waitingListPlaceOf({ waitingListPosition: 2 })).toBe(2);
    expect(waitingListPlaceOf({ waitingListPosition: null })).toBeNull();
    expect(waitingListPlaceOf({})).toBeNull();
    expect(waitingListPlaceOf(null)).toBeNull();
  });
});
