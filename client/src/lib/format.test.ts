import { describe, expect, it, vi } from "vitest";
import {
  clubTimeZone,
  DEFAULT_TIME_ZONE,
  amountBoxText,
  formatAmount,
  formatDate,
  formatDateTime,
  formatDay,
  formatMoney,
  formatNumber,
  formatRelativeTime,
  formatTime,
  fromZonedDateTimeLocal,
  initials,
  seatLabel,
  ordinal,
  plural,
  toZonedDateTimeLocal,
} from "./format";

describe("money", () => {
  it("formats cents with shared/domain's rule, and decimal columns the same way", () => {
    expect(formatMoney(147500)).toBe("$1,475");
    expect(formatMoney(23750)).toBe("$237.50");
    expect(formatAmount("50.00")).toBe("$50");
    expect(formatAmount("12.5", { forceCents: true })).toBe("$12.50");
    expect(formatAmount(null)).toBe("$0");
    // As a box shows it for editing (the payout editor and a deal: R5REV3-CQ-09).
    expect(amountBoxText(30_000)).toBe("300");
    expect(amountBoxText(1_250)).toBe("12.50");
  });
});

describe("dates and times", () => {
  // 07:30 UTC on 19 Oct 2026 is 8:30 pm the same day in Auckland (NZDT, UTC+13).
  const instant = "2026-10-19T07:30:00.000Z";

  it("are shown in the club's time zone, Auckland when it has none", () => {
    expect(formatDate(instant)).toBe("19 Oct 2026");
    expect(formatTime(instant)).toBe("8:30 pm");
    expect(formatDay(instant)).toBe("Mon, 19 Oct 2026");
    expect(formatDateTime(instant)).toBe("Mon, 19 Oct 2026, 8:30 pm");
    expect(formatTime(instant, "Australia/Sydney")).toBe("6:30 pm");
  });

  it("show nothing for no date or an unreadable one", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDateTime("")).toBe("");
    expect(formatTime("not a date")).toBe("");
  });

  it("take the club's zone only when it is a real one", () => {
    expect(clubTimeZone({ timezone: "Australia/Perth" })).toBe("Australia/Perth");
    expect(clubTimeZone({ timezone: "Mars/Olympus" })).toBe(DEFAULT_TIME_ZONE);
    expect(clubTimeZone({ timezone: null })).toBe(DEFAULT_TIME_ZONE);
    expect(clubTimeZone(undefined)).toBe("Pacific/Auckland");
  });

  it("say how long ago something happened", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    expect(formatRelativeTime("2026-10-19T11:59:40.000Z", now)).toBe("now");
    expect(formatRelativeTime("2026-10-19T11:58:00.000Z", now)).toBe("2 minutes ago");
    expect(formatRelativeTime("2026-10-19T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-10-18T12:00:00.000Z", now)).toBe("yesterday");
    expect(formatRelativeTime("2026-10-19T15:00:00.000Z", now)).toBe("in 3 hours");
    expect(formatRelativeTime(undefined, now)).toBe("");
  });
});

describe("datetime-local in the club's zone (P3REV-PARITY-TZ-01)", () => {
  it("shows a stored start on the club's wall clock, whatever zone the device is in", () => {
    // 7:30 pm in Auckland (NZDT, UTC+13) is 5:30 pm in Sydney (AEDT, UTC+11).
    expect(toZonedDateTimeLocal("2026-10-24T06:30:45.000Z", "Pacific/Auckland")).toBe("2026-10-24T19:30");
    expect(toZonedDateTimeLocal("2026-10-24T06:30:45.000Z", "Australia/Sydney")).toBe("2026-10-24T17:30");
    expect(toZonedDateTimeLocal("2026-10-24T23:30:00.000Z", "Europe/London")).toBe("2026-10-25T00:30");
    expect(toZonedDateTimeLocal(null, "Pacific/Auckland")).toBe("");
    expect(toZonedDateTimeLocal("not a date", "Pacific/Auckland")).toBe("");
  });

  it("reads a typed time on the club's wall clock, with the offset that applies on that day", () => {
    expect(fromZonedDateTimeLocal("2026-10-24T19:30", "Pacific/Auckland")).toBe("2026-10-24T06:30:00.000Z");
    expect(fromZonedDateTimeLocal("2026-10-24T19:30", "Australia/Sydney")).toBe("2026-10-24T08:30:00.000Z");
    // Winter in Auckland (NZST, UTC+12), and either side of NZ's change to daylight time on 27 Sep 2026.
    expect(fromZonedDateTimeLocal("2026-06-12T19:30", "Pacific/Auckland")).toBe("2026-06-12T07:30:00.000Z");
    expect(fromZonedDateTimeLocal("2026-09-27T01:30", "Pacific/Auckland")).toBe("2026-09-26T13:30:00.000Z");
    expect(fromZonedDateTimeLocal("2026-09-27T03:30", "Pacific/Auckland")).toBe("2026-09-26T14:30:00.000Z");
    expect(fromZonedDateTimeLocal("", "Pacific/Auckland")).toBeNull();
    expect(fromZonedDateTimeLocal("24/10/2026", "Pacific/Auckland")).toBeNull();
  });

  it("gives back the time it was shown, in any zone", () => {
    for (const zone of ["Pacific/Auckland", "Australia/Perth", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Chatham"]) {
      const local = toZonedDateTimeLocal("2026-03-14T02:15:00.000Z", zone);
      expect(fromZonedDateTimeLocal(local, zone)).toBe("2026-03-14T02:15:00.000Z");
    }
  });
});

describe("formatters (P3REV4-PERF-G)", () => {
  it("are built once per style and zone, not on every row of a list that re-renders on each poll", () => {
    const built = vi.spyOn(Intl, "DateTimeFormat");
    const relative = vi.spyOn(Intl, "RelativeTimeFormat");
    const zone = "Pacific/Chatham";
    for (let row = 0; row < 50; row += 1) {
      formatTime(Date.UTC(2026, 9, 23, 7, row), clubTimeZone({ timezone: zone }));
      formatRelativeTime(Date.UTC(2026, 9, 23, 7, row), new Date(Date.UTC(2026, 9, 23, 8)));
    }
    // One to check the zone, one to format with it; the relative one was built when the module loaded.
    expect(built.mock.calls.length).toBeLessThanOrEqual(2);
    expect(relative).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("seatLabel", () => {
  it("writes a first name and the last name's initial beside a seat, one word as it is", () => {
    expect(seatLabel("Alice Smith")).toBe("Alice S.");
    expect(seatLabel("Mary Jane van der Berg")).toBe("Mary B.");
    expect(seatLabel("  Cher ")).toBe("Cher");
  });
});

describe("initials", () => {
  it("are the first letters of the first words", () => {
    expect(initials("Central Stars")).toBe("CS");
    expect(initials("Central Stars Poker Club")).toBe("CS");
    expect(initials("jane o'neill")).toBe("JO");
    expect(initials("Bob")).toBe("B");
    expect(initials("  (Ana)   María ")).toBe("AM");
    expect(initials("Łukasz Żak")).toBe("ŁŻ");
    expect(initials("")).toBe("");
    expect(initials(null)).toBe("");
    expect(initials("Club 2020 Onehunga", 3)).toBe("C2O");
  });
});

describe("ordinal", () => {
  it("names places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
});

describe("formatNumber", () => {
  it("groups thousands and writes whole numbers", () => {
    expect(formatNumber(1250)).toBe("1,250");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1_000_000)).toBe("1,000,000");
  });
});

describe("plural (P3REV3-CQ-11)", () => {
  it("writes a count with its word, one or many, grouped like every other count", () => {
    expect(plural(1, "player")).toBe("1 player");
    expect(plural(0, "player")).toBe("0 players");
    expect(plural(3, "tournament")).toBe("3 tournaments");
    expect(plural(1250, "point")).toBe("1,250 points");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
    expect(plural(1, "entry", "entries")).toBe("1 entry");
  });
});
