/**
 * Links: the ones people type in (a club's website and social pages, image URLs), and the paths of the
 * app's public pages that the server and the client both build. Plain code, so a page that only shows
 * a link does not load zod with shared/api/common.ts. PURE: no runtime imports.
 */

/** The longest link the app stores or renders. */
export const URL_MAX = 2048;

/**
 * `value` when it is an absolute http(s) URL (the rule httpUrlSchema applies on write), else null.
 * For links stored before that rule existed: a club's social links went straight into the column, so
 * a stored row can hold `javascript:` or `data:` (P2REV0-SEC-05). Every response and every page that
 * renders such a link passes it through this.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > URL_MAX || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

const seg = (value: string) => encodeURIComponent(value);

/**
 * The public pages' paths, for the links the server hands out (the TV's QR code, the TV clock key's
 * link). The client's route builders make the same paths (client/src/app/routes.ts), and
 * test/unit/public-paths.test.ts holds the two together, so a printed QR code never leads to a page
 * the router does not serve. Ids are percent-encoded.
 */
export const publicPaths = {
  tournament: (tournamentId: string) => `/tournament/${seg(tournamentId)}`,
  seats: (tournamentId: string) => `/tournament/${seg(tournamentId)}/seats`,
  season: (seasonId: string) => `/season/${seg(seasonId)}`,
  clockDisplay: (tournamentId: string) => `/clock/${seg(tournamentId)}`,
} as const;

/** The fragment parameter of a TV clock link that carries the clock key (a fragment never reaches a server or its logs). */
export const CLOCK_KEY_PARAM = "key";

/** The TV clock at `tournamentId`, given the clock key that lets it run the clock: "/clock/t1#key=…". */
export const clockKeyLink = (tournamentId: string, key: string): string =>
  `${publicPaths.clockDisplay(tournamentId)}#${CLOCK_KEY_PARAM}=${encodeURIComponent(key)}`;
