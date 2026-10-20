import { DEFAULT_TIME_ZONE } from "@/lib/format";

/** The zones clubs on this site play in most, offered first. */
const NEARBY = [
  DEFAULT_TIME_ZONE,
  "Pacific/Chatham",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Hobart",
  "Australia/Darwin",
  "Australia/Perth",
  "Pacific/Fiji",
  "Pacific/Tongatapu",
  "Pacific/Apia",
  "Pacific/Rarotonga",
] as const;

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-NZ", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every IANA zone this browser knows; empty in a browser too old to list them. */
function supportedZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export interface TimeZoneGroups {
  nearby: string[];
  other: string[];
}

/**
 * The zones to choose from: the nearby ones first, then every other zone. `current` is always offered,
 * even when this browser does not list it (a club keeps the zone it has until someone changes it).
 */
export function timeZoneGroups(current?: string): TimeZoneGroups {
  const nearby: string[] = NEARBY.filter(isTimeZone);
  const offered = new Set(nearby);
  const other = supportedZones().filter((zone) => !offered.has(zone));
  if (current && !offered.has(current) && !other.includes(current)) nearby.unshift(current);
  return { nearby, other };
}

/** "Pacific/Port_Moresby" → "Pacific/Port Moresby" */
export function timeZoneLabel(zone: string): string {
  return zone.replace(/_/g, " ");
}
