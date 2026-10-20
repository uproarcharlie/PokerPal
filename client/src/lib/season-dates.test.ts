import { describe, expect, it } from "vitest";
import { formatSeasonDate, seasonDates, seasonEndDate, toDateInputValue } from "./season-dates";

const season = (startDate: string, endDate: string | null) => ({ startDate, endDate });

describe("season dates (P3REV2-CQ-04)", () => {
  it("show the calendar days that were typed, wherever the club is", () => {
    expect(formatSeasonDate("2026-03-01T00:00:00.000Z")).toBe("1 Mar 2026");
    // Read in a zone west of Greenwich, midnight UTC would be the day before.
    expect(seasonDates(season("2026-03-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z"))).toBe("1 Mar 2026 – 31 Aug 2026");
    expect(formatSeasonDate(null)).toBe("");
  });

  it("treat a season saved with the legacy 1970 end as having none, on screen and in the edit form", () => {
    const legacy = season("2026-03-01T00:00:00.000Z", "1970-01-01T00:00:00.000Z");
    expect(seasonEndDate(legacy)).toBeNull();
    expect(seasonDates(legacy)).toBe("1 Mar 2026");
    expect(toDateInputValue(seasonEndDate(legacy))).toBe("");
    expect(seasonEndDate(season("2026-03-01T00:00:00.000Z", "not a date"))).toBeNull();
  });

  it("fill a date box with the stored day", () => {
    expect(toDateInputValue("2026-03-01T00:00:00.000Z")).toBe("2026-03-01");
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue("not a date")).toBe("");
  });
});
