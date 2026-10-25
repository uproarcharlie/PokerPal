import { describe, expect, it } from "vitest";
import { CLOCK_KEY_PARAM, clockKeyLink, publicPaths } from "./urls";

describe("publicPaths", () => {
  it("builds the public pages' paths with the ids percent-encoded", () => {
    expect(publicPaths.tournament("t1")).toBe("/tournament/t1");
    expect(publicPaths.seats("t/1")).toBe("/tournament/t%2F1/seats");
    expect(publicPaths.season("s 2")).toBe("/season/s%202");
    expect(publicPaths.clockDisplay("t1")).toBe("/clock/t1");
  });
});

describe("clockKeyLink", () => {
  it("carries the clock key in the TV clock link's fragment, which never reaches a server", () => {
    const link = clockKeyLink("t1", "Ab-_9");
    expect(link).toBe("/clock/t1#key=Ab-_9");
    expect(new URLSearchParams(new URL(link, "https://lovepoker.club").hash.slice(1)).get(CLOCK_KEY_PARAM)).toBe("Ab-_9");
  });
});
