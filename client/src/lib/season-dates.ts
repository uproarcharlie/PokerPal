/**
 * How every screen writes a season's dates (P3REV2-CQ-04: the club pages, the seasons screens, the
 * dashboard and the edit form read them one way).
 *
 * A season's start and end are calendar days, not moments: the date boxes send "2026-03-01", which the
 * server stores as midnight UTC. They are read back in UTC, so everyone sees the day that was typed; in
 * the club's zone, a day typed for a club west of Greenwich would show as the day before.
 *
 * Seasons saved without an end before DATA-22 hold 1 January 1970 (the epoch) until that data is
 * repaired: they have no end, wherever they are shown or edited.
 */
import type { PublicSeason } from "@shared/api/public";
import { formatDate } from "./format";

const CALENDAR_DAY_ZONE = "UTC";

/** "1 Mar 2026"; "" for no date. */
export function formatSeasonDate(value: string | null | undefined): string {
  return formatDate(value, CALENDAR_DAY_ZONE);
}

/** A season's end date, or null when it has none (blank, unreadable, or the legacy epoch). */
export function seasonEndDate(season: Pick<PublicSeason, "endDate">): string | null {
  if (!season.endDate) return null;
  const time = new Date(season.endDate).getTime();
  return Number.isNaN(time) || time === 0 ? null : season.endDate;
}

/** "1 Oct 2026 – 31 Mar 2027", or the start alone for a season with no end. */
export function seasonDates(season: Pick<PublicSeason, "startDate" | "endDate">): string {
  const start = formatSeasonDate(season.startDate);
  const end = seasonEndDate(season);
  return end ? `${start} – ${formatSeasonDate(end)}` : start;
}

/** A stored season date as a date box's value ("2026-03-01"); "" for none or an unreadable one. */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
