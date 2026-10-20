/**
 * How the client writes money, dates, times and names. Money comes from shared/domain/money (the
 * functions the server pays with); dates and times are shown in the club's time zone, so a player
 * abroad and the TD at the venue read the same start time.
 */
import { formatMoney, toCents, type Cents, type MoneyInput } from "@shared/domain/money";

export { formatMoney };
export type { Cents };

/** A decimal amount as the API sends row columns ("50.00", "12.5"), formatted like formatMoney. */
export function formatAmount(value: MoneyInput, options: { forceCents?: boolean } = {}): string {
  return formatMoney(toCents(value), options);
}

/** Where clubs play unless their settings say otherwise. */
export const DEFAULT_TIME_ZONE = "Pacific/Auckland";

const LOCALE = "en-NZ";

/**
 * Formatters are built once per style and time zone and reused: building an Intl formatter costs
 * about 65 times as much as using one, and lists that re-render on every poll (the desks every 3 s, an
 * activity feed of up to 1,000 entries every 5 s) format a time on every row (P3REV4-PERF-G).
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const knownZones = new Map<string, boolean>();

function isTimeZone(value: string): boolean {
  let valid = knownZones.get(value);
  if (valid === undefined) {
    try {
      new Intl.DateTimeFormat(LOCALE, { timeZone: value });
      valid = true;
    } catch {
      valid = false;
    }
    knownZones.set(value, valid);
  }
  return valid;
}

/** The club's IANA time zone when it has a valid one, else DEFAULT_TIME_ZONE. */
export function clubTimeZone(club?: { timezone?: string | null } | null): string {
  const zone = club?.timezone?.trim();
  return zone && isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

export type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_STYLES = {
  date: { day: "numeric", month: "short", year: "numeric" },
  day: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  time: { hour: "numeric", minute: "2-digit", hour12: true },
  dateTime: { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

function format(value: DateInput, style: keyof typeof DATE_STYLES, timeZone: string | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const zone = timeZone ?? DEFAULT_TIME_ZONE;
  const key = `${style}|${zone}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(LOCALE, { ...DATE_STYLES[style], timeZone: zone });
    dateFormatters.set(key, formatter);
  }
  return formatter.format(date);
}

/** "19 Oct 2026"; "" for no date. */
export function formatDate(value: DateInput, timeZone?: string): string {
  return format(value, "date", timeZone);
}

/** "Mon, 19 Oct 2026": the day a tournament is on. */
export function formatDay(value: DateInput, timeZone?: string): string {
  return format(value, "day", timeZone);
}

/** "7:30 pm" */
export function formatTime(value: DateInput, timeZone?: string): string {
  return format(value, "time", timeZone);
}

/** "Mon, 19 Oct 2026, 7:30 pm" */
export function formatDateTime(value: DateInput, timeZone?: string): string {
  return format(value, "dateTime", timeZone);
}

const WALL_CLOCK_PARTS = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

/** The minute an instant shows on the wall clock in `timeZone`, as the UTC time with the same fields. */
function wallClockMinute(ms: number, timeZone: string): number {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { ...WALL_CLOCK_PARTS, timeZone });
    wallClockFormatters.set(timeZone, formatter);
  }
  const part = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(part.year, part.month - 1, part.day, part.hour % 24, part.minute);
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A stored instant as a `datetime-local` value ("2026-10-24T19:30") on the wall clock in `timeZone`:
 * what a form shows for the time every other screen shows in the club's zone. "" for no date.
 */
export function toZonedDateTimeLocal(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  if (!date) return "";
  const wall = new Date(wallClockMinute(date.getTime(), timeZone));
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * A `datetime-local` value read on the wall clock in `timeZone`, as an ISO instant; null when it is not
 * one. The zone's offset is found at that wall time (read once as UTC, then corrected), so a time
 * either side of a daylight-saving change gets its own offset.
 */
export function fromZonedDateTimeLocal(local: string, timeZone: string): string | null {
  const match = DATE_TIME_LOCAL.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(wall)) return null;
  const offsetAt = (ms: number) => wallClockMinute(ms, timeZone) - Math.floor(ms / 60_000) * 60_000;
  const guess = wall - offsetAt(wall);
  return new Date(wall - offsetAt(guess)).toISOString();
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

const RELATIVE = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** "2 minutes ago", "yesterday", "in 3 hours"; "" for no date. Under 45 seconds is "now". */
export function formatRelativeTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return RELATIVE.format(0, "second");
  const [unit, size] = RELATIVE_UNITS.find(([, length]) => Math.abs(seconds) >= length) ?? RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  return RELATIVE.format(Math.round(seconds / size), unit);
}

/** Punctuation before a word ("(Bob)", "'Jo"), in any script. Built at run time: tsc's target predates the u flag. */
const LEADING_NON_ALPHANUMERIC = new RegExp("^[^\\p{L}\\p{N}]+", "u");

/**
 * Up to `max` initials, one per word, from the first words that start with a letter or digit:
 * "Central Stars" → "CS", "jane o'neill" → "JO", "Bob" → "B", "" → "".
 */
export function initials(name: string | null | undefined, max = 2): string {
  if (!name) return "";
  return name
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word.replace(LEADING_NON_ALPHANUMERIC, ""))[0] ?? "")
    .filter(Boolean)
    .slice(0, max)
    .join("")
    .toLocaleUpperCase(LOCALE);
}

const WHOLE_NUMBER = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** A count or a points total with its thousands grouped: "1,250". */
export function formatNumber(value: number): string {
  return WHOLE_NUMBER.format(value);
}

/**
 * A count with its word, grouped like formatNumber: "1 player", "3 players", "1,250 points";
 * `pluralWord` for a word that does not just take an "s" ("1 entry", "2 entries").
 */
export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${formatNumber(count)} ${count === 1 ? word : pluralWord}`;
}

/** "1st", "2nd", "3rd", "4th", ..., "11th", "21st". */
export function ordinal(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${position}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[position % 10] ?? "th";
  return `${position}${suffix}`;
}
