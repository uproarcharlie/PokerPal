import { describe, expect, it } from "vitest";
import { isActiveStatus, isClosedStatus, isUpcomingStatus, TOURNAMENT_STATUSES } from "./tournaments";

describe("tournament statuses", () => {
  it("count completed and cancelled as closed, and nothing unknown or missing", () => {
    expect(TOURNAMENT_STATUSES.map(isClosedStatus)).toEqual([false, false, false, true, true]);
    expect([undefined, null, "", "finished"].map(isClosedStatus)).toEqual([false, false, false, false]);
  });

  it("count the ones open for sign-up or under way as active", () => {
    expect(TOURNAMENT_STATUSES.map(isActiveStatus)).toEqual([false, true, true, false, false]);
    expect([undefined, null, "live"].map(isActiveStatus)).toEqual([false, false, false]);
  });

  it("count the ones not started yet as upcoming (what a clock start can start, and its undo put back)", () => {
    expect(TOURNAMENT_STATUSES.map(isUpcomingStatus)).toEqual([true, true, false, false, false]);
    expect([undefined, null, "draft"].map(isUpcomingStatus)).toEqual([false, false, false]);
  });
});
