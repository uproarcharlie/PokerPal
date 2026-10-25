import { describe, expect, it } from "vitest";
import { createServerTime, SERVER_TIME_SAMPLES } from "./server-time";

/** A device whose monotonic and wall clocks the test moves by hand. */
function device(wallStart = 1_000_000) {
  let monotonic = 0;
  let wall = wallStart;
  return {
    sources: { monotonic: () => monotonic, wall: () => wall },
    /** Time passes on both clocks. */
    pass(ms: number) {
      monotonic += ms;
      wall += ms;
    },
    /** The device's own time is changed (NTP, a person), the monotonic clock is not. */
    setWall(to: number) {
      wall = to;
    },
  };
}

describe("the server-time estimate", () => {
  it("is the device's own time until the first answer", () => {
    const clock = device();
    const time = createServerTime(clock.sources);
    expect(time.now()).toBe(1_000_000);
  });

  it("puts the server's time at the middle of the round trip and advances it with the device", () => {
    const clock = device();
    const time = createServerTime(clock.sources);
    const sentAt = time.mark();
    clock.pass(200);
    // The server, 10 minutes ahead of this device, answered half-way through.
    time.record(1_000_100 + 600_000, sentAt);
    expect(time.now()).toBe(1_000_200 + 600_000);
    clock.pass(5_000);
    expect(time.now()).toBe(1_005_200 + 600_000);
  });

  it("trusts the answer with the shortest round trip of the last few", () => {
    const clock = device();
    const time = createServerTime(clock.sources);
    // A quick answer, exact: the server is 1 s ahead.
    let sentAt = time.mark();
    clock.pass(20);
    time.record(1_000_010 + 1_000, sentAt);
    // A slow one whose middle guess is 2 s off.
    sentAt = time.mark();
    clock.pass(4_000);
    time.record(1_002_020 + 1_000 + 2_000, sentAt);
    expect(time.now()).toBe(1_004_020 + 1_000);
  });

  it("forgets the quick answer once it is older than the last few", () => {
    const clock = device();
    const time = createServerTime(clock.sources);
    let sentAt = time.mark();
    clock.pass(10);
    time.record(1_000_005, sentAt);
    for (let i = 0; i < SERVER_TIME_SAMPLES; i++) {
      sentAt = time.mark();
      clock.pass(100);
      // Each slower answer says the server is 3 s ahead.
      time.record(clock.sources.wall() - 50 + 3_000, sentAt);
    }
    expect(time.now()).toBe(clock.sources.wall() + 3_000);
  });

  it("is not moved by a change of the device's own time", () => {
    const clock = device();
    const time = createServerTime(clock.sources);
    const sentAt = time.mark();
    time.record(1_000_000, sentAt);
    clock.setWall(5_000_000);
    expect(time.now()).toBe(1_000_000);
  });

  it("after a reset runs on the device's wall clock with the last offset seen", () => {
    const clock = device();
    const time = createServerTime(clock.sources);
    const sentAt = time.mark();
    time.record(1_000_000 + 60_000, sentAt);
    time.reset();
    clock.pass(1_000);
    expect(time.now()).toBe(1_001_000 + 60_000);
  });

  it("ignores an answer without a usable time", () => {
    const clock = device();
    const time = createServerTime(clock.sources);
    time.record(Number.NaN, time.mark());
    expect(time.now()).toBe(1_000_000);
  });
});
